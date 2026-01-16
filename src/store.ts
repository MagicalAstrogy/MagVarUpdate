import { is_jest_environment } from '@/util';
import { defineStore } from 'pinia';
import { ref, toRaw, watch } from 'vue';
import * as z from 'zod';

export const Settings = z
    .object({
        通知: z
            .object({
                变量更新出错: z.boolean().default(false),
                额外模型解析中: z.boolean().default(true),
            })
            .prefault({}),
        更新方式: z.enum(['随AI输出', '额外模型解析']).default('随AI输出'),
        额外模型解析配置: z
            .object({
                发送预设: z.boolean().default(true),
                使用函数调用: z.boolean().default(false),

                启用自动请求: z.boolean().default(true),
                请求次数: z.number().default(3),

                模型来源: z.enum(['与插头相同', '自定义']).default('与插头相同'),
                api地址: z.string().default('http://localhost:1234/v1'),
                密钥: z.string().default(''),
                模型名称: z.string().default('gemini-2.5-flash-nothinking'),
                温度: z.coerce
                    .number()
                    .default(1)
                    .transform(value => _.clamp(value, 0, 2)),
                频率惩罚: z.coerce
                    .number()
                    .default(0.0)
                    .transform(value => _.clamp(value, -2, 2)),
                存在惩罚: z.coerce
                    .number()
                    .default(0.0)
                    .transform(value => _.clamp(value, -2, 2)),
                top_p: z.coerce
                    .number()
                    .default(1)
                    .transform(value => _.clamp(value, 0, 1)),
                最大回复token数: z.coerce
                    .number()
                    .default(4096)
                    .transform(value => Math.max(0, value)),
            })
            .prefault({}),
        自动清理变量: z
            .object({
                启用: z.boolean().default(true),
                快照保留间隔: z.number().default(50),
                要保留变量的最近楼层数: z.number().default(20),
                触发恢复变量的最近楼层数: z.number().default(10),
            })
            .prefault({}),
        兼容性: z
            .object({
                更新到聊天变量: z.boolean().default(false),
                显示老旧功能: z.boolean().default(false),
            })
            .prefault({}),
        internal: z
            .object({
                已提醒更新了配置界面: z.boolean().default(false),
                已提醒自动清理旧变量功能: z.boolean().default(false),
                已提醒更新了API温度等配置: z.boolean().default(false),
                已默认开启自动清理旧变量功能: z.boolean().default(false),
            })
            .prefault({}),
    })
    .prefault({});

const Runtimes = z
    .object({
        unsupported_warnings: z.string().default(''),
        is_extra_model_supported: z.boolean().default(false),
        is_during_extra_analysis: z.boolean().default(false),
        is_function_call_enabled: z.boolean().default(false),
    })
    .prefault({});

export const useDataStore = defineStore('data', () => {
    const settings = ref(Settings.parse(_.get(SillyTavern.extensionSettings, 'mvu_settings', {})));
    watch(
        settings,
        new_settings => {
            _.set(SillyTavern.extensionSettings, 'mvu_settings', toRaw(new_settings));
            if (!is_jest_environment) SillyTavern.saveSettingsDebounced();
        },
        { deep: true }
    );

    const runtimes = ref(Runtimes.parse({}));
    watch(
        () => runtimes.value.is_during_extra_analysis,
        new_value => insertOrAssignVariables({ extra_analysis: new_value }, { type: 'global' }),
        { immediate: true }
    );
    const resetRuntimes = () => {
        runtimes.value = Runtimes.parse({});
    };

    return { settings, runtimes, resetRuntimes };
});
