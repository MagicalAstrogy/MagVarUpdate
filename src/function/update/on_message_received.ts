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
}

/** 已登记待执行的自动解析任务（按触发顺序）。 */
const pending_analysis: PendingAnalysisTask[] = [];

/** 串行队列尾部：保证同一时刻至多一个解析在执行，后续任务排队等待。 */
let queue_tail: Promise<void> = Promise.resolve();

/**
 * 将额外模型解析的结果回写到目标楼层，并执行楼层变量更新。
 */
async function applyExtraModelResultToMessage(
    message_id: number,
    result: string | null
): Promise<void> {
    const chat_message = getChatMessages(message_id).at(-1);
    if (!chat_message) {
        // 楼层已被删除/切换，静默放弃。
        return;
    }

    if (result !== null) {
        await setChatMessages(
            [
                {
                    message_id,
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
    await handleVariablesInMessage(message_id);
}

/** 执行单个自动解析任务（串行队列中的一环）。 */
async function runAnalysisTask(task: PendingAnalysisTask): Promise<void> {
    try {
        // 等待期间用户切换了聊天：放弃解析与回写，避免把结果写进错误的聊天/楼层。
        if (SillyTavern.getCurrentChatId() !== task.chat_id) {
            return;
        }
        const result = await invokeExtraModelWithStrategy();
        await applyExtraModelResultToMessage(task.message_id, result);
    } catch (error) {
        console.error('[MVU] deferred extra-model analysis failed:', error);
        toastr.error(
            tr('runtime.extraModel.updateFailed'),
            tr('runtime.extraModel.updateFailedTitle')
        );
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
        return;
    }

    const task: PendingAnalysisTask = { chat_id, message_id };
    pending_analysis.push(task);

    // 计时器回调在事件链之外的新宏任务中运行，ST 的事件派发早已继续并完成正文渲染。
    setTimeout(() => {
        const index = pending_analysis.findIndex(
            queued => queued.chat_id === chat_id && queued.message_id === message_id
        );
        if (index === -1) {
            // 任务已因去重/取消被移除。
            return;
        }
        pending_analysis.splice(index, 1);
        void enqueueAnalysisTask(task);
    }, delay_ms);
}

export async function onMessageReceived(
    message_id: number,
    { force = false }: { force?: boolean } = {}
) {
    const current_chatmsg = getChatMessages(message_id).at(-1);
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
    const pending_index = pending_analysis.findIndex(
        queued => queued.chat_id === retry_chat_id && queued.message_id === message_id
    );
    if (pending_index !== -1) {
        pending_analysis.splice(pending_index, 1);
    }

    const result = await invokeExtraModelWithStrategy();
    await applyExtraModelResultToMessage(message_id, result);
}