import { registerButtons } from '@/button';
import { exportGlobals } from '@/export_globals';
import { handleVariablesInCallback, handleVariablesInMessage, updateVariable } from '@/function';
import { exported_events } from '@/variable_def';
import { initCheck } from '@/variable_init';
import { GetSettings } from '@/settings';
import { compare } from 'compare-versions';

$(async () => {
    registerButtons();
    exportGlobals();
    eventOn(tavern_events.GENERATION_STARTED, initCheck);
    eventOn(tavern_events.MESSAGE_SENT, initCheck);
    eventOn(tavern_events.MESSAGE_SENT, handleVariablesInMessage);
    eventOn(tavern_events.MESSAGE_RECEIVED, handleVariablesInMessage);
    eventOn(exported_events.INVOKE_MVU_PROCESS, handleVariablesInCallback);
    eventOn(exported_events.UPDATE_VARIABLE, updateVariable);
    await GetSettings();

    // 导出到窗口，便于调试
    try {
        _.set(parent.window, 'handleVariablesInMessage', handleVariablesInMessage);
    } catch (_e) {
        /* empty */
    }

    try {
        const version = await getTavernHelperVersion();
        if (compare(version, '3.2.13', '<')) {
            toastr.warning(
                '酒馆助手版本过低, 可能无法正常处理, 请更新至 3.2.13 或更高版本（建议保持酒馆助手最新）'
            );
        }
    } catch (_e) {
        /* empty */
    }
});

$(window).on('unload', () => {
    eventRemoveListener(tavern_events.GENERATION_STARTED, initCheck);
    eventRemoveListener(tavern_events.MESSAGE_SENT, initCheck);
    eventRemoveListener(tavern_events.MESSAGE_SENT, handleVariablesInMessage);
    eventRemoveListener(tavern_events.MESSAGE_RECEIVED, handleVariablesInMessage);
    eventRemoveListener(exported_events.INVOKE_MVU_PROCESS, handleVariablesInCallback);
});
