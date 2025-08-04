import { handleVariablesInCallback, updateVariable } from '@/function';
import {
    extractRecord,
    isValueWithDescription,
    MvuData,
    variable_events,
    VariableData,
} from '@/variable_def';
import { loadInitVarData } from '@/variable_init';

export function exportGlobals() {
    const mvu = {
        events: variable_events,

        parseMessage: async function (
            message: string,
            old_data: MvuData
        ): Promise<MvuData | undefined> {
            const variableData: VariableData = {
                old_variables: old_data,
            };
            await handleVariablesInCallback(message, variableData);
            return variableData.new_variables;
        },

        getMvuData: function (options: VariableOption): MvuData {
            const result = getVariables(options);
            return result as MvuData;
        },
        replaceMvuData: async function (mvu_data: MvuData, options: VariableOption): Promise<void> {
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

        reloadInitVar: async function (mvu_data: MvuData): Promise<boolean> {
            return await loadInitVarData(mvu_data);
        },

        setMvuVariable: async function (
            mvu_data: MvuData,
            path: string,
            new_value: any,
            { reason = '', is_recursive = false }: { reason?: string; is_recursive?: boolean } = {}
        ): Promise<boolean> {
            return await updateVariable(mvu_data.stat_data, path, new_value, reason, is_recursive);
        },
        getMvuVariable: function (
            mvu_data: MvuData,
            path: string,
            {
                category = 'stat',
                default_value = undefined,
            }: { category?: 'stat' | 'display' | 'delta'; default_value?: any } = {}
        ): any {
            let data: Record<string, any>;
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

            const value = _.get(data, path, default_value);

            /* 如果是 VWD，取第一个元素 */
            if (isValueWithDescription<any>(value)) {
                return value[0];
            }

            /* 否则直接返回值本身 */
            return value;
        },
        getRecordFromMvuData: function (
            mvu_data: MvuData,
            category: 'stat' | 'display' | 'delta'
        ): Record<string, any> {
            /* 一般来说只有 llm 准备 foreach 数据时需要用 */
            return extractRecord(category, mvu_data);
        },
    };
    _.set(window, 'Mvu', mvu);
    _.set(window.parent, 'Mvu', mvu);
}
