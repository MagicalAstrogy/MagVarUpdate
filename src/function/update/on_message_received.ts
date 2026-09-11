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
    /** 调度时该楼层的版本号；楼层被重新生成/切换 swipe 后版本递增，旧任务据此判定过期。 */
    revision: number;
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
 * 每个楼层当前的任务版本号。
 *
 * 取代关系不能只记录在 `current` 单槽里：当 A 分析楼层 5、B 取代 5、随后 C 被调度到
 * 楼层 7 时，`current` 已指向 C，A 与 C 的楼层不同会被误判为「未被取代」，
 * 其过期结果仍会写入 5 的替换版。按楼层记录版本号可让 A 与 C 并存时仍正确判定。
 */
const floor_revisions = new Map<string, number>();

function floorKey(chat_id: string, message_id: number): string {
    return `${chat_id}:${message_id}`;
}

/**
 * 把解析结果追加到目标楼层，并更新该楼层的变量。
 *
 * 每次写入前复核运行环境是否仍适用：等待期间用户可能切换聊天，或已在目标楼层之后
 * 继续发言。此处的解析读的是「当时的聊天尾部」，若尾部已推进，结果对应的上下文已失效，
 * 写入会落到错误的楼层位置，因此直接放弃。
 */
async function applyAnalysisResult(
    chat_id: string,
    message_id: number,
    result: string | null
): Promise<void> {
    if (SillyTavern.getCurrentChatId() !== chat_id) {
        return;
    }

    // 目标楼层之后已有新消息：本次解析的上下文已过期，放弃写入。
    if (SillyTavern.chat.length - 1 !== message_id) {
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
        // setChatMessages 是异步的，写变量前再确认运行环境未变。
        if (
            SillyTavern.getCurrentChatId() !== chat_id ||
            SillyTavern.chat.length - 1 !== message_id
        ) {
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

/** 该楼层是否已出现更新的任务（重新生成或切换 swipe），此时旧任务的结果不再适用。 */
function isSuperseded(task: AnalysisTask): boolean {
    return floor_revisions.get(floorKey(task.chat_id, task.message_id)) !== task.revision;
}

/**
 * 执行解析并应用结果。
 *
 * 任务自行完成应用，不依赖渲染事件：`MESSAGE_RECEIVED` 被 `_.throttle` 包装，
 * 窗口内的调用会推迟执行，其渲染事件可能早于任务启动，此时若等待渲染事件将永远等不到。
 */
async function runAnalysis(task: AnalysisTask): Promise<void> {
    const key = floorKey(task.chat_id, task.message_id);
    try {
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
        } catch (error) {
            console.error('[MVU]变量更新写回失败:', error);
            toastr.error(
                tr('runtime.extraModel.updateFailed'),
                tr('runtime.extraModel.updateFailedTitle')
            );
        } finally {
            task.applying = false;
        }
    } finally {
        // 集中清理：任何提前返回（如解析期间切换聊天）都不得遗留记录，
        // 否则后续手动重试会误判为「已有在途解析」而不发起请求。
        if (current === task) {
            current = null;
        }
        // 自己是该楼层最新版本时才删除版本号，避免把后续任务的版本一并清掉。
        if (floor_revisions.get(key) === task.revision) {
            floor_revisions.delete(key);
        }
    }
}

/** 登记并串行启动一次解析，返回该任务。 */
function startAnalysis(chat_id: string, message_id: number): AnalysisTask {
    const key = floorKey(chat_id, message_id);
    const revision = (floor_revisions.get(key) ?? 0) + 1;
    floor_revisions.set(key, revision);

    const task: AnalysisTask = {
        chat_id,
        message_id,
        revision,
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
    // 别的聊天渲染了同号楼层：本任务的写入会被聊天校验丢弃，等待只会拖住该聊天的
    // 渲染监听器与保存流程（ST 串行派发），因此不等待。
    if (task.chat_id !== SillyTavern.getCurrentChatId()) {
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
    // 在首个 await 之前捕获聊天归属与同楼层在途任务：异步前置检查期间在途解析可能
    // 已完成并清空记录，之后再取样会漏掉它而另发一次请求。
    const chat_id = SillyTavern.getCurrentChatId();
    const in_flight_at_entry =
        current && current.chat_id === chat_id && current.message_id === message_id
            ? current
            : null;

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

    // 手动重试：以进入时的在途任务为准，它已覆盖本次目标，直接采用其结果。
    if (in_flight_at_entry) {
        await in_flight_at_entry.finished;
        return;
    }

    await startAnalysis(chat_id, message_id).finished;
}
