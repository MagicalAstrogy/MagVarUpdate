import { defineStore } from 'pinia';
import { ref, toRaw, watch } from 'vue';
import * as z from 'zod';

const Settings = z
    .object({
        更新方式: z.enum(['随AI输出', '额外模型解析']).prefault('随AI输出').catch('随AI输出'),
        额外模型解析配置: z
            .object({
                api地址: z.string().prefault('http://localhost:1234/v1'),
                密钥: z.string().prefault(''),
                模型名称: z.string().prefault('gemini-2.5-flash'),
            })
            .prefault({}),
        通知: z
            .object({
                变量更新出错: z.boolean().prefault(false).catch(false),
            })
            .prefault({}),
    })
    .prefault({});

export const useSettingsStore = defineStore('settings', () => {
    const settings = ref(
        Settings.parse(getVariables({ type: 'script', script_id: getScriptId() }))
    );

    watch(
        settings,
        new_settings =>
            insertOrAssignVariables(toRaw(new_settings), {
                type: 'script',
                script_id: getScriptId(),
            }),
        { deep: true }
    );
    return {
        settings,
    };
});
