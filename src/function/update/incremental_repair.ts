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
import { klona } from 'klona';

const UPDATE_BLOCK_RE =
    /<(?:update(?:variable)?|variableupdate)\b[^>]*>[\s\S]*?<\/(?:update(?:variable)?|variableupdate)\s*>/gi;
const UPDATE_BLOCK_PART_RE = /<(?:update(?:variable)?|variableupdate)\b[^>]*>[\s\S]*$/i;
const EMPTY_JSON_PATCH_RE =
    /<json_?patch\b[^>]*>\s*(?:```[^\n]*\s*)?\[\s*\](?:\s*```)?\s*<\/json_?patch\s*>/i;
const JSON_PATCH_BLOCK_RE = /<json_?patch\b[^>]*>([\s\S]*?)<\/json_?patch\s*>/gi;
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

function encodePathSegment(segment: string): string {
    return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function collectIncrementalStateChanges(
    before: unknown,
    after: unknown,
    limit: number = 120
): IncrementalStateChange[] {
    const changes: IncrementalStateChange[] = [];

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

        // Arrays are kept atomic. This makes the model correct a collection with one absolute
        // replacement instead of emitting index inserts that may duplicate on a later replay.
        changes.push({ path: path || '/', before: old_value, after: new_value });
    };

    visit(before, after, '');
    return changes;
}

function formatStateChanges(changes: IncrementalStateChange[]): string {
    if (changes.length === 0) return '（本楼尚无已落地变化）';
    return changes
        .map(
            change =>
                `${change.path}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`
        )
        .join('\n');
}

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
${formatStateChanges(changes)}
</incremental_repair_context>
</must>`;
}

export function buildIncrementalRepairPromptTail(user_direction: string = ''): string {
    const direction = user_direction.trim().slice(0, 500);
    return `<incremental_repair_final_check>
