import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { isFunctionCallingSupported } from '@/function/is_function_calling_supported';
import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import { type Command, extractCommands, updateVariables } from '@/function/update_variables';
import { tr } from '@/i18n';
import { useDataStore } from '@/store';
import { getLastValidVariable } from '@/util';
import { isMvuData, type MvuData } from '@/variable_def';
import { closeUpdateMarkup, findUpdateMarkupBlocks } from './structured_update';
import { klona } from 'klona';

const PERSISTED_MVU_KEYS = [
    'initialized_lorebooks',
    'stat_data',
    'schema',
    'display_data',
    'delta_data',
] as const;

type PersistedMvuSnapshot = Partial<Record<(typeof PERSISTED_MVU_KEYS)[number], unknown>>;

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
 * 补齐原文末尾的未闭合边界后，追加独立的校正补丁，保留原文的所有字符及命令顺序。
 *
 * 原文兼容形态：裸脚本、多行脚本、单个或多个 JSONPatch、脚本与补丁混排，
 * JSON/JSON5/YAML 补丁及其代码围栏、UpdateVariable/VariableUpdate/Update 包装，
 * 多个或嵌套包装、标签大小写/属性、剧情文本、闭合思考区及数据中的标签字面量。
 * 未闭合 UpdateVariable 不影响提取，但仍在新补丁前补齐；行注释用换行结束，
 * 字符串、块注释、思考标签、残缺 JSONPatch 和围栏则由共享扫描器的尾部状态闭合。
 * 原本被忽略的残缺补丁保持不可执行，不通过补齐其 JSON 数据激活旧操作。
 *
 * @param message 校正前的完整正文。
 * @param repair_block 已通过副本试执行的更新文本；JSONPatch 保留为独立块，兼容脚本原样追加。
 * @returns 原文、必要闭合文本及校正内容；校正内容为空时返回原文。
 */
export function appendIncrementalRepairBlock(message: string, repair_block: string): string {
    let content = repair_block.trim();
    if (!content) return message;
    const wrappers = findUpdateMarkupBlocks(content, 'update');
    const outer = wrappers.length === 1 ? wrappers[0] : undefined;
    if (outer?.closed && outer.start === 0 && outer.end === content.length) {
        // 仅移除校正回复完整的外层包装，使 JSONPatch 直接追加在原文底部。
        // 不修改原文标签，也不重新解析补丁数组或把兼容脚本转换成 JSONPatch。
        content = content.slice(outer.contentStart, outer.contentEnd).trim();
    }
    return content ? `${message}${closeUpdateMarkup(message)}\n${content}` : message;
}

/**
 * 在最新变量的深拷贝上试执行校正，复用正常更新及其回调的实际执行规则。
 * 仅接受没有原生或 MVU Zod 错误且变量发生变化的结果，不修改传入的变量上下文。
 * @param repair_block 模型返回的更新文本，解析和操作规则全部由 updateVariables 决定。
 * @param variables 当前楼最新的完整变量数据，包含 schema 及回调所需的上下文。
 * @returns 执行错误或无实际变化的说明；试执行成功时返回 null。
 * @throws 更新器或回调抛出的异常，交由调用方的重试或错误处理流程接收。
 */
export async function validateIncrementalRepairAgainstState(
    repair_block: string,
    variables: MvuData
): Promise<string | null> {
    const trial_variables = klona(variables);
    const errors: string[] = [];
    const is_modified = await updateVariables(repair_block, trial_variables, errors);
    if (errors.length > 0) return errors.join('\n');
    if (!is_modified) return tr('runtime.incrementalRepair.noEffectiveChanges');
    return null;
}

/**
 * 生成应用校正前的确认内容，展示提取器识别的命令原文和完整更新文本。
 * @param commands 按普通更新流程提取的命令，仅用于预览。
 * @param repair_block 已通过试执行的更新文本。
 * @returns 可用于确认弹窗的 HTML，动态补丁内容已转义。
 */
function buildPreviewHtml(commands: Command[], repair_block: string): string {
    return `<h3>${tr('runtime.incrementalRepair.previewTitle')}</h3>
<p>${tr('runtime.incrementalRepair.previewDescription', { count: commands.length })}</p>
<ol>${commands.map(command => `<li><code>${_.escape(command.full_match)}</code></li>`).join('')}</ol>
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
 * 解析与执行遵循 updateVariables；异步边界后检查目标是否变化，成功后提供撤销。
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
        /** 每次试执行都读取最新变量，并在异步回调结束后重新确认校正目标未改变。 */
        const validateAgainstLatestState = async (block: string): Promise<string | null> => {
            if (!anchorStillMatches(anchor)) return tr('runtime.incrementalRepair.sourceChanged');
            const latest_variables = getVariables({ type: 'message', message_id });
            if (!isMvuData(latest_variables)) return tr('runtime.incrementalRepair.sourceChanged');
            const error = await validateIncrementalRepairAgainstState(block, latest_variables);
            if (!anchorStillMatches(anchor)) return tr('runtime.incrementalRepair.sourceChanged');
            return error;
        };

        const user_direction = direction_result.slice(0, 500);
        const repair_block = await invokeExtraModelWithStrategy({
            task: buildIncrementalRepairTask(changes),
            user_input: buildIncrementalRepairPromptTail(user_direction),
            // 试执行错误或无实际变化都使本次尝试失败；策略等待异步校验后才接受回复。
            validate_result: async result => {
                const state_error = await validateAgainstLatestState(result);
                if (state_error) throw new Error(state_error);
                return result;
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

        const state_error = await validateAgainstLatestState(repair_block);
        if (state_error) {
            toastr.warning(_.escape(state_error), tr('runtime.incrementalRepair.title'));
            return;
        }

        // 与执行器一样先替换宏再提取命令；预览展示原始命令，不再自行解释补丁操作或参数。
        const commands = extractCommands(substitudeMacros(repair_block));
        const confirmation = await SillyTavern.callGenericPopup(
            buildPreviewHtml(commands, repair_block),
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
        const original_data = klona(latest_message_variables);
        original_message_snapshot = snapshotPersistedMvuData(latest_message_variables);
        original_chat_snapshot = snapshotPersistedMvuData(latest_chat_variables);

        if (!_.isEqual(getLastValidVariable(message_id), previous_variables)) {
            toastr.warning(
                tr('runtime.incrementalRepair.sourceChanged'),
                tr('runtime.incrementalRepair.title')
            );
            return;
        }
        // 先闭合原文残留边界并在底部追加校正，再从上一楼重放一次，保持正文与状态一致。
        // 若在已结算的当前楼快照上再运行整楼生命周期钩子，会重复结算。
        const repaired_content = appendIncrementalRepairBlock(anchor.message_content, repair_block);
        const applied_data = klona(previous_variables);
        // 当前楼新增的世界书初始化记录无法从上一楼恢复，必须保留；
        // 等待期间外部更新的 schema 也要在重放前合入，使执行遵循最新规则。
        if (_.has(original_data, 'initialized_lorebooks')) {
            applied_data.initialized_lorebooks = klona(original_data.initialized_lorebooks);
        } else _.unset(applied_data, 'initialized_lorebooks');
        rebaseMetadataRefreshes(anchor.message_variables, original_message_snapshot, applied_data, [
            'schema',
        ]);
        // 整楼重放沿用已有更新行为；原正文的历史错误不作为新增的拒绝条件。
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
