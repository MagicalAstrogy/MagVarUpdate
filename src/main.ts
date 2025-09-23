import { registerButtons } from '@/button';
import { exportGlobals } from '@/export_globals';
import { handleVariablesInCallback, handleVariablesInMessage, updateVariable } from '@/function';
import { exported_events } from '@/variable_def';
import { initCheck } from '@/variable_init';
import { compare } from 'compare-versions';

$(async () => {
    if (compare(await getTavernHelperVersion(), '3.2.13', '<')) {
        toastr.warning(
            '酒馆助手版本过低, 可能无法正常处理, 请更新至 3.2.13 或更高版本（建议保持酒馆助手最新）'
        );
    }

    exportGlobals();
    registerButtons();
    eventOn(tavern_events.GENERATION_STARTED, initCheck);
    eventOn(tavern_events.MESSAGE_SENT, initCheck);
    eventOn(tavern_events.MESSAGE_SENT, handleVariablesInMessage);
    eventOn(tavern_events.MESSAGE_RECEIVED, handleVariablesInMessage);

    eventOn(exported_events.INVOKE_MVU_PROCESS, handleVariablesInCallback);
    eventOn(exported_events.UPDATE_VARIABLE, updateVariable);
    _.set(parent.window, 'handleVariablesInMessage', handleVariablesInMessage);
});
