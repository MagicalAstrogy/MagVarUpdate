import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { isFunctionCallingSupported } from '@/function/is_function_calling_supported';
import {
    invokeExtraModelWithStrategy,
    isExtraModelAnalysisInProgress,
} from '@/function/update/invoke_extra_model';
import { handleVariablesInMessage } from '@/function/update_variables';
import { tr } from '@/i18n';
import { useDataStore } from '@/store';

/** 将额外模型解析的结果回写到目标楼层，并执行楼层变量更新。 */
async function applyExtraModelResultToMessage(
    message_id: number,
    result: string | null
): Promise<void> {
    const chat_messages = getChatMessages(message_id);
    if (!chat_messages || chat_messages.length === 0) {
        // 楼层已被删除/切换，静默放弃。
        return;
    }

    if (result !== null) {
        await setChatMessages(
            [
                {
                    message_id,
                    message: chat_messages[0].message.trimEnd() + '\n\n' + result,
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

/**
 * 自动触发路径：立即返回以让 SillyTavern 的主回复先渲染，延时后在后台执行额外模型解析。
 * 不阻塞 MESSAGE_RECEIVED 事件链，因此主回复渲染不再被解析请求拖住。
 */
export function scheduleDeferredAutoAnalysis(message_id: number, delay_ms: number): void {
    // 计时器回调在事件链之外的新宏任务中运行，ST 的事件派发早已继续并完成正文渲染。
    setTimeout(async () => {
        try {
            if (isExtraModelAnalysisInProgress()) {
                // 等待期间用户已手动触发解析(同步)，由该次负责更新，跳过本次自动调度。
                return;
            }
            const result = await invokeExtraModelWithStrategy();
            await applyExtraModelResultToMessage(message_id, result);
        } catch (error) {
            console.error('[MVU] deferred extra-model analysis failed:', error);
            toastr.error(
                tr('runtime.extraModel.updateFailed'),
                tr('runtime.extraModel.updateFailedTitle')
            );
        }
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
    const result = await invokeExtraModelWithStrategy();
    await applyExtraModelResultToMessage(message_id, result);
}
