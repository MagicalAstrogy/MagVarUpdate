import { variable_events } from '@/variable_def';
import { handleVariablesInCallback, updateVariable } from '@/function';
import { loadInitVarData } from '@/variable_init';

export function exportFunctions() {
    let mvu = {
        events: variable_events,
        processVariables: handleVariablesInCallback,
        loadInitVarData: loadInitVarData,
        mvuUpdateVariable: updateVariable,
    };

    _.set(window.parent, 'mvu', mvu);
    _.set(window.parent, 'MVU', mvu);
}
