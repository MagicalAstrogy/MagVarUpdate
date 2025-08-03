export type ValueWithDescription<T> = [T, string];

export function isValueWithDescription<T>(value: unknown): value is ValueWithDescription<T> {
    return Array.isArray(value) && value.length === 2 && typeof value[1] === 'string';
}

export type MvuData = {
    initialized_lorebooks: string[];
    stat_data: Record<string, any> & { $internal?: InternalData };
    display_data: Record<string, any>;
    delta_data: Record<string, any>;
};

export interface VariableData {
    old_variables: MvuData;
    /**
     * 输出变量，仅当实际产生了变量变更的场合，会产生 newVariables
     */
    new_variables?: MvuData;
}

export const variable_events = {
    SINGLE_VARIABLE_UPDATED: 'mag_variable_updated',
    VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
    VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
} as const;
export const exported_events = {
    INVOKE_MVU_PROCESS: 'mag_invoke_mvu',
    UPDATE_VARIABLE: 'mag_update_variable',
};

export type InternalData = {
    stat_data: Record<string, any>;
    display_data: Record<string, any>;
    delta_data: Record<string, any>;
};

export type ExtendedListenerType = {
    [variable_events.SINGLE_VARIABLE_UPDATED]: (
        stat_data: Record<string, any>,
        path: string,
        _oldValue: any,
        _newValue: any
    ) => void;
    [variable_events.VARIABLE_UPDATE_STARTED]: (
        variables: MvuData,
        out_is_updated: boolean
    ) => void;
    [variable_events.VARIABLE_UPDATE_ENDED]: (variables: MvuData, out_is_updated: boolean) => void;
    [exported_events.INVOKE_MVU_PROCESS]: (
        message_content: string,
        variable_info: VariableData
    ) => void;
    [exported_events.UPDATE_VARIABLE]: (
        stat_data: Record<string, any>,
        path: string,
        newValue: any,
        reason: string,
        isRecursive: boolean
    ) => void;
};

export type DataCategory = 'stat' | 'display' | 'delta';

export function extractRecord(category: 'stat' | 'display' | 'delta', game_data: MvuData) {
    let data: Record<string, any> | undefined = undefined;
    switch (category) {
        case 'stat':
            data = game_data.stat_data;
            break;
        case 'display':
            data = game_data.display_data;
            break;
        case 'delta':
            data = game_data.delta_data;
            break;
    }
    return data;
}
