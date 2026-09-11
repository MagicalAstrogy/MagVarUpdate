import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { isFunctionCallingSupported } from '@/function/is_function_calling_supported';
import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import { handleVariablesInMessage } from '@/function/update_variables';
import { tr } from '@/i18n';
import { useDataStore } from '@/store';

/**
 * 自动触发的一次在途解析。
 *
 * 按维护者意见不引入独立任务队列：酒馆的生成流程本身串行，同一时刻至多一个在途解析。
 * 解析在 MESSAGE_RECEIVED 启动，写回延后到 CHARACTER_MESSAGE_RENDERED，
 * 既保证正文先渲染，又保证变量写回先于酒馆随后的保存流程。
 */
type InFlightAnalysis = {
    chat_id: string;
    message_id: number;
    /** 解析结果；在渲染事件中等待，异常已在此处兜底为 null。 */
    analysis: Promise<string | null>;
};

/** 当前在途的自动解析；被后续调度取代时，旧解析的结果会被放弃。 */
let in_flight: InFlightAnalysis | null = null;

/**
 * 把解析结果追加到目标楼层，并更新该楼层的变量。
 *
 * 等待期间用户可能切换聊天，因此每次写入前都复核聊天归属，
 * 避免把结果写进错误的聊天或同号楼层。
 */
async function applyAnalysisResult(
    chat_id: string,
    message_id: number,
    result: string | null
): Promise<void> {
    if (SillyTavern.getCurrentChatId() !== chat_id) {
        return;
    }

    const chat_message = getChatMessages(message_id).at(-1);
    if (!chat_message) {
        // 楼层已被删除，静默放弃。
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
        // setChatMessages 是异步的，写变量前再确认一次聊天归属。
        if (SillyTavern.getCurrentChatId() !== chat_id) {
            return;
        }
    } else {
        toastr.error(
            tr('runtime.extraModel.updateFailed'),
            tr('runtime.extraModel.updateFailedTitle')
        );
    }

    await handleVariablesInMessage(message_id);
}

/**
 * 启动一次在途解析并登记，返回该记录。
 *
 * 解析异常在此处兜底为 null，避免无人等待时产生未处理的 Promise 拒绝。
 * 新的调度会直接取代旧记录，使旧结果不再写回。
 */
function startAnalysis(chat_id: string, message_id: number): InFlightAnalysis {
    const task: InFlightAnalysis = {
        chat_id,
        message_id,
        analysis: invokeExtraModelWithStrategy().catch(error => {
            console.error('[MVU]额外模型解析失败:', error);
            return null;
        }),
    };
    in_flight = task;
    return task;
}

/**
 * 渲染事件：等待本楼层的在途解析，然后写回结果与变量。
 *
 * CHARACTER_MESSAGE_RENDERED 在 addOneMessage 之后触发，此时正文已显示；
 * 在这里等待解析不会拖慢渲染，同时让变量写回先于酒馆随后的保存流程。
 *
 * 必须先摘除在途记录再写回：写回中的 handleVariablesInMessage 会以
 * `refresh: 'affected'` 再次触发本事件，摘除可避免重入等待自身而死锁。
 */
export async function onCharacterMessageRendered(message_id: number): Promise<void> {
    const task = in_flight;
    if (!task || task.message_id !== message_id) {
        return;
    }
    if (task.chat_id !== SillyTavern.getCurrentChatId()) {
        return;
    }

    in_flight = null;
    await applyAnalysisResult(task.chat_id, task.message_id, await task.analysis);
}

export async function onMessageReceived(
    message_id: number,
    { force = false }: { force?: boolean } = {}
) {
    // 在首个 await 之前捕获聊天归属，避免异步等待期间切换聊天后绑定到目标聊天。
    const chat_id = SillyTavern.getCurrentChatId();

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

    if (!force) {
        if (store.effective_settings.额外模型解析配置.启用自动请求 === false) {
            console.log(tr('runtime.extraModel.autoRequestDisabledLog'));
            return;
        }
        // 自动触发：启动解析但不等待，让酒馆继续渲染正文；写回由渲染事件负责。
        startAnalysis(chat_id, message_id);
        return;
    }

    // 手动重试保持同步，便于即时确认结果。
    const previous = in_flight;
    if (previous && previous.chat_id === chat_id && previous.message_id === message_id) {
        // 同楼层已有在途解析：摘除后直接采用其结果，避免重复请求执行两次非幂等命令。
        in_flight = null;
        await applyAnalysisResult(chat_id, message_id, await previous.analysis);
        return;
    }

    await applyAnalysisResult(chat_id, message_id, await invokeExtraModelWithStrategy());
}