遵循增量校正任务，优先核验用户明确指出的方向，但不得越过变量规则与最新剧情事实。
<user_focus>${direction || '（用户未补充方向：自动审计遗漏与明确错误）'}</user_focus>
最终只保留针对当前状态的必要增量操作；不重复已有正确更新，不整表重算，不输出结构外解释。严格服从本次应答格式，结果必须包含可由后处理规范化为标准 <UpdateVariable><JSONPatch> 的合法 JSONPatch 数组。
</incremental_repair_final_check>`;
}

/** Mask JSON string contents while retaining UTF-16 offsets for wrapper matching. */
function structuralMessage(message: string): string {
    const chars = message.split('');
    let in_patch = false;
    let quoted = false;
    let escaped = false;
    for (let i = 0; i < chars.length; i++) {
        if (in_patch && quoted) {
            const char = chars[i];
            chars[i] = ' ';
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quoted = false;
            continue;
        }
        if (in_patch && chars[i] === '"') {
            quoted = true;
            chars[i] = ' ';
        } else if (chars[i] === '<') {
            const tag = message.slice(i).match(/^<(\/?)json_?patch\s*>/i);
            if (tag) in_patch = tag[1] !== '/';
        }
    }
    return chars.join('');
}

function completeUpdateBlocks(message: string) {
    return [...structuralMessage(message).matchAll(UPDATE_BLOCK_RE)].map(match => ({
        index: match.index!,
        text: message.slice(match.index!, match.index! + match[0].length),
    }));
}

export function extractLatestUpdateVariableBlock(message: string): string {
    const complete = completeUpdateBlocks(message);
    if (complete.length > 0) return complete.at(-1)?.text ?? '';
    const partial = structuralMessage(message).match(UPDATE_BLOCK_PART_RE);
    return partial?.index === undefined ? '' : message.slice(partial.index);
}

function extractUpdateBlockInner(block: string): string {
    return block
        .replace(/^<(?:update(?:variable)?|variableupdate)\b[^>]*>/i, '')
        .replace(/<\/(?:update(?:variable)?|variableupdate)\s*>\s*$/i, '')
        .trim();
}

function cleanJsonPatchInner(inner: string): string {
    return inner
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

function parseIncrementalRepairPatch(repair_block: string): IncrementalRepairOperation[] | null {
    const matches = [...repair_block.matchAll(JSON_PATCH_BLOCK_RE)];
    if (matches.length !== 1) return null;
    try {
        const patch = parseString(cleanJsonPatchInner(matches[0][1]));
        return isJsonPatch(patch) ? (patch as IncrementalRepairOperation[]) : null;
    } catch {
        return null;
    }
}

function jsonPointerSegments(path: string): string[] | null {
    if (!path.startsWith('/') || path === '/') return null;
    return path
        .slice(1)
        .split('/')
        .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function forbiddenPointerPath(path: string): boolean {
    const segments = jsonPointerSegments(path);
    return (
        !segments ||
        FORBIDDEN_ROOT_PATHS.has(segments[0]) ||
        segments.some(segment => segment === '$internal' || segment === '$meta')
    );
}

export function normalizeIncrementalRepairBlock(repair_block: string): string | null {
    const patch = parseIncrementalRepairPatch(repair_block);
    return patch
        ? `<UpdateVariable>\n<JSONPatch>\n${JSON.stringify(patch, null, 2)}\n</JSONPatch>\n</UpdateVariable>`
        : null;
}

export function mergeIncrementalRepairBlock(message: string, repair_block: string): string {
    const repair_inner = extractUpdateBlockInner(repair_block);
    if (!repair_inner) return message;

    const complete = completeUpdateBlocks(message);
    const target = complete.at(-1);
    if (target?.index !== undefined) {
        const original_inner = extractUpdateBlockInner(target.text);
        const merged = `<UpdateVariable>\n${original_inner}\n\n${repair_inner}\n</UpdateVariable>`;
        return (
            message.slice(0, target.index) +
            merged +
            message.slice(target.index + target.text.length)
        );
    }

    const partial = structuralMessage(message).match(UPDATE_BLOCK_PART_RE);
    if (partial?.index !== undefined) {
        const original_inner = extractUpdateBlockInner(message.slice(partial.index));
        const merged = `<UpdateVariable>\n${original_inner}\n\n${repair_inner}\n</UpdateVariable>`;
        return message.slice(0, partial.index) + merged;
    }

    return `${message.trimEnd()}\n\n<UpdateVariable>\n${repair_inner}\n</UpdateVariable>`;
}

function commandPath(command: Command): string {
    return trimQuotesAndBackslashes(command.args[0] ?? '').trim();
}

function commandJsonPointer(command: Command): string | null {
    if (command.reason !== 'json_patch') return null;
    try {
        const operation = JSON.parse(command.full_match);
        return typeof operation.path === 'string' ? operation.path : null;
    } catch {
        return null;
    }
}

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

export function validateIncrementalRepairBlock(repair_block: string): string | null {
    const matches = [...repair_block.matchAll(JSON_PATCH_BLOCK_RE)];
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
        if (
            (operation_name === 'replace' || operation_name === 'insert') &&
            !Object.prototype.hasOwnProperty.call(operation, 'value')
        ) {
            return `${operation_name} 操作缺少 value`;
        }
    }
    return null;
}

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

export function validateIncrementalRepairAgainstState(
    repair_block: string,
    stat_data: Record<string, unknown>
): string | null {
    const patch = parseIncrementalRepairPatch(repair_block);
    if (!patch) return 'JSONPatch 内容无法解析';
    const targets: string[][] = [];
    for (const operation of patch) {
        const segments = jsonPointerSegments(operation.path);
        if (!segments) return `无效路径：${operation.path}`;
        if (
            targets.some(target => {
                const length = Math.min(target.length, segments.length);
                return target.slice(0, length).every((part, index) => part === segments[index]);
            })
        )
            return `补丁包含重复或相互覆盖的路径：${operation.path}`;
        targets.push(segments);
        for (let index = 1; index < segments.length; index++) {
            if (Array.isArray(_.get(stat_data, segments.slice(0, index)))) {
                return `数组需要使用 replace 整体校正：${operation.path}`;
            }
        }
        if (operation.op === 'replace' || operation.op === 'remove') {
            if (!_.has(stat_data, segments)) return `目标路径不存在：${operation.path}`;
            if (
                operation.op === 'replace' &&
                isValueWithDescription(_.get(stat_data, segments)) &&
                !Array.isArray(_.get(stat_data, segments)[0]) &&
                isValueWithDescription(operation.value)
            ) {
                return `带描述变量只能替换实际值，不能替换 [值, 描述] 包装：${operation.path}`;
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

export function verifyIncrementalRepairApplied(
    repair_block: string,
    before_stat_data: Record<string, unknown>,
    after_stat_data: Record<string, unknown>
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
                        ? _.isMatch(after_parent[index], operation.value)
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
            Array.isArray(before_value) &&
            before_value.length === 2 &&
            typeof before_value[1] === 'string' &&
            Array.isArray(after_value) &&
            after_value.length === 2 &&
            typeof after_value[1] === 'string'
                ? after_value[0]
                : after_value;
        const expected_value = operation.value;
        const value_matches =
            operation.op === 'insert' &&
            _.isPlainObject(expected_value) &&
            _.isPlainObject(effective_after_value)
                ? _.isMatch(effective_after_value, expected_value)
                : _.isEqual(effective_after_value, expected_value);
        if (!_.has(after_stat_data, segments) || !value_matches) {
            return `${operation.op === 'replace' ? '替换' : '插入'}操作未完整生效：${operation.path}`;
        }
    }
    return null;
}

export function mergeIncrementalRepairMetadata(
    original_data: Record<string, any>,
    applied_data: Record<string, any>,
    repair_block: string
) {
    const merged_delta = klona(original_data.delta_data ?? {});
    const merged_display = klona(original_data.display_data ?? applied_data.display_data ?? {});
    const patch = parseIncrementalRepairPatch(repair_block) ?? [];
    const readMetadata = (source: unknown, path: string[]) => {
        if (!_.isObject(source)) return undefined;
        return path.length === 0 ? _.get(source, ['']) : _.get(source, path);
    };

    for (const operation of patch) {
        const target_path = jsonPointerSegments(operation.path);
        if (!target_path) continue;
        // Object inserts are recorded at the parent path by updateVariables. Relocate the
        // generated scalar record to the inserted key so existing sibling records survive.
        const generated_path = operation.op === 'insert' ? target_path.slice(0, -1) : target_path;
        const delta_value = readMetadata(applied_data.delta_data, generated_path);
        const display_value = readMetadata(applied_data.display_data, generated_path);
        if (delta_value !== undefined) _.set(merged_delta, target_path, klona(delta_value));
        if (display_value !== undefined) _.set(merged_display, target_path, klona(display_value));
    }
    applied_data.delta_data = merged_delta;
    applied_data.display_data = merged_display;
}

function commandPreview(command: Command): string {
    const path = _.escape(commandPath(command));
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

function buildPreviewHtml(commands: Command[], repair_block: string): string {
    return `<h3>${tr('runtime.incrementalRepair.previewTitle')}</h3>
