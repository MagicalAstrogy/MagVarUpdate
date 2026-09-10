import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { isFunctionCallingSupported } from '@/function/is_function_calling_supported';
import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import { handleVariablesInMessage } from '@/function/update_variables';
import { tr } from '@/i18n';
import { useDataStore } from '@/store';

/**
 * 自动解析任务。
 * key: `${chat_id}:${message_id}` —— 同一消息只允许一个延后任务，避免与手动重试重复。
 */
interface PendingAnalysisTask {
    chat_id: string;
    message_id: number;
    /** 是否已被请求取消（手动重试接手）。执行中的任务取消后跳过执行与写回。 */
    canceled: boolean;
    /** 是否已进入串行队列执行中。未执行的任务可被彻底移除（允许重新调度）。 */
    processing: boolean;
}

/** 已登记待执行的自动解析任务（按触发顺序）。任务在完成/明确取消前保留在表中，以便手动重试取消。 */
const pending_analysis: PendingAnalysisTask[] = [];

/** 串行队列尾部：保证同一时刻至多一个解析在执行，后续任务排队等待。 */
let queue_tail: Promise<void> = Promise.resolve();

/** 获取指定消息所在聊天的最新消息。 */
function getLatestMessage(
    message_id: number
): { message: string; role: string; name?: string } | undefined {
    return getChatMessages(message_id).at(-1);
}

/**
 * 将额外模型解析的结果回写到目标楼层，并执行楼层变量更新。
 */
async function applyExtraModelResultToMessage(
    task: PendingAnalysisTask,
    result: string | null
): Promise<void> {
    // 结果应用前再次校验：await 解析期间用户可能已切换聊天，不得把结果写进错误聊天/同号楼层。
    if (task.canceled || SillyTavern.getCurrentChatId() !== task.chat_id) {
        return;
    }

    const chat_message = getLatestMessage(task.message_id);
    if (!chat_message) {
        // 楼层已被删除/切换，静默放弃。
        return;
    }

    if (result !== null) {
        await setChatMessages(
            [
                {
                    message_id: task.message_id,
                    message: chat_message.message.trimEnd() + '\n\n' + result,
                },
            ],
            {
                refresh: 'none',
            }
        );
    } else {
        toastr.error(
            tr('runtime.extraModel.updateFailed'),
            tr('runtime.extraModel.updateFailedTitle')
        );
    }
    await handleVariablesInMessage(task.message_id);
}

/** 从跟踪表移除任务，返回是否删除。 */
function removePendingTask(chat_id: string, message_id: number): boolean {
    const index = pending_analysis.findIndex(
        queued => queued.chat_id === chat_id && queued.message_id === message_id
    );
    if (index !== -1) {
        pending_analysis.splice(index, 1);
        return true;
    }
    return false;
}

/** 执行单个自动解析任务（串行队列中的一环）。 */
async function runAnalysisTask(task: PendingAnalysisTask): Promise<void> {
    try {
        if (task.canceled) {
            return;
        }
        // 等待期间用户切换了聊天：放弃解析与回写，避免把结果写进错误的聊天/楼层。
        if (SillyTavern.getCurrentChatId() !== task.chat_id) {
            return;
        }
        const result = await invokeExtraModelWithStrategy();
        await applyExtraModelResultToMessage(task, result);
    } catch (error) {
        console.error('[MVU] deferred extra-model analysis failed:', error);
        toastr.error(
            tr('runtime.extraModel.updateFailed'),
            tr('runtime.extraModel.updateFailedTitle')
        );
    } finally {
        // 任务完成/取消后从跟踪表移除，允许后续同消息任务重新调度。
        removePendingTask(task.chat_id, task.message_id);
    }
}

/** 把任务追加到串行队列尾，返回其完成 promise。 */
function enqueueAnalysisTask(task: PendingAnalysisTask): Promise<void> {
    const run = queue_tail.then(() => runAnalysisTask(task));
    // 即使某个任务抛错也要让队列继续推进。
    queue_tail = run.catch(() => undefined);
    return run;
}

/**
 * 自动触发路径：立即返回以让 SillyTavern 的主回复先渲染，延时后在后台执行额外模型解析。
 * 不阻塞 MESSAGE_RECEIVED 事件链，因此主回复渲染不再被解析请求拖住。
 */
