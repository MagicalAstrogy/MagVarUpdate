import { registerButtons } from '@/button';
import { handleVariablesInCallback, handleVariablesInMessage } from '@/function';
import { variable_events } from '@/variable_def';
import { updateDescriptions } from '@/update_descriptions';
import { cleanUpMetadata, reconcileAndApplySchema } from '@/schema';
import { initCheck, createEmptyGameData, loadInitVarData } from '@/variable_init';
import { getLastValidVariable } from '@/function';

$(() => {
    registerButtons();
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
