import { defineStore } from 'pinia';
import { ref, toRaw, watch } from 'vue';
import * as z from 'zod';
import { compare } from 'compare-versions';

let cachedSillyTavernVersion: string = '1.1.0';

export async function initTavernHelperVersion(): Promise<void> {
    const versionInfo = await fetch('/version')
        .then(res => res.json())
        .then(data => data.pkgVersion);
    cachedSillyTavernVersion = versionInfo;
}

export function getCachedSillyTavernVersion(): string {
    return cachedSillyTavernVersion;
}

const Settings = z
    .object({
        更新方式: z.enum(['随AI输出', '额外模型解析']).prefault('随AI输出').catch('随AI输出'),
        额外模型解析配置: z
            .object({
                模型来源: z.enum(['与插头相同', '自定义']).default('与插头相同'),
                api地址: z.string().prefault('http://localhost:1234/v1'),
                密钥: z.string().prefault(''),
                模型名称: z.string().prefault('gemini-2.5-flash'),
            })
            .prefault({}),
        额外模型解析模式: z
            .enum(['不含预设', '含预设', '函数调用含预设'])
            .prefault('含预设')
            .catch('含预设'),
        通知: z
            .object({
                变量更新出错: z.boolean().prefault(true).catch(true),
                额外模型解析中: z.boolean().prefault(true).catch(true),
            })
            .prefault({}),
    })
    .prefault({});

export const useSettingsStore = defineStore('settings', () => {
    const settings = ref(Settings.parse(_.get(SillyTavern.extensionSettings, 'mvu_settings', {})));
    watch(
        settings,
        new_settings => {
            if (new_settings.更新方式 === '额外模型解析') {
                if (compare(getCachedSillyTavernVersion(), '1.13.4', '<')) {
                    toastr.error(
                        '检查到酒馆版本过低，请升级到 1.13.4 以上版本以使用 额外模型解析',
                        '配置错误',
                        { timeOut: 5000 }
                    );
                    new_settings.更新方式 = '随AI输出';
                }
            }
            if (new_settings.额外模型解析模式 === '函数调用含预设') {
                if (!SillyTavern.ToolManager.isToolCallingSupported()) {
                    toastr.error(
                        '检查到插头处未启动 “含工具” 的提示词后处理，无法使用函数调用',
                        '配置错误',
                        { timeOut: 5000 }
                    );
                }
                if (SillyTavern.chatCompletionSettings.function_calling === false) {
                    toastr.error(
                        '检查到预设处未开启 “启用函数调用”，无法使用函数调用',
                        '配置错误',
                        {
                            timeOut: 5000,
                        }
                    );
                }
            }
            _.set(SillyTavern.extensionSettings, 'mvu_settings', toRaw(new_settings));
            SillyTavern.saveSettingsDebounced();
        },
        { deep: true }
    );

    return { settings };
});
