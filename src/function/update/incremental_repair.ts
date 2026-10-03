import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { isFunctionCallingSupported } from '@/function/is_function_calling_supported';
import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import {
    Command,
    extractCommands,
    parseCommandValue,
    trimQuotesAndBackslashes,
    updateVariables,
} from '@/function/update_variables';
import { tr } from '@/i18n';
import { useDataStore } from '@/store';
import { getLastValidVariable, isJsonPatch } from '@/util';
import { isMvuData, isValueWithDescription } from '@/variable_def';
import { parseString } from '@util/common';
import { cleanStructuredUpdate, findUpdateMarkupBlocks, isJsonSafe } from './structured_update';
import { klona } from 'klona';

const EMPTY_JSON_PATCH_RE =
    /<json_?patch\b[^>]*>\s*(?:```[^\n]*\s*)?\[\s*\](?:\s*```)?\s*<\/json_?patch\s*>/i;
const FORBIDDEN_ROOT_PATHS = new Set([
    '$internal',
    '$meta',
    'schema',
    'display_data',
    'delta_data',
    'initialized_lorebooks',
]);
const PERSISTED_MVU_KEYS = [
    'initialized_lorebooks',
    'stat_data',
    'schema',
    'display_data',
    'delta_data',
] as const;

type PersistedMvuSnapshot = Partial<Record<(typeof PERSISTED_MVU_KEYS)[number], unknown>>;
type IncrementalRepairOperation = {
    op: 'replace' | 'insert' | 'remove';
    path: string;
    value?: unknown;
};

export interface IncrementalStateChange {
    path: string;
    before: unknown;
    after: unknown;
}

interface RepairAnchor {
    chat_id: string;
    message_id: number;
    swipe_id: number;
    message_content: string;
    message_variables: PersistedMvuSnapshot;
    chat_variables: PersistedMvuSnapshot;
    update_chat_variables: boolean;
}

let is_incremental_repair_in_progress = false;

/**
 * 转义对象键，使其可作为 JSON Pointer 的单个路径片段。
 * @param segment 原始对象键。
 * @returns 将波浪号和斜杠转义后的片段。
 */
