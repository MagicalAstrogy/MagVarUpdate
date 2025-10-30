import { defineStore } from 'pinia';
import { ref, toRaw, watch } from 'vue';
import * as z from 'zod';

const Settings = z
    .object({
        更新方式: z.enum(['随AI输出', '额外模型解析']).default('随AI输出'),
        额外模型解析配置: z
            .object({
                发送预设: z.boolean().default(true),
                使用函数调用: z.boolean().default(false),
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
        快照保留间隔: z.number().default(50),
        auto_cleanup: z
            .object({
                启用: z.boolean().default(false),
                要保留变量的最近楼层数: z.number().default(20),
                触发恢复变量的最近楼层数: z.number().default(10),
            })
            .prefault({}),
        internal: z
            .object({
                已提醒更新了配置界面: z.boolean().default(false),
                已提醒自动清理旧变量功能: z.boolean().default(false),
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
