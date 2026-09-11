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

const UPDATE_BLOCK_RE = /<UpdateVariable\b[^>]*>[\s\S]*?<\/UpdateVariable\s*>/gi;
const UPDATE_BLOCK_PART_RE = /<UpdateVariable\b[^>]*>[\s\S]*$/i;
const UPDATE_CLOSE_RE = /<\/UpdateVariable\s*>/i;
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
本次是增量变量校正，不是完整重试：
  本次给出的变量状态已经是剧情之后、包含本楼原变量更新中成功落地部分的当前状态；通用任务中“剧情发生之前的变量状态”不适用于本次校正。
  阅读 <past_observe> 中最新一轮剧情、已有变量更新命令、变量规则和当前变量状态，并参考下方“本楼已落地变化”。
  只输出遗漏、错误或与剧情明确事实冲突的修正；已经正确的变化禁止重复输出。
  修正必须落在当前状态之上，不得重算或覆盖整份变量。
  对已有字段使用 replace 和绝对目标值；禁止 delta/add/move。数组需要修正时 replace 整个数组，避免重复插入。仅在规则允许新增字段时使用 insert；错误字段可用 remove。
  不确定时保持当前值。没有需要修正的内容时输出空 JSONPatch 数组。
  除一个 <UpdateVariable><JSONPatch>...</JSONPatch></UpdateVariable> 外不得输出任何内容。本段约束补充并收紧前面的通用变量更新任务，不改变世界书筛选和变量规则。
</incremental_repair_directive>
<incremental_repair_context>
本楼已落地变化：
${formatStateChanges(changes)}
</incremental_repair_context>`;
}

export function buildIncrementalRepairUserInput(user_direction: string = ''): string {
    const direction = user_direction.trim().slice(0, 500);
    if (!direction) return '遵循<must>指令';
    return `遵循<must>指令
<user_incremental_repair_direction>
${direction}
</user_incremental_repair_direction>`;
}

export function extractLatestUpdateVariableBlock(message: string): string {
    const complete = [...message.matchAll(UPDATE_BLOCK_RE)];
    if (complete.length > 0) return complete.at(-1)?.[0] ?? '';
    return message.match(UPDATE_BLOCK_PART_RE)?.[0] ?? '';
}

function extractUpdateBlockInner(block: string): string {
    return block
        .replace(/^<UpdateVariable\b[^>]*>/i, '')
        .replace(/<\/UpdateVariable\s*>\s*$/i, '')
        .trim();
}

export function mergeIncrementalRepairBlock(message: string, repair_block: string): string {
    const repair_inner = extractUpdateBlockInner(repair_block);
    if (!repair_inner) return message;

    const complete = [...message.matchAll(UPDATE_BLOCK_RE)];
    const target = complete.at(-1);
    if (target?.index !== undefined) {
        const block = target[0];
        const close = block.search(UPDATE_CLOSE_RE);
        const merged = `${block.slice(0, close).trimEnd()}\n\n${repair_inner}\n${block.slice(close)}`;
        return message.slice(0, target.index) + merged + message.slice(target.index + block.length);
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
            user_input: buildIncrementalRepairUserInput(user_direction),
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

        const block_error = validateIncrementalRepairBlock(repair_block);
        if (block_error) {
            toastr.warning(_.escape(block_error), tr('runtime.incrementalRepair.title'));
            return;
        }

        const commands = extractCommands(repair_block);
        if (commands.length === 0 && EMPTY_JSON_PATCH_RE.test(repair_block)) {
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

        const applied_data = klona(original_data);
        const is_modified = await updateVariables(repair_block, applied_data);
        if (!is_modified) {
            toastr.info(
                tr('runtime.incrementalRepair.noEffectiveChanges'),
                tr('runtime.incrementalRepair.title')
            );
            return;
        }

        const repaired_content = mergeIncrementalRepairBlock(anchor.message_content, repair_block);
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