function encodePathSegment(segment: string): string {
    return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * 比较前后变量状态，按对象叶节点收集变化；数组整体记录，不拆成索引操作。
 * @param before 上一楼的变量状态。
 * @param after 当前楼已结算的变量状态。
 * @param limit 最多收集的变化条数，默认 120；超出部分不再遍历。
 * @returns 使用 JSON Pointer 标识的变化列表，根节点以 / 表示。
 */
export function collectIncrementalStateChanges(
    before: unknown,
    after: unknown,
    limit: number = 120
): IncrementalStateChange[] {
    const changes: IncrementalStateChange[] = [];

    /** 递归比较普通对象，遇到非对象差异或数组时记录一个完整变化项。 */
    const visit = (old_value: unknown, new_value: unknown, path: string) => {
        if (changes.length >= limit || _.isEqual(old_value, new_value)) return;

        if (_.isPlainObject(old_value) && _.isPlainObject(new_value)) {
            const keys = _.union(
                Object.keys(old_value as object),
                Object.keys(new_value as object)
            );
            for (const key of keys) {
                visit(
                    (old_value as Record<string, unknown>)[key],
                    (new_value as Record<string, unknown>)[key],
                    `${path}/${encodePathSegment(key)}`
                );
                if (changes.length >= limit) break;
            }
            return;
        }

        // 数组按整体记录，促使模型使用绝对值替换，避免索引插入在整楼重放时重复添加。
        changes.push({ path: path || '/', before: old_value, after: new_value });
    };

    visit(before, after, '');
    return changes;
}

/**
 * 将实际状态差异格式化为确认弹窗中的逐行文本。
 * @param changes 需要展示的状态变化。
 * @returns 包含路径和前后值的文本；无变化时返回占位说明。
 */
function formatStateChanges(changes: IncrementalStateChange[]): string {
    if (changes.length === 0) return '（本楼尚无已落地变化）';
    return changes
        .map(
            change =>
                `${change.path}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`
        )
        .join('\n');
}

/**
 * 生成受长度与递归深度限制的值摘要，避免大对象或循环引用撑大提示词。
 * @param value 待展示的变量值。
 * @param limit 摘要字符预算，默认 1000。
 * @returns 仅用于展示的文本，截断时附带标记，不保证是可解析的 JSON。
 */
function boundedStateValue(value: unknown, limit = 1000): string {
    let result = '';
    let truncated = false;
    const ancestors = new Set<object>();
    /** 只追加剩余预算内的字符，并记录是否发生截断。 */
    const append = (part: string) => {
        const remaining = limit - result.length;
        if (part.length > remaining) truncated = true;
        result += part.slice(0, remaining);
    };
    /** 按深度和字符预算展开摘要，遇到祖先对象时输出循环引用占位符。 */
    const visit = (node: unknown, depth: number) => {
        if (result.length >= limit || depth > 12) {
            truncated = true;
            return;
        }
        if (typeof node === 'string') {
            if (node.length > limit) truncated = true;
            append(JSON.stringify(node.slice(0, limit)));
        } else if (node === null || typeof node !== 'object') {
            append(String(node));
        } else if (ancestors.has(node)) {
            append('[循环引用]');
        } else {
            ancestors.add(node);
            const array = Array.isArray(node);
            append(array ? '[' : '{');
            let first = true;
            for (const key in node) {
                if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
                if (result.length >= limit) {
                    truncated = true;
                    break;
                }
                if (!first) append(',');
                first = false;
                if (!array) {
                    if (key.length > limit) truncated = true;
                    append(JSON.stringify(key.slice(0, limit)) + ':');
                }
                visit((node as Record<string, unknown>)[key], depth + 1);
            }
            append(array ? ']' : '}');
            ancestors.delete(node);
        }
    };
    visit(value, 0);
    return truncated ? result.slice(0, limit - 12) + '…[摘要已截断]' : result;
}

/**
 * 在总字符预算内展示变化，并提醒模型不能把未展示数据视为待删除数据。
 * @param changes 当前楼已落地的状态变化。
 * @returns 限制路径、单值及总长度的提示词摘要。
 */
function formatBoundedStateChanges(changes: IncrementalStateChange[]): string {
    if (!changes.length) return '（本楼尚无已落地变化）';
    const budget = 12000;
    let result = '';
    let count = 0;
    for (const change of changes) {
        const path =
            change.path.length > 256 ? change.path.slice(0, 256) + '…[路径截断]' : change.path;
        const line = `${path}: ${boundedStateValue(change.before)} -> ${boundedStateValue(change.after)}\n`;
        if (result.length + line.length > budget - 100) break;
        result += line;
        count++;
    }
    if (count < changes.length) result += `（另有 ${changes.length - count} 项未展示）\n`;
    return result + '（摘要可能截断；完整变量与规则仍是核验依据，不得据此删除未展示数据。）';
}

/**
 * 构造以当前已结算状态为基准的增量校正任务，约束操作范围与应答格式。
 * @param changes 本楼相对上一楼已经落地的变化。
 * @returns 包含校正规则和变化摘要的任务提示词。
 */
export function buildIncrementalRepairTask(changes: IncrementalStateChange[]): string {
    return `<must>
<incremental_repair_directive>
本次是增量变量校正，不是完整重试。

输入解释：
- 当前变量状态是本轮剧情结束且原更新已执行后的结果，不是剧情发生前的状态。
- <past_observe> 中包含最新剧情与原更新；下方清单只用于识别本楼已经落地的变化。
- 变量规则与已注入世界书仍是最终依据；用户补充方向只指定优先核验处，不能创造剧情事实或覆盖规则。

执行边界：
- 仅补充遗漏，或纠正与最新剧情、变量规则明确冲突的错误；已经正确的变化禁止重复输出。
- 不得为了满足完整更新中的固定首项或占位格式，输出与本次校正无关的操作。
- 所有修正都以当前状态为基准，不得从上一楼重新计算；不得重算或覆盖整份变量。
- 已有字段使用 replace 与绝对最终值；禁止 delta、add、move。数组需要修正时 replace 整个数组。
- 仅在规则允许新增字段时使用 insert；确认属于错误字段时才使用 remove；证据不足则保持不变。

输出契约：
- 严格服从本次请求随后给出的应答格式：普通文本模式只输出一个 <UpdateVariable><JSONPatch>...</JSONPatch></UpdateVariable>；格式化输出或工具调用模式则只填写其指定结构。
- 不得附加剧情正文或结构外解释。
- 没有需要修正的内容时输出空 JSONPatch 数组。
</incremental_repair_directive>
<incremental_repair_context>
本楼已落地变化：
${formatBoundedStateChanges(changes)}
</incremental_repair_context>
</must>`;
}

/**
 * 构造末尾核验提示，将用户方向限制为审计重点，避免覆盖变量规则。
 * @param user_direction 用户补充的方向；去除首尾空白后最多保留 500 个字符。
 * @returns 带用户核验重点及最终输出约束的提示词。
 */
export function buildIncrementalRepairPromptTail(user_direction: string = ''): string {
    const direction = user_direction.trim().slice(0, 500);
    return `<incremental_repair_final_check>
遵循增量校正任务，优先核验用户明确指出的方向，但不得越过变量规则与最新剧情事实。
<user_focus>${direction || '（用户未补充方向：自动审计遗漏与明确错误）'}</user_focus>
最终只保留针对当前状态的必要增量操作；不重复已有正确更新，不整表重算，不输出结构外解释。严格服从本次应答格式，结果必须包含可由后处理规范化为标准 <UpdateVariable><JSONPatch> 的合法 JSONPatch 数组。
</incremental_repair_final_check>`;
}

/**
 * 剥离更新块的外层标签，保留待合并的内部内容。
 * @param block 使用兼容更新标签包裹的文本。
 * @returns 去除外层标签及首尾空白后的内容。
 */
function extractUpdateBlockInner(block: string): string {
    return block
        .replace(/^<(?:update(?:variable)?|variableupdate)\b[^>]*>/i, '')
        .replace(/<\/(?:update(?:variable)?|variableupdate)\s*>\s*$/i, '')
        .trim();
}

/**
 * 解析唯一且闭合的补丁块，并检查操作数组结构与 JSON 序列化安全性。
 * 此处不限制操作种类；增量操作白名单由后续校验负责。
 * @param repair_block 待解析的增量校正回复。
 * @returns 补丁操作数组（允许为空）；解析失败、块数量错误或值不安全时返回 null。
 */
function parseIncrementalRepairPatch(repair_block: string): IncrementalRepairOperation[] | null {
    const blocks = findUpdateMarkupBlocks(repair_block, 'patch');
    if (blocks.length !== 1 || !blocks[0].closed) return null;
    try {
        const patch = parseString(
            cleanStructuredUpdate(repair_block.slice(blocks[0].contentStart, blocks[0].contentEnd))
        );
        return isJsonSafe(patch) && isJsonPatch(patch)
            ? (patch as IncrementalRepairOperation[])
            : null;
    } catch {
        return null;
    }
}

/**
 * 拆分并解码增量校正使用的 JSON Pointer 路径。
 * @param path 以斜杠开头的具体变量路径。
 * @returns 解码后的路径片段；缺少前导斜杠或路径仅为 / 时返回 null。
 */
function jsonPointerSegments(path: string): string[] | null {
    if (!path.startsWith('/') || path === '/') return null;
    return path
        .slice(1)
        .split('/')
        .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/**
 * 检查路径是否指向内部数据或包含原型相关字段。
 * @param path 原始 JSON Pointer 路径。
 * @returns 路径不可用或命中受保护字段时返回 true。
 */
function forbiddenPointerPath(path: string): boolean {
    const segments = jsonPointerSegments(path);
    return (
        !segments ||
        FORBIDDEN_ROOT_PATHS.has(segments[0]) ||
        segments.some(segment =>
            ['$internal', '$meta', '__proto__', 'prototype', 'constructor'].includes(segment)
        )
    );
}

/**
 * 递归检查补丁值，阻止借助对象整体替换写入受保护字段。
 * @param value 补丁携带的值，调用前应已通过 JSON 安全性检查。
 * @returns 任意嵌套对象包含内部或原型字段时返回 true。
 */
function containsProtectedPayloadKey(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(containsProtectedPayloadKey);
    if (!_.isPlainObject(value)) return false;
    return Object.entries(value as Record<string, unknown>).some(
        ([key, child]) =>
            ['$internal', '$meta', '__proto__', 'prototype', 'constructor'].includes(key) ||
            containsProtectedPayloadKey(child)
    );
}

/**
 * 将可解析的单个补丁统一为标准更新标签和 JSON 文本。
 * @param repair_block 包含补丁的原始回复。
 * @returns 标准更新块；解析或基础结构检查失败时返回 null。
 */
export function normalizeIncrementalRepairBlock(repair_block: string): string | null {
    const patch = parseIncrementalRepairPatch(repair_block);
    return patch
        ? `<UpdateVariable>\n<JSONPatch>\n${JSON.stringify(patch, null, 2)}\n</JSONPatch>\n</UpdateVariable>`
        : null;
}

/**
 * 将校正内容追加到消息的最后一个更新块中，没有更新块时在正文末尾新增。
 * 保留原更新命令在前，使整楼重放时先执行原更新，再执行绝对值校正。
 * @param message 校正前的完整消息正文。
 * @param repair_block 已规范化的校正更新块。
 * @returns 合并后的完整正文；校正内容为空时返回原文。
 */
export function mergeIncrementalRepairBlock(message: string, repair_block: string): string {
    const repair_inner = extractUpdateBlockInner(repair_block);
    if (!repair_inner) return message;

    const blocks = findUpdateMarkupBlocks(message, 'update');
    const target = blocks.at(-1);
    if (target) {
        const original_inner = message.slice(target.contentStart, target.contentEnd).trim();
        const merged = `<UpdateVariable>\n${original_inner}\n\n${repair_inner}\n</UpdateVariable>`;
        return message.slice(0, target.start) + merged + message.slice(target.end);
    }

    return `${message.trimEnd()}\n\n<UpdateVariable>\n${repair_inner}\n</UpdateVariable>`;
}

/**
 * 读取转换后命令的目标路径并去除参数包装。
 * @param command 已提取的变量更新命令。
 * @returns 清理后的路径字符串。
 */
function commandPath(command: Command): string {
    return trimQuotesAndBackslashes(command.args[0] ?? '').trim();
}

/**
 * 从原始补丁操作中恢复 JSON Pointer，避免使用转换后命令的路径语义。
 * @param command 已提取的变量更新命令。
 * @returns 原始目标路径；非补丁命令、解析失败或缺少路径时返回 null。
 */
function commandJsonPointer(command: Command): string | null {
    if (command.reason !== 'json_patch') return null;
    try {
        const operation = JSON.parse(command.full_match);
        return typeof operation.path === 'string' ? operation.path : null;
    } catch {
        return null;
    }
}

/**
 * 检查转换后的命令仍满足增量约束，拒绝脚本命令、相对更新及内部路径。
 * @param commands 从规范化更新块提取的命令。
 * @returns 首个校验错误；通过时返回 null。
 */
export function validateIncrementalRepairCommands(commands: Command[]): string | null {
    for (const command of commands) {
        if (command.reason !== 'json_patch') {
            return '增量校正仅接受 JSONPatch，不接受脚本式更新命令';
        }
        if (command.type === 'add' || command.type === 'move') {
            return `增量校正不接受 ${command.type} 操作，请改用绝对值 replace`;
        }
        const pointer = commandJsonPointer(command);
        if (!pointer) return 'JSONPatch 操作缺少原始目标路径';
        if (forbiddenPointerPath(pointer)) return `禁止修改 MVU 内部路径：${pointer}`;
        const path = commandPath(command);
        if (!path && command.type !== 'insert') return '存在空变量路径';
    }
    return null;
}

/**
 * 校验原始补丁的块数量、操作白名单、具体路径和受保护字段。
 * @param repair_block 待检查的校正更新块。
 * @returns 首个校验错误；合法补丁（包括空数组）返回 null。
 */
export function validateIncrementalRepairBlock(repair_block: string): string | null {
    const matches = findUpdateMarkupBlocks(repair_block, 'patch');
    if (matches.length !== 1) return '必须且只能返回一个 JSONPatch 补丁块';

    const patch = parseIncrementalRepairPatch(repair_block);
    if (!patch) return 'JSONPatch 内容无法解析或不是合法操作数组';

    for (const operation of patch) {
        const operation_name = String(operation.op);
        if (!['replace', 'insert', 'remove'].includes(operation_name)) {
            return `增量校正不接受 ${operation_name} 操作`;
        }
        if (!operation.path || operation.path === '/' || !operation.path.startsWith('/')) {
            return `增量校正路径必须是具体的 JSON Pointer：${operation.path ?? ''}`;
        }
        if (forbiddenPointerPath(operation.path)) {
            return `禁止修改 MVU 内部路径：${operation.path}`;
        }
        if (containsProtectedPayloadKey(operation.value)) {
            return `补丁值包含内部或原型字段：${operation.path}`;
        }
        if (
            (operation_name === 'replace' || operation_name === 'insert') &&
            !Object.prototype.hasOwnProperty.call(operation, 'value')
        ) {
            return `${operation_name} 操作缺少 value`;
        }
    }
    return null;
}

/**
 * 规范化并校验一次模型回复，供重试策略判断本次结果是否可以接受。
 * @param repair_block 模型返回的校正更新块。
 * @returns 已通过块级和命令级检查的标准更新块，允许空补丁。
 * @throws {Error} 回复无法规范化或不满足增量校正约束。
 */
export function normalizeAndValidateIncrementalRepairResult(repair_block: string): string {
    const normalized = normalizeIncrementalRepairBlock(repair_block);
    if (!normalized) throw new Error('JSONPatch 内容无法解析或数量不正确');
    const block_error = validateIncrementalRepairBlock(normalized);
    if (block_error) throw new Error(block_error);
    const commands = extractCommands(normalized);
    if (commands.length === 0 && EMPTY_JSON_PATCH_RE.test(normalized)) return normalized;
    if (commands.length === 0) throw new Error('JSONPatch 中没有可执行的增量操作');
    const command_error = validateIncrementalRepairCommands(commands);
    if (command_error) throw new Error(command_error);
    return normalized;
}

/**
 * 以当前状态检查补丁目标、重复操作及值转换，不修改传入的状态。
 * 调用前应先通过块级校验；本方法进一步检查路径冲突和集合操作语义。
 * @param repair_block 已通过格式及操作白名单校验的更新块。
 * @param stat_data 当前楼已结算的变量状态。
 * @param strict_set 是否按普通数组处理 [值, 描述] 包装，默认 false。
 * @returns 首个状态校验错误；通过时返回 null。
 */
export function validateIncrementalRepairAgainstState(
    repair_block: string,
    stat_data: Record<string, unknown>,
    strict_set = false
): string | null {
    const patch = parseIncrementalRepairPatch(repair_block);
    if (!patch) return 'JSONPatch 内容无法解析';
    for (const operation of patch) {
        if (containsProtectedPayloadKey(operation.value))
            return `补丁值包含内部或原型字段：${operation.path}`;
    }
    const targets: string[][] = [];
    for (const operation of patch) {
        const segments = jsonPointerSegments(operation.path);
        if (!segments) return `无效路径：${operation.path}`;
        if (forbiddenPointerPath(operation.path))
            return `禁止修改内部或原型路径：${operation.path}`;
        // 拒绝同一路径及祖先/后代路径组合，使每项校正都能独立针对当前快照验证。
        if (
            targets.some(target => {
                const length = Math.min(target.length, segments.length);
                return target.slice(0, length).every((part, index) => part === segments[index]);
            })
        )
            return `补丁包含重复或相互覆盖的路径：${operation.path}`;
        targets.push(segments);
        // 数组内部路径不参与增量操作，避免索引移动导致后续操作目标改变。
        for (let index = 1; index < segments.length; index++) {
            if (Array.isArray(_.get(stat_data, segments.slice(0, index)))) {
                return `数组需要使用 replace 整体校正：${operation.path}`;
            }
        }
        if (operation.op === 'replace' || operation.op === 'remove') {
            if (!_.has(stat_data, segments)) return `目标路径不存在：${operation.path}`;
            if (operation.op === 'replace') {
                const current_value = _.get(stat_data, segments);
                // 与更新器的非 strictSet 语义对齐：[值, 描述] 只比较实际值及其数值转换结果。
                const is_described =
                    !strict_set &&
                    isValueWithDescription(current_value) &&
                    !Array.isArray(current_value[0]);
                if (is_described && isValueWithDescription(operation.value)) {
                    return `带描述变量只能替换实际值，不能替换 [值, 描述] 包装：${operation.path}`;
                }
                const effective_value = is_described ? current_value[0] : current_value;
                const requested_value =
                    typeof effective_value === 'number' &&
                    (is_described ? operation.value !== null : typeof operation.value === 'string')
                        ? Number(operation.value)
                        : operation.value;
                if (typeof requested_value === 'number' && !Number.isFinite(requested_value)) {
                    return `数值目标不能转换为有限数值：${operation.path}`;
                }
                if (_.isEqual(effective_value, requested_value)) {
                    return `目标已经是请求值，请省略重复替换：${operation.path}`;
                }
            }
            continue;
        }
        const parent_segments = segments.slice(0, -1);
        const key = segments.at(-1)!;
        const parent = parent_segments.length === 0 ? stat_data : _.get(stat_data, parent_segments);
        if (Array.isArray(parent)) {
            if (key !== '-' && (!/^\d+$/.test(key) || Number(key) > parent.length)) {
                return `数组插入位置无效：${operation.path}`;
            }
        } else if (_.isPlainObject(parent)) {
            if (Object.prototype.hasOwnProperty.call(parent, key)) {
                return `insert 目标已经存在，请使用 replace：${operation.path}`;
            }
        } else {
            return `insert 的父级不是可写集合：${operation.path}`;
        }
    }
    return null;
}

/**
 * 核对整楼重放后的实际结果，确认每项校正都已完整落地。
 * 调用前应已完成补丁及目标路径校验；此处只核对结果，不执行更新。
 * @param repair_block 已校验的校正更新块。
 * @param before_stat_data 校正前当前楼的变量状态。
 * @param after_stat_data 合并正文并重放后的变量状态。
 * @param strict_set 是否禁止解包带描述变量，默认 false。
 * @returns 首个未完整生效的操作说明；全部匹配时返回 null。
 */
export function verifyIncrementalRepairApplied(
    repair_block: string,
    before_stat_data: Record<string, unknown>,
    after_stat_data: Record<string, unknown>,
    strict_set = false
): string | null {
    const patch = parseIncrementalRepairPatch(repair_block);
    if (!patch) return 'JSONPatch 内容无法解析';
    for (const operation of patch) {
        const segments = jsonPointerSegments(operation.path)!;
        if (operation.op === 'remove') {
            if (_.has(after_stat_data, segments)) return `删除操作未生效：${operation.path}`;
            continue;
        }
        if (operation.op === 'insert') {
            const parent_segments = segments.slice(0, -1);
            const before_parent =
                parent_segments.length === 0
                    ? before_stat_data
                    : _.get(before_stat_data, parent_segments);
            const after_parent =
                parent_segments.length === 0
                    ? after_stat_data
                    : _.get(after_stat_data, parent_segments);
            if (Array.isArray(before_parent)) {
                const key = segments.at(-1)!;
                const index = key === '-' ? before_parent.length : Number(key);
                if (
                    !Array.isArray(after_parent) ||
                    after_parent.length !== before_parent.length + 1 ||
                    !(_.isPlainObject(operation.value) && _.isPlainObject(after_parent[index])
                        ? _.isMatch(after_parent[index], operation.value as Record<string, unknown>)
                        : _.isEqual(after_parent[index], operation.value))
                ) {
                    return `插入操作未完整生效：${operation.path}`;
                }
                continue;
            }
        }
        const before_value = _.get(before_stat_data, segments);
        const after_value = _.get(after_stat_data, segments);
        const effective_after_value =
            !strict_set &&
            Array.isArray(before_value) &&
            before_value.length === 2 &&
            !Array.isArray(before_value[0]) &&
            typeof before_value[1] === 'string' &&
            Array.isArray(after_value) &&
            after_value.length === 2 &&
            typeof after_value[1] === 'string'
                ? after_value[0]
                : after_value;
        const expected_value = operation.value;
        // insert 可能由 schema 补充默认字段，只要求请求字段匹配；replace 必须与目标值完全一致。
        const value_matches =
            operation.op === 'insert' &&
            _.isPlainObject(expected_value) &&
            _.isPlainObject(effective_after_value)
                ? _.isMatch(
                      effective_after_value as Record<string, unknown>,
                      expected_value as Record<string, unknown>
                  )
                : _.isEqual(effective_after_value, expected_value);
        if (!_.has(after_stat_data, segments) || !value_matches) {
            return `${operation.op === 'replace' ? '替换' : '插入'}操作未完整生效：${operation.path}`;
        }
    }
    return null;
}

/**
 * 为单项校正生成预览 HTML，对路径和值进行转义。
 * @param command 已校验的校正命令。
 * @returns 展示动作、目标路径及新值的列表项 HTML。
 */
function commandPreview(command: Command): string {
    const path = _.escape(commandJsonPointer(command) ?? commandPath(command));
    const action_labels: Partial<Record<Command['type'], string>> = {
        set: '改为',
        insert: '新增',
        delete: '删除',
    };
    const action = action_labels[command.type];
    if (command.type === 'delete') return `<li><code>${path}</code>：${action}</li>`;
    const raw_value = command.type === 'insert' ? command.args.at(-1) : command.args[1];
    const value = _.escape(JSON.stringify(parseCommandValue(raw_value ?? '')));
    return `<li><code>${path}</code>：${action ?? command.type} <code>${value}</code></li>`;
}

/**
 * 生成应用校正前的确认内容，展示操作列表和原始补丁。
 * @param commands 已校验且待确认的命令。
 * @param repair_block 已规范化的补丁文本。
 * @returns 可用于确认弹窗的 HTML，动态补丁内容已转义。
 */
function buildPreviewHtml(commands: Command[], repair_block: string): string {
    return `<h3>${tr('runtime.incrementalRepair.previewTitle')}</h3>
<p>${tr('runtime.incrementalRepair.previewDescription', { count: commands.length })}</p>
<ol>${commands.map(commandPreview).join('')}</ol>
<details><summary>${tr('runtime.incrementalRepair.showRawPatch')}</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${_.escape(repair_block)}</pre></details>`;
}

/**
 * 读取楼层当前选中的候选回复编号。
 * @param message_id 消息楼层编号。
 * @returns 数值形式的候选编号；缺失或转换结果不可用时返回 0。
 */
function getSwipeId(message_id: number): number {
    return Number(_.get(SillyTavern.chat, [message_id, 'swipe_id'], 0)) || 0;
}

/**
 * 深拷贝 MVU 持久化字段，隔离后续更新并保留字段缺失状态。
 * @param source 消息或聊天变量对象。
 * @returns 仅包含 MVU 持久化字段的快照。
 */
function snapshotPersistedMvuData(source: Record<string, unknown>): PersistedMvuSnapshot {
    const snapshot: PersistedMvuSnapshot = {};
    for (const key of PERSISTED_MVU_KEYS) {
        if (_.has(source, key)) snapshot[key] = klona(_.get(source, key));
    }
    return snapshot;
}

/**
 * 比较当前 MVU 持久化字段与预期快照，忽略其他扩展维护的数据。
 * @param source 当前变量对象。
 * @param expected 提交或撤销前必须匹配的快照。
 * @returns 所有 MVU 持久化字段及其存在状态一致时返回 true。
 */
function persistedSnapshotMatches(
    source: Record<string, unknown>,
    expected: PersistedMvuSnapshot
): boolean {
    return _.isEqual(snapshotPersistedMvuData(source), expected);
}

/**
 * 将等待期间发生的元数据变化覆盖到重放结果，原地更新目标快照。
 * 未变化的字段保留重放值；对象按键递归合并，删除、数组及类型变化整体覆盖。
 * @param baseline 发起校正时的元数据快照。
 * @param latest 准备应用校正时读取的最新快照。
 * @param target 接收元数据变化的重放结果。
 * @param keys 允许覆盖的持久化字段，默认排除 stat_data。
 */
function rebaseMetadataRefreshes(
    baseline: PersistedMvuSnapshot,
    latest: PersistedMvuSnapshot,
    target: PersistedMvuSnapshot,
    keys: (typeof PERSISTED_MVU_KEYS)[number][] = [
        'schema',
        'display_data',
        'delta_data',
        'initialized_lorebooks',
    ]
) {
    /** 仅将基线之后发生的变化递归覆盖到重放值上，未变化的键保留重放结果。 */
    const overlay = (before: unknown, after: unknown, replayed: unknown): unknown => {
        if (_.isEqual(before, after)) return replayed;
        if (!_.isPlainObject(before) || !_.isPlainObject(after) || !_.isPlainObject(replayed))
            return klona(after);
        const result = { ...(replayed as Record<string, unknown>) };
        const old = before as Record<string, unknown>;
        const current = after as Record<string, unknown>;
        for (const key of new Set([...Object.keys(old), ...Object.keys(current)])) {
            const had = Object.prototype.hasOwnProperty.call(old, key);
            const has = Object.prototype.hasOwnProperty.call(current, key);
            if (had === has && _.isEqual(old[key], current[key])) continue;
            if (!has) delete result[key];
            else
                Object.defineProperty(result, key, {
                    value: had ? overlay(old[key], current[key], result[key]) : klona(current[key]),
                    writable: true,
                    enumerable: true,
                    configurable: true,
                });
        }
        return result;
    };
    for (const key of keys) {
        if (_.has(baseline, key) === _.has(latest, key) && _.isEqual(baseline[key], latest[key]))
            continue;
        if (!_.has(latest, key)) delete target[key];
        else target[key] = overlay(baseline[key], latest[key], target[key]);
    }
}

/**
 * 仅比较实际变量状态，用于允许等待期间发生无关的元数据刷新。
 * @param source 当前变量对象。
 * @param expected 请求锚点中的快照。
 * @returns stat_data 与快照一致时返回 true。
 */
function statDataMatchesSnapshot(
    source: Record<string, unknown>,
    expected: PersistedMvuSnapshot
): boolean {
    return _.isEqual(_.get(source, 'stat_data'), expected.stat_data);
}

/**
 * 检查当前聊天、末楼、候选回复、正文及聊天变量同步设置是否仍匹配锚点。
 * @param anchor 发起校正时捕获的目标身份。
 * @param expected_content 预期正文，默认使用原文；撤销时传入校正后的正文。
 * @returns 所有目标身份条件一致时返回 true。
 */
function anchorIdentityStillMatches(
    anchor: RepairAnchor,
    expected_content = anchor.message_content
) {
    if (SillyTavern.getCurrentChatId() !== anchor.chat_id) return false;
    if (getLastMessageId() !== anchor.message_id) return false;
    if (getSwipeId(anchor.message_id) !== anchor.swipe_id) return false;
    if (useDataStore().effective_settings.兼容性.更新到聊天变量 !== anchor.update_chat_variables) {
        return false;
    }
    const current_message = getChatMessages(anchor.message_id).at(-1);
    return current_message?.message === expected_content;
}

/**
 * 检查异步等待后校正目标与实际变量状态是否仍有效。
 * 派生元数据允许刷新，真正写入时再比较完整持久化快照。
 * @param anchor 发起校正时的目标身份和状态快照。
 * @returns 目标身份及需要同步的变量状态均未变化时返回 true。
 */
function anchorStillMatches(anchor: RepairAnchor): boolean {
    if (!anchorIdentityStillMatches(anchor)) return false;
    const current_variables = getVariables({ type: 'message', message_id: anchor.message_id });
    if (!isMvuData(current_variables)) return false;
    // 等待期间 MVU 或其他扩展可能刷新派生元数据，应用前会合并这些变化。
    // 此处仅因 stat_data 改变而使结果失效；提交时仍需比较完整快照。
    if (!statDataMatchesSnapshot(current_variables, anchor.message_variables)) return false;
    if (anchor.update_chat_variables) {
        const current_chat_variables = getVariables({ type: 'chat' });
        if (!statDataMatchesSnapshot(current_chat_variables, anchor.chat_variables)) return false;
    }
    return true;
}

/**
 * 同步提交正文、候选回复和变量快照，保存或渲染交给调用方随后执行。
 * 先核对完整快照，再一次性更新内存字段；赋值失败时恢复原有引用。
 * @param anchor 校正目标身份及聊天变量同步设置。
 * @param expected_content 写入前必须匹配的正文。
 * @param content 将写入的完整正文。
 * @param expected_message 写入前必须匹配的消息变量快照。
 * @param expected_chat 启用聊天变量同步时必须匹配的聊天变量快照。
 * @param next_message 待写入的消息变量快照。
 * @param next_chat 启用聊天变量同步时待写入的聊天变量快照。
 * @throws {Error} 目标身份或持久化状态已变化；字段赋值异常也会回滚后抛出。
 */
function commitRepair(
    anchor: RepairAnchor,
    expected_content: string,
    content: string,
    expected_message: PersistedMvuSnapshot,
    expected_chat: PersistedMvuSnapshot,
    next_message: PersistedMvuSnapshot,
    next_chat: PersistedMvuSnapshot
) {
    if (!anchorIdentityStillMatches(anchor, expected_content))
        throw new Error('增量校正目标已变化');
    const message = SillyTavern.chat[anchor.message_id];
    const metadata = SillyTavern.chatMetadata;
    const message_variables = _.get(message, ['variables', anchor.swipe_id], {});
    const chat_variables = _.get(metadata, 'variables', {});
    if (
        !persistedSnapshotMatches(message_variables, expected_message) ||
        (anchor.update_chat_variables && !persistedSnapshotMatches(chat_variables, expected_chat))
    ) {
        throw new Error('增量校正目标在写入期间发生变化');
    }
    /** 仅替换 MVU 持久化字段，保留其他扩展的数据，并同步快照中的字段删除。 */
    const mergeSnapshot = (data: Record<string, any>, snapshot: PersistedMvuSnapshot) => {
        const result = klona(data);
        for (const key of PERSISTED_MVU_KEYS) {
            if (_.has(snapshot, key)) result[key] = klona(snapshot[key]);
            else delete result[key];
        }
        return result;
    };
    // 所有深拷贝与合并先在局部完成，真正赋值阶段不包含 await，避免聊天切换打断内存提交。
    const next_variables = klona(message.variables ?? []);
    next_variables[anchor.swipe_id] = mergeSnapshot(message_variables, next_message);
    const next_swipes = message.swipes ? [...message.swipes] : undefined;
    if (next_swipes) next_swipes[anchor.swipe_id] = content;
    const next_metadata = anchor.update_chat_variables
        ? mergeSnapshot(chat_variables, next_chat)
        : undefined;
    // 保留原始字段引用及存在状态，赋值异常时同步恢复，避免只恢复内容却丢失原对象身份。
    const fields = ['mes', 'variables', 'swipes'] as const;
    const before = fields.map(key => ({ key, exists: _.has(message, key), value: message[key] }));
    const metadata_had_variables = _.has(metadata, 'variables');
    const metadata_variables = metadata.variables;
    try {
        message.mes = content;
        message.variables = next_variables;
        if (next_swipes) message.swipes = next_swipes;
        if (anchor.update_chat_variables) metadata.variables = next_metadata;
    } catch (error) {
        for (const field of before) {
            if (field.exists) _.set(message, field.key, field.value);
            else _.unset(message, field.key);
        }
        if (anchor.update_chat_variables) {
            if (metadata_had_variables) metadata.variables = metadata_variables;
            else delete metadata.variables;
        }
        throw error;
    }
}

/**
 * 保存已提交的聊天，并在仍处于原聊天和候选回复时刷新目标楼层。
 * 保存或渲染失败仅报告警告，不回滚已经一致提交的内存状态。
 * @param anchor 已提交校正的目标身份。
 * @returns 保存和可选刷新处理完成后兑现的 Promise。
 */
async function saveAndRefreshRepair(anchor: RepairAnchor) {
    // 内存事务已经完整提交；保存或渲染失败时不能在聊天可能切换后回滚目标数据。
    try {
        await SillyTavern.saveChat();
        if (
            SillyTavern.getCurrentChatId() === anchor.chat_id &&
            getSwipeId(anchor.message_id) === anchor.swipe_id
        ) {
            await setChatMessages([{ message_id: anchor.message_id }], { refresh: 'affected' });
        }
    } catch (error) {
        console.error('[MVU] repair committed but save/refresh failed', error);
        toastr.warning(
            '变量与正文已同步更新，但保存或刷新失败，请检查连接并保存聊天',
            tr('runtime.incrementalRepair.title')
        );
    }
}

/**
 * 显示可点击撤销的成功提示，撤销时要求正文和完整持久化快照仍匹配。
 * 本方法仅注册点击回调，不等待用户点击；撤销复用同步提交和保存流程。
 * @param anchor 校正目标及原始正文。
 * @param original_message_variables 应用前的消息变量快照。
 * @param original_chat_variables 应用前的聊天变量快照。
 * @param applied_variables 应用后的消息变量快照，作为撤销前置条件。
 * @param applied_chat_variables 应用后的聊天变量快照，作为撤销前置条件。
 * @param repaired_content 应用后的正文，作为撤销前置条件。
 */
async function offerUndo(
    anchor: RepairAnchor,
    original_message_variables: PersistedMvuSnapshot,
    original_chat_variables: PersistedMvuSnapshot,
    applied_variables: PersistedMvuSnapshot,
    applied_chat_variables: PersistedMvuSnapshot,
    repaired_content: string
) {
    toastr.success(
        tr('runtime.incrementalRepair.appliedClickToUndo'),
        tr('runtime.incrementalRepair.title'),
        {
            timeOut: 12000,
            extendedTimeOut: 3000,
            onclick: async () => {
                try {
                    commitRepair(
                        anchor,
                        repaired_content,
                        anchor.message_content,
                        applied_variables,
                        applied_chat_variables,
                        original_message_variables,
                        original_chat_variables
                    );
                    await saveAndRefreshRepair(anchor);
                    toastr.info(
                        tr('runtime.incrementalRepair.undone'),
                        tr('runtime.incrementalRepair.title')
                    );
                } catch (error) {
                    console.error('[MVU] incremental repair undo rejected', error);
                    toastr.warning(
                        tr('runtime.incrementalRepair.undoStateChanged'),
                        tr('runtime.incrementalRepair.title')
                    );
                }
            },
        }
    );
}

/**
 * 执行末楼增量校正：采集用户方向、请求并校验补丁、预览后重放整楼并提交。
 * 异步边界后检查目标是否变化；实际结果被规则修改时再次确认，成功后提供撤销。
 * 同一时刻只允许一次流程，错误通过日志及提示报告，并在退出时释放运行标记。
 * @returns 本次校正流程完成或提前退出后兑现的 Promise。
 */
export async function runIncrementalExtraModelRepair() {
    if (is_incremental_repair_in_progress) {
        toastr.info(
            tr('runtime.incrementalRepair.alreadyRunning'),
            tr('runtime.incrementalRepair.title')
        );
        return;
    }

    const store = useDataStore();
    if (store.effective_settings.更新方式 === '随AI输出') {
        toastr.info(
            tr('runtime.button.extraModelNotEnabled'),
            tr('runtime.incrementalRepair.title')
        );
        return;
    }
    if (store.settings.额外模型解析配置.应答格式 === '工具调用' && !isFunctionCallingSupported()) {
        toastr.info(
            tr('runtime.button.extraModelToolCallingUnsupported'),
            tr('runtime.incrementalRepair.title')
        );
        return;
    }
    is_incremental_repair_in_progress = true;
    try {
        if (!(await isExtraModelSupported())) {
            toastr.info(
                tr('runtime.button.extraModelUnsupportedByCard'),
                tr('runtime.incrementalRepair.title')
            );
            return;
        }

        const message_id = getLastMessageId();
        const current_message = getChatMessages(message_id).at(-1);
        const current_variables = getVariables({ type: 'message', message_id });
        const previous_variables = getLastValidVariable(message_id);
        if (
            message_id < 1 ||
            current_message?.role !== 'assistant' ||
            !isMvuData(current_variables) ||
            !previous_variables
        ) {
            toastr.warning(
                tr('runtime.incrementalRepair.noUsableFloor'),
                tr('runtime.incrementalRepair.title')
            );
            return;
        }

        let original_data = klona(current_variables);
        const original_chat_variables = getVariables({ type: 'chat' });
        const update_chat_variables = store.effective_settings.兼容性.更新到聊天变量;
        let original_message_snapshot = snapshotPersistedMvuData(current_variables);
        let original_chat_snapshot = snapshotPersistedMvuData(original_chat_variables);
        const anchor: RepairAnchor = {
            chat_id: SillyTavern.getCurrentChatId(),
            message_id,
            swipe_id: getSwipeId(message_id),
            message_content: current_message.message,
            message_variables: original_message_snapshot,
            chat_variables: original_chat_snapshot,
            update_chat_variables,
        };
        const changes = collectIncrementalStateChanges(
            previous_variables.stat_data,
            current_variables.stat_data
        );
        const direction_result = await SillyTavern.callGenericPopup(
            tr('runtime.incrementalRepair.directionPrompt'),
            SillyTavern.POPUP_TYPE.INPUT,
            ''
        );
        // 确认输入返回字符串，空字符串表示自动审计；取消返回 false，关闭或 Escape 返回 null。
        // 因此只判断类型，不能把用户确认的空方向当成取消。
        if (typeof direction_result !== 'string') return;
        if (!anchorStillMatches(anchor)) {
            toastr.warning(
                tr('runtime.incrementalRepair.sourceChanged'),
                tr('runtime.incrementalRepair.title')
            );
            return;
        }
        const user_direction = direction_result.slice(0, 500);
        const repair_block = await invokeExtraModelWithStrategy({
            task: buildIncrementalRepairTask(changes),
            user_input: buildIncrementalRepairPromptTail(user_direction),
            // 将格式和当前状态校验放入每次尝试中，非法回复触发策略重试，而非直接进入预览。
            validate_result: result => {
                const normalized = normalizeAndValidateIncrementalRepairResult(result);
                const state_error = validateIncrementalRepairAgainstState(
                    normalized,
                    original_data.stat_data,
                    original_data.schema?.strictSet ?? false
                );
                if (state_error) throw new Error(state_error);
                return normalized;
            },
        });
        if (repair_block === null) {
            toastr.error(
                tr('runtime.incrementalRepair.requestFailed'),
                tr('runtime.incrementalRepair.title')
            );
            return;
        }
        if (!anchorStillMatches(anchor)) {
            toastr.warning(
                tr('runtime.incrementalRepair.sourceChanged'),
                tr('runtime.incrementalRepair.title')
            );
            return;
        }

        const normalized_repair_block = normalizeIncrementalRepairBlock(repair_block);
        if (!normalized_repair_block) {
            toastr.warning(
                'JSONPatch 内容无法解析或数量不正确',
                tr('runtime.incrementalRepair.title')
            );
            return;
        }
        const block_error = validateIncrementalRepairBlock(normalized_repair_block);
        if (block_error) {
            toastr.warning(_.escape(block_error), tr('runtime.incrementalRepair.title'));
            return;
        }

        const commands = extractCommands(normalized_repair_block);
        if (commands.length === 0 && EMPTY_JSON_PATCH_RE.test(normalized_repair_block)) {
            toastr.info(
                tr('runtime.incrementalRepair.noChanges'),
                tr('runtime.incrementalRepair.title')
            );
            return;
        }
        if (commands.length === 0) {
            toastr.warning(
                tr('runtime.incrementalRepair.invalidPatch'),
                tr('runtime.incrementalRepair.title')
            );
            return;
        }
        const command_error = validateIncrementalRepairCommands(commands);
        if (command_error) {
            toastr.warning(_.escape(command_error), tr('runtime.incrementalRepair.title'));
            return;
        }
        const state_error = validateIncrementalRepairAgainstState(
            normalized_repair_block,
            original_data.stat_data,
            original_data.schema?.strictSet ?? false
        );
        if (state_error) {
            toastr.warning(_.escape(state_error), tr('runtime.incrementalRepair.title'));
            return;
        }

        const confirmation = await SillyTavern.callGenericPopup(
            buildPreviewHtml(commands, normalized_repair_block),
            SillyTavern.POPUP_TYPE.CONFIRM,
            '',
            {
                okButton: tr('runtime.incrementalRepair.applyButton'),
                cancelButton: tr('runtime.incrementalRepair.cancelButton'),
                allowVerticalScrolling: true,
                leftAlign: true,
                wide: true,
            }
        );
        if (confirmation !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
        if (!anchorStillMatches(anchor)) {
            toastr.warning(
                tr('runtime.incrementalRepair.sourceChanged'),
                tr('runtime.incrementalRepair.title')
            );
            return;
        }

        // 接纳等待期间的派生元数据刷新，并将最新完整快照用于提交前比较及撤销。
        // 后续若再有并发写入，commitRepair 会拒绝覆盖。
        const latest_message_variables = getVariables({ type: 'message', message_id });
        const latest_chat_variables = getVariables({ type: 'chat' });
        if (!isMvuData(latest_message_variables)) {
            toastr.warning(
                tr('runtime.incrementalRepair.sourceChanged'),
                tr('runtime.incrementalRepair.title')
            );
            return;
        }
        original_data = klona(latest_message_variables);
        original_message_snapshot = snapshotPersistedMvuData(latest_message_variables);
        original_chat_snapshot = snapshotPersistedMvuData(latest_chat_variables);

        if (!_.isEqual(getLastValidVariable(message_id), previous_variables)) {
            toastr.warning(
                tr('runtime.incrementalRepair.sourceChanged'),
                tr('runtime.incrementalRepair.title')
            );
            return;
        }
        // 先将校正合入完整正文，再从上一楼重放一次，确保持久化文本与最终状态一致。
        // 若在已结算的当前楼快照上再运行整楼生命周期钩子，会重复结算。
        const repaired_content = mergeIncrementalRepairBlock(
            anchor.message_content,
            normalized_repair_block
        );
        const applied_data = klona(previous_variables);
        // 当前楼新增的世界书初始化记录无法从上一楼恢复，必须保留；
        // 等待期间外部更新的 schema 也要在重放前合入，使执行遵循最新规则。
        if (_.has(original_data, 'initialized_lorebooks')) {
            applied_data.initialized_lorebooks = klona(original_data.initialized_lorebooks);
        } else _.unset(applied_data, 'initialized_lorebooks');
        rebaseMetadataRefreshes(anchor.message_variables, original_message_snapshot, applied_data, [
            'schema',
        ]);
        await updateVariables(repaired_content, applied_data);
        if (
            !anchorStillMatches(anchor) ||
            !_.isEqual(getLastValidVariable(message_id), previous_variables)
        ) {
            toastr.warning(
                tr('runtime.incrementalRepair.sourceChanged'),
                tr('runtime.incrementalRepair.title')
            );
            return;
        }
        rebaseMetadataRefreshes(anchor.message_variables, original_message_snapshot, applied_data, [
            'schema',
            'display_data',
            'delta_data',
        ]);
        if (!isJsonSafe(applied_data.stat_data)) {
            throw new Error('整楼重算产生了非 JSON 安全的变量值，已拒绝写入');
        }
        const application_error = verifyIncrementalRepairApplied(
            normalized_repair_block,
            original_data.stat_data,
            applied_data.stat_data,
            applied_data.schema?.strictSet ?? false
        );
        if (application_error) {
            // schema 转换和楼层结算钩子可能合法地改变模型值，因此展示实际差异再次确认。
            // 不重复运行钩子，也不静默丢弃可能相互依赖的操作。
            const actual_changes = collectIncrementalStateChanges(
                original_data.stat_data,
                applied_data.stat_data
            );
            const normalized_confirmation = await SillyTavern.callGenericPopup(
                '<h3>确认整楼重算结果</h3><p>' +
                    _.escape(application_error) +
                    '</p><p>变量规则或结算事件改变了模型提出的值。以下是最终实际变化；确认后同时写回完整更新块与此状态。</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">' +
                    _.escape(formatStateChanges(actual_changes)) +
                    '</pre>',
                SillyTavern.POPUP_TYPE.CONFIRM,
                '',
                {
                    okButton: tr('runtime.incrementalRepair.applyButton'),
                    cancelButton: tr('runtime.incrementalRepair.cancelButton'),
                    allowVerticalScrolling: true,
                    wide: true,
                }
            );
            if (normalized_confirmation !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
        }
        if (
            !anchorStillMatches(anchor) ||
            !_.isEqual(getLastValidVariable(message_id), previous_variables)
        ) {
            toastr.warning(
                tr('runtime.incrementalRepair.sourceChanged'),
                tr('runtime.incrementalRepair.title')
            );
            return;
        }
        const applied_snapshot = snapshotPersistedMvuData(applied_data);
        const applied_chat_snapshot = klona(applied_snapshot);
        rebaseMetadataRefreshes(
            anchor.chat_variables,
            original_chat_snapshot,
            applied_chat_snapshot
        );
        commitRepair(
            anchor,
            anchor.message_content,
            repaired_content,
            original_message_snapshot,
            original_chat_snapshot,
            applied_snapshot,
            applied_chat_snapshot
        );
        await saveAndRefreshRepair(anchor);

        await offerUndo(
            anchor,
            original_message_snapshot,
            original_chat_snapshot,
            applied_snapshot,
            applied_chat_snapshot,
            repaired_content
        );
    } catch (error) {
        console.error('[MVU] incremental extra-model repair failed', error);
        toastr.error(
            tr('runtime.incrementalRepair.requestFailed'),
            tr('runtime.incrementalRepair.title')
        );
    } finally {
        is_incremental_repair_in_progress = false;
    }
}
