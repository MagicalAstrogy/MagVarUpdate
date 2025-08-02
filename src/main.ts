import { registerButtons } from '@/button';
import {handleVariablesInCallback, handleVariablesInMessage, updateVariable} from '@/function';
import { variable_events } from '@/variable_def';
import { initCheck } from '@/variable_init';
import { exportFunctions } from '@/export_function';

$(() => {
    registerButtons();
    exportFunctions();
    eventOn(tavern_events.GENERATION_STARTED, initCheck);
    eventOn(tavern_events.MESSAGE_SENT, initCheck);
    eventOn(tavern_events.MESSAGE_SENT, handleVariablesInMessage);
    eventOn(tavern_events.MESSAGE_RECEIVED, handleVariablesInMessage);
    eventOn(variable_events.INVOKE_MVU_PROCESS, handleVariablesInCallback);
    eventOn(variable_events.UPDATE_VARIABLE, updateVariable);

    // 导出到窗口，便于调试
    _.set(window, 'handleVariablesInMessage', handleVariablesInMessage);
});