<p>${tr('runtime.incrementalRepair.previewDescription', { count: commands.length })}</p>
<ol>${commands.map(commandPreview).join('')}</ol>
<details><summary>${tr('runtime.incrementalRepair.showRawPatch')}</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${_.escape(repair_block)}</pre></details>`;
}

function getSwipeId(message_id: number): number {
    return Number(_.get(SillyTavern.chat, [message_id, 'swipe_id'], 0)) || 0;
}

function snapshotPersistedMvuData(source: Record<string, unknown>): PersistedMvuSnapshot {
    const snapshot: PersistedMvuSnapshot = {};
    for (const key of PERSISTED_MVU_KEYS) {
        if (_.has(source, key)) snapshot[key] = klona(_.get(source, key));
    }
    return snapshot;
}

function persistedSnapshotMatches(
    source: Record<string, unknown>,
    expected: PersistedMvuSnapshot
): boolean {
    return _.isEqual(snapshotPersistedMvuData(source), expected);
}

function statDataMatchesSnapshot(
    source: Record<string, unknown>,
    expected: PersistedMvuSnapshot
): boolean {
    return _.isEqual(_.get(source, 'stat_data'), expected.stat_data);
}

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

function anchorStillMatches(anchor: RepairAnchor): boolean {
    if (!anchorIdentityStillMatches(anchor)) return false;
    const current_variables = getVariables({ type: 'message', message_id: anchor.message_id });
    if (!isMvuData(current_variables)) return false;
    // schema/display_data/delta_data/initialized_lorebooks may be normalized by MVU or other
    // extensions while the model request is pending. They are rebased immediately before apply;
    // only actual state changes invalidate the pending result here.
    if (!statDataMatchesSnapshot(current_variables, anchor.message_variables)) return false;
    if (anchor.update_chat_variables) {
        const current_chat_variables = getVariables({ type: 'chat' });
        if (!statDataMatchesSnapshot(current_chat_variables, anchor.chat_variables)) return false;
    }
    return true;
}

/**
 * Commit content and both variable stores synchronously, before any save/render await.
 * Chat switching therefore cannot interrupt a half-applied in-memory transaction.
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
    const mergeSnapshot = (data: Record<string, any>, snapshot: PersistedMvuSnapshot) => {
        const result = klona(data);
        for (const key of PERSISTED_MVU_KEYS) {
            if (_.has(snapshot, key)) result[key] = klona(snapshot[key]);
            else delete result[key];
        }
        return result;
    };
    const next_variables = klona(message.variables ?? []);
    next_variables[anchor.swipe_id] = mergeSnapshot(message_variables, next_message);
    const next_swipes = message.swipes ? [...message.swipes] : undefined;
    if (next_swipes) next_swipes[anchor.swipe_id] = content;
    const next_metadata = anchor.update_chat_variables
        ? mergeSnapshot(chat_variables, next_chat)
        : undefined;
    // Retain exact field references for synchronous rollback if assignment itself fails.
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

async function saveAndRefreshRepair(anchor: RepairAnchor) {
    // A save/render failure must not undo a coherent transaction after a chat switch.
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

async function offerUndo(
    anchor: RepairAnchor,
    original_message_variables: PersistedMvuSnapshot,
    original_chat_variables: PersistedMvuSnapshot,
    applied_variables: PersistedMvuSnapshot,
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
                        applied_variables,
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
        // INPUT confirmation returns a string (including an intentionally empty one).
        // Cancel returns false; closing/Escape returns null in SillyTavern.
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
            allow_bare_json_patch: true,
            validate_result: result => {
                const normalized = normalizeAndValidateIncrementalRepairResult(result);
                const state_error = validateIncrementalRepairAgainstState(
                    normalized,
                    original_data.stat_data
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
            original_data.stat_data
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

        // Rebase harmless derived-metadata refreshes that happened while waiting. The complete
        // rebased snapshots are still compared atomically by persistMvuSnapshot before writing.
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
        // Build the final floor first, then replay it once from the preceding floor.
        // Never run lifecycle hooks on the already-settled current-floor snapshot.
        const repaired_content = mergeIncrementalRepairBlock(
            anchor.message_content,
            normalized_repair_block
        );
        const applied_data = klona(previous_variables);
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
        const application_error = verifyIncrementalRepairApplied(
            normalized_repair_block,
            original_data.stat_data,
            applied_data.stat_data
        );
        if (application_error) {
            // Schema transformations and end-of-floor hooks can legitimately normalize values.
            // Ask about the actual full-floor result; do not repeatedly run hooks or silently
            // drop potentially dependent operations.
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
        commitRepair(
            anchor,
            anchor.message_content,
            repaired_content,
            original_message_snapshot,
            original_chat_snapshot,
            applied_snapshot,
            applied_snapshot
        );
        await saveAndRefreshRepair(anchor);

        await offerUndo(
            anchor,
            original_message_snapshot,
            original_chat_snapshot,
            applied_snapshot,
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
