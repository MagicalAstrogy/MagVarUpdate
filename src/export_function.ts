import {GameData, isValueWithDescription, variable_events, VariableData} from '@/variable_def';
import { handleVariablesInCallback, updateVariable } from '@/function';
import { loadInitVarData } from '@/variable_init';

export type DataCategory = 'stat' | 'display' | 'delta';

export function exportFunctions() {
    let mvu = {
        events: variable_events,
        processVariables: async function (message_content: string, game_data: GameData): Promise<GameData | undefined> {
            const variableData : VariableData = {
                old_variables: game_data
            }
            await handleVariablesInCallback(message_content, variableData);
            return variableData.new_variables;
        },
        getGameDataFromMessage: function (options: VariableOption): GameData {
            const result = getVariables(options);
            return result as GameData;
        },
        setGameDataToMessage: async function (options: VariableOption, game_data: GameData): Promise<void> {
            await replaceVariables(game_data, options);
        },
        getCurrentGameDataFromMessage: function(): GameData {
            const variables = getVariables({ type: 'message', message_id: getCurrentMessageId() });
            return variables as GameData;
        },
        setCurrentGameDataToMessage: async function (game_data: GameData): Promise<void> {
            await replaceVariables(game_data, { type: 'message', message_id: getCurrentMessageId() });
        },
        loadInitVarData: async function(game_data: GameData): Promise<boolean> {
            return await loadInitVarData(game_data);
        },
        mvuSetVariable: async function (game_data: GameData, path: string, newValue: any, reason: string, is_recursive: boolean): Promise<boolean> {
            return await updateVariable(game_data.stat_data, path, newValue, reason, is_recursive);
        },
        mvuGetVariable: function (game_data: GameData, category: DataCategory, path: string, default_value: any): any {
            let data: Record<string, any> | undefined = undefined;
            switch (category) {
                case 'stat':
                    data = game_data.stat_data;
                    break;
                case 'display':
                    data = game_data.display_data;
                    break;
                case "delta":
                    data = game_data.delta_data;
                    break;

            }
            const value = _.get(data, path);
            /* 如果值不存在，返回默认值*/
            if (value === undefined || value === null) {
                return default_value;
            }

            /* 如果是VWD，取第一个元素*/
            if (isValueWithDescription<any>(value)) {
                return value[0];
            }

            /* 否则直接返回值本身*/
            return value;
        }
    };

    _.set(window.parent, 'mvu', mvu);
    _.set(window.parent, 'MVU', mvu);
}