export function scheduleDeferredAutoAnalysis(message_id: number, delay_ms: number): void {
    const chat_id = SillyTavern.getCurrentChatId();
    if (pending_analysis.some(task => task.chat_id === chat_id && task.message_id === message_id)) {
        // 同一消息已有延后任务在排队/执行，不重复调度（防止与手动重试重复）。
        // 已取消的残留任务不会出现：取消时未执行的任务会被移除，执行中的任务取消后随即在 finally 移除。
        return;
    }

    const task: PendingAnalysisTask = { chat_id, message_id, canceled: false, processing: false };
    pending_analysis.push(task);

    // 计时器回调在事件链之外的新宏任务中运行，ST 的事件派发早已继续并完成正文渲染。
    setTimeout(() => {
        // 若任务已在等待期间被手动重试取消并移除，则跳过执行（审查 #13）。
        if (!pending_analysis.includes(task) || task.canceled) {
            return;
        }
        task.processing = true;
        void enqueueAnalysisTask(task);
    }, delay_ms);
}

/**
 * 取消同一消息的待执行/排队中自动解析任务（手动重试接管时调用）。
 * - 未开始执行的任务直接移除，使同消息新版本可再次调度（审查 #13）；
 * - 执行中的任务置 canceled，执行完成时在 finally 移除，期间不再写回（审查 #12）。
 */
function cancelPendingAnalysis(chat_id: string, message_id: number): boolean {
    let canceled = false;
    for (const task of pending_analysis) {
        if (task.chat_id === chat_id && task.message_id === message_id) {
            if (task.processing) {
                // 正在执行：标记取消，交由运行中的任务在 finally 清理。
                task.canceled = true;
            } else {
                // 尚未执行：彻底移除，允许同消息新版本重新调度。
                removePendingTask(chat_id, message_id);
            }
            canceled = true;
        }
    }
    return canceled;
}

export async function onMessageReceived(
    message_id: number,
    { force = false }: { force?: boolean } = {}
) {
    const current_chatmsg = getLatestMessage(message_id);
    if (!current_chatmsg) {
        return;
    }

    const store = useDataStore();
    if (
        store.effective_settings.兼容性.sendas不视为user消息 === false &&
        current_chatmsg.name !== SillyTavern.name2
    ) {
        return;
    }

    const message_content = current_chatmsg.message;
    if (message_content.length < 5) {
        //MESSAGE_RECEIVED 有时候也会在请求的一开始递交，会包含一个 "..." 的消息
        return;
    }
    store.runtimes.is_during_extra_analysis = false;

    if (
        store.effective_settings.更新方式 === '随AI输出' ||
        (store.settings.额外模型解析配置.应答格式 === '工具调用' &&
            !isFunctionCallingSupported()) ||
        !(await isExtraModelSupported())
    ) {
        await handleVariablesInMessage(message_id);
        return;
    }

    if (SillyTavern.chat.length <= 1) {
        console.log(tr('runtime.extraModel.firstFloorSkippedLog'));
        return;
    }

    if (!force && store.effective_settings.额外模型解析配置.启用自动请求 === false) {
        console.log(tr('runtime.extraModel.autoRequestDisabledLog'));
        return;
    }

    if (!force) {
        // 自动触发改为延后非阻塞：先让主回复渲染，再在后台解析并回写状态栏。
        const delay_ms =
            Math.max(
                0,
                Math.round(store.effective_settings.额外模型解析配置.自动解析延时)
            ) * 1000;
        scheduleDeferredAutoAnalysis(message_id, delay_ms);
        return;
    }

    // 手动重试保持同步执行，便于即时确认解析结果。
    // 先取消同消息的待执行自动延后任务，避免延时触发时重复解析（非幂等命令会执行两次）。
    const retry_chat_id = SillyTavern.getCurrentChatId();
    cancelPendingAnalysis(retry_chat_id, message_id);

    const result = await invokeExtraModelWithStrategy();
    await applyExtraModelResultToMessage(
        { chat_id: retry_chat_id, message_id, canceled: false, processing: false },
        result
    );
}