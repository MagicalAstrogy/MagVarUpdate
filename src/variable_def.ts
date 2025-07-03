

export type GameData = {
    initialized_lorebooks: string[];
    stat_data: Record<string, any>;
    display_data: Record<string, any>;
    delta_data: Record<string, any>;
};

export interface VariableData
{
    old_variables: GameData,
    /**
     * 输出变量，仅当实际产生了变量变更的场合，会产生 newVariables
     */
    new_variables?: GameData
}

export const variable_events = {
    SINGLE_VARIABLE_UPDATED: 'mag_variable_updated',
    VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
    VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
    INVOKE_MVU_PROCESS: 'mag_invoke_mvu'
} as const;

export type ExtendedListenerType = {
    [variable_events.SINGLE_VARIABLE_UPDATED]: (
            stat_data: Record<string, any>,
            path: string,
            _oldValue: any,
            _newValue: any
    ) => void;
    [variable_events.VARIABLE_UPDATE_STARTED]: (
            variables: GameData,
            out_is_updated: boolean
    ) => void;
    [variable_events.VARIABLE_UPDATE_ENDED]: (variables: GameData, out_is_updated: boolean) => void;
    [variable_events.INVOKE_MVU_PROCESS]: (message_content: string, variable_info : VariableData) => void;
};
