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
                        @click="showMethodHelp"
                    />
                </div>
                <select id="mvu_update_method" v-model="store.settings.更新方式" class="text_pole">
                    <option value="随AI输出">随AI输出</option>
                    <option value="额外模型解析">额外模型解析</option>
                </select>

                <template v-if="store.settings.更新方式 === '额外模型解析'">
                    <label>
                        解析方式
                        <i
                            class="fa-solid fa-circle-question fa-sm note-link-span"
                            style="cursor: pointer"
                            @click="showExtraModeHelp"
                        />
                    </label>
                    <label class="checkbox_label" for="mvu_extra_model_send_preset">
                        <input
                            id="mvu_extra_model_send_preset"
                            v-model="store.settings.额外模型解析配置.发送预设"
                            type="checkbox"
                        />
                        <span>发送预设</span>
                    </label>
                    <label class="checkbox_label" for="mvu_extra_model_use_function_calling">
                        <input
                            id="mvu_extra_model_use_function_calling"
                            v-model="store.settings.额外模型解析配置.使用函数调用"
                            type="checkbox"
                        />
                        <span>使用函数调用</span>
                    </label>

                    <label for="mvu_extra_model_source">模型来源</label>
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

                        <div v-if="!additional_extra_configuration_supported">
                            <hr />
                            ⚠️酒馆助手版本过低, 不支持以下配置⚠️
                        </div>

                        <div class="flex-container flexFlowColumn">
                            <label for="mvu_temperature">温度</label>
                            <input
                                id="mvu_temperature"
                                v-model="store.settings.额外模型解析配置.温度"
                                :disabled="!additional_extra_configuration_supported"
                                type="number"
                                class="text_pole"
                                min="0"
                                max="2"
                                step="0.01"
                                placeholder="1.0"
                            />
                        </div>

                        <div class="flex-container flexFlowColumn">
                            <label for="mvu_frequency_penalty">频率惩罚</label>
                            <input
                                id="mvu_frequency_penalty"
                                v-model="store.settings.额外模型解析配置.频率惩罚"
                                :disabled="!additional_extra_configuration_supported"
                                type="number"
                                class="text_pole"
                                min="-2"
                                max="2"
                                step="0.01"
                                placeholder="0.0"
                            />
                        </div>

                        <div class="flex-container flexFlowColumn">
                            <label for="mvu_presence_penalty">存在惩罚</label>
                            <input
                                id="mvu_presence_penalty"
                                v-model="store.settings.额外模型解析配置.存在惩罚"
                                :disabled="!additional_extra_configuration_supported"
                                type="number"
                                class="text_pole"
                                min="-2"
                                max="2"
                                step="0.01"
                                placeholder="0.0"
                            />
                        </div>

                        <div class="flex-container flexFlowColumn">
                            <label for="mvu_max_tokens">最大回复token数</label>
                            <input
                                id="mvu_max_tokens"
                                v-model="store.settings.额外模型解析配置.最大回复token数"
                                :disabled="!additional_extra_configuration_supported"
                                type="number"
                                class="text_pole"
                                min="0"
                                step="128"
                                placeholder="1000"
                            />
                        </div>
                    </template>
                </template>
            </div>

            <hr />

            <div class="flex-container flexFlowColumn">
                <div>
                    <strong>杂项配置</strong>
                </div>
                <div class="collapse-container">
                    <button @click="is_open = !is_open" style="background: transparent">
                        {{ is_open ? '收起-变量清理配置' : '展开-变量清理配置' }}
                    </button>

                    <Transition name="collapse">
                        <div v-show="is_open" class="collapse-content">
                            <div class="flex-container flexFlowColumn">
                                <label for="mvu_snapshot_interval">快照保留间隔</label>
                                <input
                                    id="mvu_snapshot_interval"
                                    v-model.number="store.settings.快照保留间隔"
                                    type="number"
                                    min="1"
                                    step="1"
                                    class="text_pole"
                                    placeholder="50"
                                />
                            </div>

                            <div class="flex-container flexFlowColumn">
                                <label for="mvu_snapshot_interval">要保留变量的最近楼层数</label>
                                <input
                                    id="mvu_snapshot_interval"
                                    v-model.number="
                                        store.settings.auto_cleanup.要保留变量的最近楼层数
                                    "
                                    type="number"
                                    min="1"
                                    step="1"
                                    class="text_pole"
                                    placeholder="50"
                                />
                            </div>

                            <div class="flex-container flexFlowColumn">
                                <label for="mvu_snapshot_interval">触发恢复变量的最近楼层数</label>
                                <input
                                    id="mvu_snapshot_interval"
                                    v-model.number="
                                        store.settings.auto_cleanup.触发恢复变量的最近楼层数
                                    "
                                    type="number"
                                    min="1"
                                    step="1"
                                    class="text_pole"
                                    placeholder="50"
                                />
                            </div>
                        </div>
                    </Transition>
                </div>

                <label class="checkbox_label" for="mvu_auto_clean_checkbox">
                    <input
                        id="mvu_auto_clean_checkbox"
                        v-model="store.settings.auto_cleanup.启用"
                        type="checkbox"
                    />
                    <span>变量自动清理</span>
                </label>
                <label
                    class="checkbox_label"
                    for="mvu_auto_clean_checkbox"
                    title="启用后，所有变量更新结果也会输出到聊天变量中。如果部分老角色卡无法正常游玩，可以开启这个开关。"
                >
                    <input
                        id="mvu_auto_clean_checkbox"
                        v-model="store.settings.更新到聊天变量"
                        type="checkbox"
                    />
                    <span>变量更新到聊天变量</span>
                </label>
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
import panel_extra_mode_help from '@/panel_extra_mode_help.md';
import panel_method_help from '@/panel_method_help.md';
import { useSettingsStore } from '@/settings';
import { getSillyTavernVersion, getTavernHelperVersion } from '@/util';
import { compare } from 'compare-versions';
import { watch, ref } from 'vue';

