<template>
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>MVU 变量框架</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>

        <div class="inline-drawer-content">
            <div class="flex-container flexFlowColumn">
                <div><strong>通知设置</strong></div>
                <label class="checkbox_label" for="mvu_notification_error">
                    <input
                        id="mvu_notification_error"
                        v-model="store.settings.通知.变量更新出错"
                        type="checkbox"
                    />
                    <span>变量更新出错时通知</span>
                </label>
                <label class="checkbox_label" for="mvu_notification_extra_model_parsing">
                    <input
                        id="mvu_notification_extra_model_parsing"
                        v-model="store.settings.通知.额外模型解析中"
                        type="checkbox"
                    />
                    <span>额外模型解析中通知</span>
                </label>
            </div>

            <hr />

            <div class="flex-container flexFlowColumn">
                <div>
                    <strong>变量更新方式</strong>
                    <i
                        class="fa-solid fa-circle-question fa-sm note-link-span"
                        style="cursor: pointer"
                        @click="showHelp"
                    ></i>
                </div>
                <select id="mvu_update_method" v-model="store.settings.更新方式" class="text_pole">
                    <option value="随AI输出">随AI输出</option>
                    <option value="额外模型解析">额外模型解析</option>
                </select>

                <template v-if="store.settings.更新方式 === '额外模型解析'">
                    <select
                        id="mvu_update_mode"
                        v-model="store.settings.额外模型解析配置.解析方式"
                        class="text_pole"
                    >
                        <option value="仅发送变量提示词">仅发送变量提示词</option>
                        <option value="发送变量提示词及预设">发送变量提示词及预设</option>
                        <option value="发送变量提示词及预设 (函数调用)">
                            发送变量提示词及预设 (函数调用)
                        </option>
                    </select>

                    <select
                        id="mvu_extra_model_source"
                        v-model="store.settings.额外模型解析配置.模型来源"
                        class="text_pole"
                    >
                        <option value="与插头相同">与插头相同</option>
                        <option value="自定义">自定义</option>
                    </select>

                    <template v-if="store.settings.额外模型解析配置.模型来源 === '自定义'">
                        <div class="flex-container flexFlowColumn">
                            <label for="mvu_api_url">API 地址</label>
                            <input
                                id="mvu_api_url"
                                v-model="store.settings.额外模型解析配置.api地址"
                                type="text"
                                class="text_pole"
                                placeholder="http://localhost:1234/v1"
                            />
                        </div>

                        <div class="flex-container flexFlowColumn">
                            <label for="mvu_api_key">API 密钥</label>
                            <input
                                id="mvu_api_key"
                                v-model="store.settings.额外模型解析配置.密钥"
                                type="password"
                                class="text_pole"
                                placeholder="留空表示无需密钥"
                            />
                        </div>

                        <div class="flex-container flexFlowColumn">
                            <label for="mvu_model_name">模型名称</label>
                            <input
                                id="mvu_model_name"
                                v-model="store.settings.额外模型解析配置.模型名称"
                                type="text"
                                class="text_pole"
                                placeholder="gemini-2.5-flash"
                            />
                        </div>
                    </template>
                </template>
            </div>

            <hr />

            <div class="flex-container flexFlowColumn">
                <div><strong>修复按钮</strong></div>
                <div class="flex-container flex">
                    <div
                        v-for="button in buttons"
                        :key="button.name"
                        class="menu_button menu_button_icon interactable"
                        tabindex="0"
                        role="button"
                        @click="button.function"
                    >
                        {{ button.name }}
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { buttons } from '@/button';
import panel_help from '@/panel_help.md';
import { useSettingsStore } from '@/settings';
import { get_sillytavern_version } from '@/util';
import { compare } from 'compare-versions';
import { watch } from 'vue';

const store = useSettingsStore();

watch(
    () => store.settings.更新方式,
    value => {
        if (value === '额外模型解析' && compare(get_sillytavern_version(), '1.13.4', '<')) {
            toastr.error(
                "检查到酒馆版本过低，要使用'额外模型解析'请保证酒馆版本大于等于 1.13.4",
                "[MVU]无法使用'额外模型解析'",
                { timeOut: 5000 }
            );
            store.settings.更新方式 = '随AI输出';
        }
    }
);

watch(
    () => store.settings.额外模型解析配置.解析方式,
    value => {
        if (value === '发送变量提示词及预设 (函数调用)') {
            if (!SillyTavern.ToolManager.isToolCallingSupported()) {
                toastr.error(
                    "请在 API 配置 (插头) 处将提示词后处理改为'含工具'的选项",
                    "[MVU]无法使用'函数调用'",
                    {
                        timeOut: 5000,
                    }
                );
            }
            if (SillyTavern.chatCompletionSettings.function_calling === false) {
                toastr.error(
                    "请在预设面板勾选'启用函数调用'选项",
                    "[MVU]无法使用'函数调用'",
                    {
                        timeOut: 5000,
                    }
                );
            }
            store.settings.额外模型解析配置.解析方式 = '发送变量提示词及预设';
        }
    }
);

async function showHelp() {
    SillyTavern.callGenericPopup(panel_help, SillyTavern.POPUP_TYPE.TEXT, '', {
        allowHorizontalScrolling: true,
        leftAlign: true,
        wide: true,
    });
}
</script>
