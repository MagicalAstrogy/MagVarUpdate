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
import { isMvuData, MvuData } from '@/variable_def';
import { parseString } from '@util/common';
import { klona } from 'klona';

const UPDATE_BLOCK_RE =
    /<(?:update(?:variable)?|variableupdate)\b[^>]*>[\s\S]*?<\/(?:update(?:variable)?|variableupdate)\s*>/gi;
const UPDATE_BLOCK_PART_RE = /<(?:update(?:variable)?|variableupdate)\b[^>]*>[\s\S]*$/i;
const EMPTY_JSON_PATCH_RE =
    /<json_?patch\b[^>]*>\s*(?:```[^\n]*\s*)?\[\s*\](?:\s*```)?\s*<\/json_?patch\s*>/i;
const JSON_PATCH_BLOCK_RE =
    /<json_?patch\b[^>]*>(?:\s*```.*)?([\s\S]*?)(?:```\s*)?<\/json_?patch\s*>/gi;
const FORBIDDEN_ROOT_PATHS = new Set([
    '$internal',
    '$meta',
    'schema',
    'display_data',
    'delta_data',
    'initialized_lorebooks',
]);

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
    stat_data: Record<string, unknown>;
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
    return `<incremental_repair_directive>
本次是增量变量校正，不是完整重试。

输入解释：
- 当前变量状态是本轮剧情结束且原更新已执行后的结果，不是剧情发生前的状态。
- <past_observe> 中包含最新剧情与原更新；下方清单只用于识别本楼已经落地的变化。
- 变量规则与已注入世界书仍是最终依据；用户补充方向只指定优先核验处，不能创造剧情事实或覆盖规则。

执行边界：
- 仅补充遗漏，或纠正与最新剧情、变量规则明确冲突的错误；已经正确的变化禁止重复输出。
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
</incremental_repair_context>`;
}

export function buildIncrementalRepairPromptTail(user_direction: string = ''): string {
    const direction = user_direction.trim().slice(0, 500);
    return `<incremental_repair_final_check>
这是请求末尾的最终复核指令，优先核验用户明确指出的方向，但不得越过变量规则与最新剧情事实。
<user_focus>${direction || '（用户未补充方向：自动审计遗漏与明确错误）'}</user_focus>
最终只保留针对当前状态的必要增量操作；不重复已有正确更新，不整表重算，不输出结构外解释。严格服从本次应答格式，结果必须包含可由后处理规范化为标准 <UpdateVariable><JSONPatch> 的合法 JSONPatch 数组。
</incremental_repair_final_check>`;
}

