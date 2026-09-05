import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { isFunctionCallingSupported } from '@/function/is_function_calling_supported';
import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import { getPiRequestFailureToastMessage } from '@/function/update/pi/error_localization';
import { isPiMultiproviderEnabled } from '@/function/update/pi/feature_flag';
import { withPendingVariableUpdate } from '@/function/update/variable_update_queue';
import { handleVariablesInMessage } from '@/function/update_variables';
import { tr } from '@/i18n';
import { useDataStore } from '@/store';

export async function onMessageReceived(message_id: number, options: { force?: boolean } = {}) {
    return withPendingVariableUpdate(message_id, () => receiveMessage(message_id, options));
}

async function receiveMessage(message_id: number, { force = false }: { force?: boolean } = {}) {
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
        (store.settings.额外模型解析配置.模型来源 === '更多' && !isPiMultiproviderEnabled()) ||
        (store.settings.额外模型解析配置.应答格式 === '工具调用' &&
            store.settings.额外模型解析配置.模型来源 !== '更多' &&
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

    // The user can edit the panel while a request is in flight. Error routing must describe the
    // request that actually failed, not whichever source/format happens to be selected later.
    const request_source = store.settings.额外模型解析配置.模型来源;
    const request_response_format = store.settings.额外模型解析配置.应答格式;
    let result: string | null;
    try {
        result = await invokeExtraModelWithStrategy();
    } catch (error) {
        if (request_source !== '更多') {
            throw error;
        }
        toastr.error(
            getPiRequestFailureToastMessage(error, request_response_format),
            tr('runtime.extraModel.updateFailedTitle')
        );
        throw error;
    }
    if (result !== null) {
        const chat_message = getChatMessages(message_id);

        await setChatMessages(
            [
                {
                    message_id,
                    message: chat_message[0].message.trimEnd() + '\n\n' + result,
                },
            ],
            {
                refresh: 'none',
            }
        );
    } else if (request_source !== '更多') {
        toastr.error(
            tr('runtime.extraModel.updateFailed'),
            tr('runtime.extraModel.updateFailedTitle')
        );
    }
    await handleVariablesInMessage(message_id);
}
