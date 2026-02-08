import { invokeExtraModelWithStrategy } from '@/function/response/invoke_extra_model';
import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { handleVariablesInMessage } from '@/function/update_variables';
import { useDataStore } from '@/store';
import { isFunctionCallingSupported } from '@/util';

export async function onMessageReceived(
    message_id: number,
    { force = false }: { force?: boolean } = {}
) {
    const current_chatmsg = getChatMessages(message_id).at(-1);
    if (!current_chatmsg) {
        return;
    }

    const message_content = current_chatmsg.message;
    if (message_content.length < 5) {
        //MESSAGE_RECEIVED 有时候也会在请求的一开始递交，会包含一个 "..." 的消息
        return;
    }

    const store = useDataStore();
    store.runtimes.is_during_extra_analysis = false;

    if (
        store.settings.更新方式 === '随AI输出' ||
        (store.settings.额外模型解析配置.使用函数调用 && !isFunctionCallingSupported()) || //与上面相同的退化情况。
        !(await isExtraModelSupported())
    ) {
        await handleVariablesInMessage(message_id);
        return;
    }

    if (SillyTavern.chat.length <= 1) {
        console.log('[MVU] 对第一层永不进行额外模型解析');
        return;
    }

    if (!force && store.settings.额外模型解析配置.启用自动请求 === false) {
        console.log('[MVU] 不自动触发额外模型解析');
        return;
    }

    const result = await invokeExtraModelWithStrategy();
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
    } else {
        toastr.error(
            '建议调整变量更新方式, 「输入框左下角魔棒-日志查看器」可查看具体情况',
            '[MVU额外模型解析]变量更新失败'
        );
    }
    await handleVariablesInMessage(message_id);
}
