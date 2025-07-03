import {handleVariablesInMessage, handleVariablesInCallback} from '@/function';
import {initCheck} from '@/variable_init';
import {variable_events} from "@/variable_def";

$(() => {
    eventOn(tavern_events.GENERATION_STARTED, initCheck);
    eventOn(tavern_events.MESSAGE_SENT, initCheck);
    eventOn(tavern_events.MESSAGE_SENT, handleVariablesInMessage);
    eventOn(tavern_events.MESSAGE_RECEIVED, handleVariablesInMessage);
    eventOn(variable_events.INVOKE_MVU_PROCESS, handleVariablesInCallback);

    // 导出到窗口，便于调试
    _.set(window, 'handleVariablesInMessage', handleVariablesInMessage);
});

$(window).on('unload', () => {
    eventRemoveListener(tavern_events.GENERATION_STARTED, initCheck);
    eventRemoveListener(tavern_events.MESSAGE_SENT, initCheck);
    eventRemoveListener(tavern_events.MESSAGE_SENT, handleVariablesInMessage);
    eventRemoveListener(tavern_events.MESSAGE_RECEIVED, handleVariablesInMessage);
    eventRemoveListener(variable_events.INVOKE_MVU_PROCESS, handleVariablesInCallback);
});

eventOnButton('重新处理变量', async function () {
    const last_msg = getLastMessageId();
    if (last_msg < 1) return;
    if (SillyTavern.chat.length === 0) return;
    await deleteVariable('stat_data', { type: 'message', message_id: last_msg });
    //重新处理变量
    await handleVariablesInMessage(getLastMessageId());
});
