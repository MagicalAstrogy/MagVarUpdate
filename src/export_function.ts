import { variable_events } from '@/variable_def';
import { handleVariablesInCallback, updateVariable } from '@/function';
import { createEmptyGameData, loadInitVarData } from '@/variable_init';

export function exportFunctions() {
    let mvu = {
        events: variable_events,
        asyncProcessVariables: handleVariablesInCallback,
        createEmptyGameData: createEmptyGameData,
        loadInitVarData: loadInitVarData,
        mvuUpdateVariable: updateVariable,
    };

    _.set(window.parent, 'mvu', mvu);
    _.set(window.parent, 'MVU', mvu);
}
