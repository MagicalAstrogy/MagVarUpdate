import { handleVariablesInCallback, updateVariable } from '@/function';
import { isValueWithDescription, MvuData, variable_events, VariableData } from '@/variable_def';
import { loadInitVarData } from '@/variable_init';

export type DataCategory = 'stat' | 'display' | 'delta';

export function exportFunctions() {
    const mvu = {
        events: variable_events,
        processVariables: async function (
            message_content: string,
            mvu_data: MvuData
        ): Promise<MvuData | undefined> {
            const variableData: VariableData = {
                old_variables: mvu_data,
            };
            await handleVariablesInCallback(message_content, variableData);
            return variableData.new_variables;
        },
        getMvuData: function (options: VariableOption): MvuData {
            const result = getVariables(options);
            return result as MvuData;
        },
        replaceMvuData: async function (options: VariableOption, mvu_data: MvuData): Promise<void> {
            await replaceVariables(mvu_data, options);
        },
        getCurrentMvuData: function (): MvuData {
            const variables = getVariables({ type: 'message', message_id: getCurrentMessageId() });
            return variables as MvuData;
        },
        replaceCurrentMvuData: async function (mvu_data: MvuData): Promise<void> {
            await replaceVariables(mvu_data, {
                type: 'message',
                message_id: getCurrentMessageId(),
            });
        },
        loadInitVarData: async function (mvu_data: MvuData): Promise<boolean> {
            return await loadInitVarData(mvu_data);
        },
        mvuSetVariable: async function (
            mvu_data: MvuData,
            path: string,
            newValue: any,
            reason: string,
            is_recursive: boolean
        ): Promise<boolean> {
            return await updateVariable(mvu_data.stat_data, path, newValue, reason, is_recursive);
        },
        mvuGetVariable: function (
            mvu_data: MvuData,
            category: DataCategory,
            path: string,
            default_value: any
        ): any {
            let data: Record<string, any> | undefined = undefined;
            switch (category) {
                case 'stat':
                    data = mvu_data.stat_data;
                    break;
                case 'display':
                    data = mvu_data.display_data;
                    break;
                case 'delta':
                    data = mvu_data.delta_data;
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
        },
    };

    _.set(window.parent, 'Mvu', mvu);
}
