import { defineStore } from 'pinia';
import { ref, toRaw, watch } from 'vue';
import * as z from 'zod';

const Settings = z
    .object({
        更新方式: z.enum(['随AI输出', '额外模型解析']).default('随AI输出'),
        额外模型解析配置: z
            .object({
                解析方式: z.enum(['仅发送变量提示词', '发送变量提示词及预设', '发送变量提示词及预设 (函数调用)']).default('发送变量提示词及预设'),
                模型来源: z.enum(['与插头相同', '自定义']).default('与插头相同'),
                api地址: z.string().default('http://localhost:1234/v1'),
                密钥: z.string().default(''),
                模型名称: z.string().default('gemini-2.5-flash'),
            })
            .prefault({}),
        通知: z
            .object({
                变量更新出错: z.boolean().default(false),
                额外模型解析中: z.boolean().default(true),
            })
            .prefault({}),
    })
    .prefault({});

export const useSettingsStore = defineStore('settings', () => {
    const settings = ref(Settings.parse(_.get(SillyTavern.extensionSettings, 'mvu_settings', {})));
    watch(
        settings,
        new_settings => {
            _.set(SillyTavern.extensionSettings, 'mvu_settings', toRaw(new_settings));
            SillyTavern.saveSettingsDebounced();
        },
        { deep: true }
    );

    return { settings };
});
