import * as z from 'zod';

const MvuSettings = z
    .object({
        是否显示变量更新错误: z.enum(['是', '否']).prefault('否').catch('否'),
    })
    .prefault({});
export type MvuSettings = z.infer<typeof MvuSettings>;

let settings: MvuSettings;
export function getSettings(): MvuSettings {
    if (!settings) {
        const variable_option = { type: 'script', script_id: getScriptId() } as const;
        settings = MvuSettings.parse(getVariables(variable_option));
        insertOrAssignVariables(settings, variable_option);
    }
    return settings;
}
