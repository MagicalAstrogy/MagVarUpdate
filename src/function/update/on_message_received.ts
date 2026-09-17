import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { isFunctionCallingSupported } from '@/function/is_function_calling_supported';
import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import { getPiRequestFailureToastMessage } from '@/function/update/pi/error_localization';
import { isPiMultiproviderEnabled } from '@/function/update/pi/feature_flag';
import { handleVariablesInMessage } from '@/function/update_variables';
import { tr } from '@/i18n';
import { useDataStore } from '@/store';

/** 接收时启动解析；非工具调用的自动解析在本条消息渲染后等待结果并写回。 */
export async function onMessageReceived(
    message_id: number,
    { force = false, signal }: { force?: boolean; signal?: AbortSignal } = {}
) {
    if (signal?.aborted) {
        return;
    }
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
        // MESSAGE_RECEIVED 有时候也会在请求的一开始递交，会包含一个 "..." 的消息。
        return;
    }

    // 每次调用独立捕获目标；等待期间聊天切换、重新生成、切换 swipe 或编辑均使其失效。
    const chat_id = SillyTavern.getCurrentChatId();
    const chat_message = SillyTavern.chat[message_id];
    const swipe_id = chat_message?.swipe_id;
    const isCurrentMessage = (expected_content = message_content) =>
        !signal?.aborted &&
        SillyTavern.getCurrentChatId() === chat_id &&
        SillyTavern.chat.length - 1 === message_id &&
        SillyTavern.chat[message_id] === chat_message &&
        chat_message?.swipe_id === swipe_id &&
        getChatMessages(message_id).at(-1)?.message === expected_content;

    if (
        store.effective_settings.更新方式 === '随AI输出' ||
        (store.settings.额外模型解析配置.模型来源 === '更多' && !isPiMultiproviderEnabled()) ||
        (store.settings.额外模型解析配置.应答格式 === '工具调用' &&
            store.settings.额外模型解析配置.模型来源 !== '更多' &&
            !isFunctionCallingSupported()) ||
        !(await isExtraModelSupported())
    ) {
        if (!signal?.aborted && SillyTavern.getCurrentChatId() === chat_id) {
            await handleVariablesInMessage(message_id);
        }
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

    if (!isCurrentMessage()) {
        return;
    }

    // MESSAGE_RECEIVED 中立即发起请求。Promise 与目标快照均属于本次调用的闭包。
    const request_source = store.settings.额外模型解析配置.模型来源;
    const request_response_format = store.settings.额外模型解析配置.应答格式;
    const defer_until_rendered =
        !force &&
        request_response_format !== '工具调用' &&
        store.settings.兼容性.额外模型解析非阻塞;
    const result_promise = invokeExtraModelWithStrategy().catch(error => {
        // 错误提示描述实际发起的请求，避免等待期间面板切换导致错误归类失真。
        if (request_source === '更多') {
            toastr.error(
                getPiRequestFailureToastMessage(error, request_response_format),
                tr('runtime.extraModel.updateFailedTitle')
            );
        }
        throw error;
    });
    // 请求可能早于渲染失败；先登记拒绝处理，渲染回调仍从原 Promise 收到异常。
    void result_promise.catch(() => undefined);

    async function applyResult() {
        const result = await result_promise;
        if (!isCurrentMessage()) {
            return;
        }
        const updated_content =
            result === null ? message_content : message_content.trimEnd() + '\n\n' + result;
        if (result !== null) {
            await setChatMessages([{ message_id, message: updated_content }], { refresh: 'none' });
        } else if (request_source !== '更多') {
            toastr.error(
                tr('runtime.extraModel.updateFailed'),
                tr('runtime.extraModel.updateFailedTitle')
            );
        }
        if (isCurrentMessage(updated_content)) {
            await handleVariablesInMessage(message_id);
        }
    }

    if (!defer_until_rendered) {
        await applyResult();
        return;
    }
    // 不用 eventOnce：其他楼层的渲染不能消费本次监听。命中后先移除，避免变量写回
    // 以 refresh:'affected' 触发重入渲染；返回 Promise 让宿主在保存前等待写回完成。
    const onRendered = (rendered_message_id: number) => {
        if (!isCurrentMessage()) {
            stop();
            return;
        }
        if (rendered_message_id !== message_id) {
            return;
        }
        stop();
        return applyResult();
    };
    const stop = () => {
        eventRemoveListener(tavern_events.CHARACTER_MESSAGE_RENDERED, onRendered);
        signal?.removeEventListener('abort', stop);
    };
    eventOn(tavern_events.CHARACTER_MESSAGE_RENDERED, onRendered);
    // 聊天级模块卸载时清理尚未等到渲染的监听，也使在途请求的写回校验失效。
    signal?.addEventListener('abort', stop, { once: true });
}