export function extractLatestUpdateVariableBlock(message: string): string {
    const complete = [...message.matchAll(UPDATE_BLOCK_RE)];
    if (complete.length > 0) return complete.at(-1)?.[0] ?? '';
    return message.match(UPDATE_BLOCK_PART_RE)?.[0] ?? '';
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

export function normalizeIncrementalRepairBlock(repair_block: string): string | null {
    const matches = [...repair_block.matchAll(JSON_PATCH_BLOCK_RE)];
    if (matches.length !== 1) return null;
    try {
        const patch = parseString(cleanJsonPatchInner(matches[0][1]));
        if (!isJsonPatch(patch)) return null;
        return `<UpdateVariable>\n<JSONPatch>\n${JSON.stringify(patch, null, 2)}\n</JSONPatch>\n</UpdateVariable>`;
    } catch {
        return null;
    }
}

export function mergeIncrementalRepairBlock(message: string, repair_block: string): string {
    const repair_inner = extractUpdateBlockInner(repair_block);
    if (!repair_inner) return message;

    const complete = [...message.matchAll(UPDATE_BLOCK_RE)];
    const target = complete.at(-1);
    if (target?.index !== undefined) {
        const original_inner = extractUpdateBlockInner(target[0]);
        const merged = `<UpdateVariable>\n${original_inner}\n\n${repair_inner}\n</UpdateVariable>`;
        return (
            message.slice(0, target.index) + merged + message.slice(target.index + target[0].length)
        );
    }

    const partial = message.match(UPDATE_BLOCK_PART_RE);
    if (partial?.index !== undefined) {
        const original_inner = extractUpdateBlockInner(partial[0]);
        const merged = `<UpdateVariable>\n${original_inner}\n\n${repair_inner}\n</UpdateVariable>`;
        return message.slice(0, partial.index) + merged;
    }

    return `${message.trimEnd()}\n\n<UpdateVariable>\n${repair_inner}\n</UpdateVariable>`;
}

function commandPath(command: Command): string {
    return trimQuotesAndBackslashes(command.args[0] ?? '').trim();
}

export function validateIncrementalRepairCommands(commands: Command[]): string | null {
    for (const command of commands) {
        if (command.reason !== 'json_patch') {
            return '增量校正仅接受 JSONPatch，不接受脚本式更新命令';
        }
        if (command.type === 'add' || command.type === 'move') {
            return `增量校正不接受 ${command.type} 操作，请改用绝对值 replace`;
        }
        const path = commandPath(command);
        if (!path) return '存在空变量路径';
        const segments = _.toPath(path);
        if (
            FORBIDDEN_ROOT_PATHS.has(segments[0]) ||
            segments.some(segment => segment === '$internal' || segment === '$meta')
        ) {
            return `禁止修改 MVU 内部路径：${path}`;
        }
    }
    return null;
}

export function validateIncrementalRepairBlock(repair_block: string): string | null {
    const matches = [...repair_block.matchAll(JSON_PATCH_BLOCK_RE)];
    if (matches.length !== 1) return '必须且只能返回一个 JSONPatch 补丁块';

    let patch: unknown;
    try {
        patch = parseString(matches[0][1].trim());
    } catch {
        return 'JSONPatch 内容无法解析';
    }
    if (!isJsonPatch(patch)) return 'JSONPatch 必须是合法操作数组';

    for (const operation of patch) {
        const operation_name = String(operation.op);
        if (!['replace', 'insert', 'remove'].includes(operation_name)) {
            return `增量校正不接受 ${operation_name} 操作`;
        }
        if (!operation.path || operation.path === '/' || !operation.path.startsWith('/')) {
            return `增量校正路径必须是具体的 JSON Pointer：${operation.path ?? ''}`;
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

function anchorStillMatches(anchor: RepairAnchor): boolean {
    if (SillyTavern.getCurrentChatId() !== anchor.chat_id) return false;
    if (getLastMessageId() !== anchor.message_id) return false;
    if (getSwipeId(anchor.message_id) !== anchor.swipe_id) return false;
    const current_message = getChatMessages(anchor.message_id).at(-1);
    if (current_message?.message !== anchor.message_content) return false;
    const current_variables = getVariables({ type: 'message', message_id: anchor.message_id });
    return isMvuData(current_variables) && _.isEqual(current_variables.stat_data, anchor.stat_data);
}

async function persistMvuData(source: MvuData, message_id: number, update_chat_variables: boolean) {
    const updater = (data: Record<string, any>) => {
        for (const key of [
            'initialized_lorebooks',
            'stat_data',
            'schema',
            'display_data',
            'delta_data',
        ] as const) {
            if (_.has(source, key)) _.set(data, key, klona(_.get(source, key)));
            else _.unset(data, key);
        }
        return data;
    };
    if (update_chat_variables) await updateVariablesWith(updater, { type: 'chat' });
    await updateVariablesWith(updater, { type: 'message', message_id });
}

async function offerUndo(
    anchor: RepairAnchor,
    original_data: MvuData,
    applied_data: MvuData,
    repaired_content: string,
    original_chat_data: MvuData | undefined,
    update_chat_variables: boolean
) {
    toastr.success(
        tr('runtime.incrementalRepair.appliedClickToUndo'),
        tr('runtime.incrementalRepair.title'),
        {
            timeOut: 12000,
            extendedTimeOut: 3000,
            onclick: async () => {
                const current = getVariables({
                    type: 'message',
                    message_id: anchor.message_id,
                });
                const same_target =
                    SillyTavern.getCurrentChatId() === anchor.chat_id &&
                    getSwipeId(anchor.message_id) === anchor.swipe_id &&
                    getChatMessages(anchor.message_id).at(-1)?.message === repaired_content &&
                    isMvuData(current) &&
                    _.isEqual(current.stat_data, applied_data.stat_data);
                if (!same_target) {
                    toastr.warning(
                        tr('runtime.incrementalRepair.undoStateChanged'),
                        tr('runtime.incrementalRepair.title')
                    );
                    return;
                }
                await persistMvuData(original_data, anchor.message_id, false);
                if (update_chat_variables && original_chat_data) {
                    await persistMvuData(original_chat_data, anchor.message_id, true);
                    // persistMvuData also writes the message floor; restore its dedicated snapshot.
                    await persistMvuData(original_data, anchor.message_id, false);
                }
                await setChatMessages(
                    [{ message_id: anchor.message_id, message: anchor.message_content }],
                    { refresh: 'affected' }
                );
                await SillyTavern.saveChat();
                toastr.info(
                    tr('runtime.incrementalRepair.undone'),
                    tr('runtime.incrementalRepair.title')
                );
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

    const original_data = klona(current_variables);
    const original_chat_variables = getVariables({ type: 'chat' });
    const original_chat_data = isMvuData(original_chat_variables)
        ? klona(original_chat_variables)
        : undefined;
    const anchor: RepairAnchor = {
        chat_id: SillyTavern.getCurrentChatId(),
        message_id,
        swipe_id: getSwipeId(message_id),
        message_content: current_message.message,
        stat_data: klona(current_variables.stat_data),
    };
    const changes = collectIncrementalStateChanges(
        previous_variables.stat_data,
        current_variables.stat_data
    );
    is_incremental_repair_in_progress = true;
    try {
        const direction_result = await SillyTavern.callGenericPopup(
            tr('runtime.incrementalRepair.directionPrompt'),
            SillyTavern.POPUP_TYPE.INPUT,
            ''
        );
        if (direction_result === undefined) return;
        const user_direction = String(direction_result).slice(0, 500);
        const repair_block = await invokeExtraModelWithStrategy({
            task_suffix: buildIncrementalRepairTask(changes),
            prompt_tail: buildIncrementalRepairPromptTail(user_direction),
            allow_bare_json_patch: true,
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

        const applied_data = klona(original_data);
        const is_modified = await updateVariables(normalized_repair_block, applied_data);
        if (!is_modified) {
            toastr.info(
                tr('runtime.incrementalRepair.noEffectiveChanges'),
                tr('runtime.incrementalRepair.title')
            );
            return;
        }

        const repaired_content = mergeIncrementalRepairBlock(
            anchor.message_content,
            normalized_repair_block
        );
        const update_chat_variables = store.effective_settings.兼容性.更新到聊天变量;
        try {
            await persistMvuData(applied_data, message_id, update_chat_variables);
            await setChatMessages([{ message_id, message: repaired_content }], {
                refresh: 'affected',
            });
            await SillyTavern.saveChat();
        } catch (error) {
            await persistMvuData(original_data, message_id, false);
            if (update_chat_variables && original_chat_data) {
                await persistMvuData(original_chat_data, message_id, true);
                await persistMvuData(original_data, message_id, false);
            }
            await setChatMessages([{ message_id, message: anchor.message_content }], {
                refresh: 'affected',
            });
            throw error;
        }

        await offerUndo(
            anchor,
            original_data,
            applied_data,
            repaired_content,
            original_chat_data,
            update_chat_variables
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