const store = useSettingsStore();

const additional_extra_configuration_supported = compare(getTavernHelperVersion(), '4.0.14', '>=');

const is_open = ref(false);

watch(
    () => store.settings.更新方式,
    value => {
        if (value === '额外模型解析' && compare(getSillyTavernVersion(), '1.13.4', '<')) {
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
    () => store.settings.额外模型解析配置.使用函数调用,
    value => {
        if (value === true) {
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
                toastr.error("请在预设面板勾选'启用函数调用'选项", "[MVU]无法使用'函数调用'", {
                    timeOut: 5000,
                });
            }
            store.settings.额外模型解析配置.使用函数调用 = true;
        }
    }
);

async function showMethodHelp() {
    SillyTavern.callGenericPopup(panel_method_help, SillyTavern.POPUP_TYPE.TEXT, '', {
        allowVerticalScrolling: true,
        leftAlign: true,
        wide: true,
    });
}

async function showExtraModeHelp() {
    SillyTavern.callGenericPopup(panel_extra_mode_help, SillyTavern.POPUP_TYPE.TEXT, '', {
        allowVerticalScrolling: true,
        leftAlign: true,
        wide: true,
    });
}
</script>

<style scoped>
.collapse-container {
    border: 1px solid #ccc;
    border-radius: 4px;
    padding: 2px;
    background: transparent;
}

/* 过渡动画定义 */
.collapse-enter-from,
.collapse-leave-to {
    max-height: 0;
    opacity: 0;
    overflow: hidden;
}

.collapse-enter-to,
.collapse-leave-from {
    max-height: 240px; /* 根据内容调整 */
    opacity: 1;
}

.collapse-enter-active,
.collapse-leave-active {
    transition: all 0.3s ease;
}

.collapse-content {
    margin-top: 2px;
    padding: 2px;
    background-color: transparent;
    border-radius: 4px;
}
</style>
