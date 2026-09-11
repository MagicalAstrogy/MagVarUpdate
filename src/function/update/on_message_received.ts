import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { isFunctionCallingSupported } from '@/function/is_function_calling_supported';
import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import { handleVariablesInMessage } from '@/function/update_variables';
import { tr } from '@/i18n';
import { useDataStore } from '@/store';

/**
 * 一次自动触发解析的记录。
 *
 * 不引入独立任务队列：酒馆的生成流程串行，同一时刻至多一个在途解析。
 * 但解析函数持有全局互斥（同一时刻仅允许一个在途请求），因此任务只用一条串行链
 * 逐个启动，不能在旧请求未结束时并发调用。
 */
type AnalysisTask = {
    chat_id: string;
    message_id: number;
    /** 解析与应用的完整过程；渲染事件与手动重试据此等待。 */
    finished: Promise<void>;
    /** 是否已进入应用阶段：写回会以 refresh:'affected' 再次触发渲染事件，据此直接返回以避免等待自身。 */
    applying: boolean;
};

/** 最近一次任务；保留到结果应用完成，使手动重试能识别在途解析。 */
let current: AnalysisTask | null = null;

/** 串行链：解析函数持有全局互斥，任务必须逐个启动。 */
let chain: Promise<void> = Promise.resolve();

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

/** 同楼层是否已出现更新的任务（重新生成或切换 swipe），此时旧任务的结果不再适用。 */
function isSuperseded(task: AnalysisTask): boolean {
    return (
        current !== null &&
        current !== task &&
        current.chat_id === task.chat_id &&
        current.message_id === task.message_id
    );
}

/**
 * 执行解析并应用结果。
 *
 * 任务自行完成应用，不依赖渲染事件：`MESSAGE_RECEIVED` 被 `_.throttle` 包装，
 * 窗口内的调用会推迟执行，其渲染事件可能早于任务启动，此时若等待渲染事件将永远等不到。
 */
async function runAnalysis(task: AnalysisTask): Promise<void> {
    if (SillyTavern.getCurrentChatId() !== task.chat_id) {
        return;
    }

    let result: string | null = null;
    try {
        result = await invokeExtraModelWithStrategy();
    } catch (error) {
        console.error('[MVU]额外模型解析失败:', error);
    }

    if (isSuperseded(task)) {
        return;
    }

    task.applying = true;
    try {
        await applyAnalysisResult(task.chat_id, task.message_id, result);
    } finally {
        task.applying = false;
        if (current === task) {
            current = null;
        }
    }
}

/** 登记并串行启动一次解析，返回该任务。 */
function startAnalysis(chat_id: string, message_id: number): AnalysisTask {
    const task: AnalysisTask = {
        chat_id,
        message_id,
        finished: Promise.resolve(),
        applying: false,
    };
    task.finished = chain.then(() => runAnalysis(task)).catch(() => undefined);
    chain = task.finished;
    current = task;
    return task;
}

/**
 * 渲染事件：等待本楼层在途解析完成。
 *
 * `CHARACTER_MESSAGE_RENDERED` 在 `addOneMessage` 之后触发，此时正文已显示，
 * 在这里等待不会拖慢渲染，并让变量写回尽量先于酒馆随后的保存流程。
 *
 * 该事件也可能早于任务启动（`MESSAGE_RECEIVED` 被节流推迟），此时任务会自行完成应用；
 * 若解析较慢，本事件也只是等待，不影响正文。
 */
export async function onCharacterMessageRendered(message_id: number): Promise<void> {
    const task = current;
    if (!task || task.message_id !== message_id) {
        return;
    }
    if (task.applying) {
        // 写回触发的重入事件：等待自身会死锁，直接返回。
        return;
    }
    await task.finished;
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
        // 自动触发：启动解析但不等待，让酒馆继续渲染正文。
        startAnalysis(chat_id, message_id);
        return;
    }

    // 手动重试：同楼层的在途任务已覆盖本次目标，直接等待它，避免重复请求执行两次非幂等命令。
    const previous = current;
    if (previous && previous.chat_id === chat_id && previous.message_id === message_id) {
        await previous.finished;
        return;
    }

    await startAnalysis(chat_id, message_id).finished;
}
