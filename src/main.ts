import { handleVariablesInMessage } from '@/function';
import { initCheck } from '@/variable_init';

$(() => {
    eventOn(tavern_events.GENERATION_STARTED, initCheck);
    eventOn(tavern_events.MESSAGE_SENT, initCheck);
    eventOn(tavern_events.MESSAGE_SENT, handleVariablesInMessage);
    eventOn(tavern_events.MESSAGE_RECEIVED, handleVariablesInMessage);

    // 导出到窗口，便于调试
    _.set(window, 'handleVariablesInMessage', handleVariablesInMessage);
});

$(window).on('unload', () => {
    eventRemoveListener(tavern_events.GENERATION_STARTED, initCheck);
    eventRemoveListener(tavern_events.MESSAGE_SENT, initCheck);
    eventRemoveListener(tavern_events.MESSAGE_SENT, handleVariablesInMessage);
    eventRemoveListener(tavern_events.MESSAGE_RECEIVED, handleVariablesInMessage);
});

export type GameData = {
    // initialized_lorebooks 从字符串列表变为记录对象
    // 这样可以为每个知识库存储元数据，例如初始化的标记变量
    initialized_lorebooks: Record<string, any[]>;
    stat_data: Record<string, any>;
    display_data: Record<string, any>;
    delta_data: Record<string, any>;
    // 用于存储数据结构的模式
    schema: Record<string, any>;
};

export const variable_events = {
    SINGLE_VARIABLE_UPDATED: 'mag_variable_updated',
    VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
    VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
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
};
