<template>
    <Section>
        <template #title>
            变量更新方式
            <i
                class="fa-solid fa-circle-question fa-sm note-link-span"
                style="cursor: pointer"
                @click="showHelpPopup(panel_method_help)"
            />
        </template>
        <template #content>
            <Select v-model="store.settings.更新方式" :options="['随AI输出', '额外模型解析']" />

            <template v-if="store.settings.更新方式 === '额外模型解析'">
                <label>
                    解析方式
                    <i
                        class="fa-solid fa-circle-question fa-sm note-link-span"
                        style="cursor: pointer"
                        @click="showHelpPopup(panel_extra_mode_help)"
                    />
                </label>
                <Checkbox v-model="store.settings.额外模型解析配置.发送预设">
                    <span>发送预设</span>
                </Checkbox>

                <Checkbox v-model="store.settings.额外模型解析配置.使用函数调用">
                    <span>使用函数调用</span>
                </Checkbox>

                <Checkbox v-model="store.settings.自动触发额外模型解析">
                    <span>自动触发额外模型解析</span>
                    <i
                        class="fa-solid fa-circle-question fa-sm note-link-span"
                        style="cursor: pointer"
                        @click="showHelpPopup(auto_analyze_help)"
                    />
                </Checkbox>

                <label for="mvu_extra_model_source">模型来源</label>
                <Select
                    v-model="store.settings.额外模型解析配置.模型来源"
                    :options="['与插头相同', '自定义']"
                />

                <label for="mvu_extra_model_source">自定义API设置</label>
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
                        <label for="mvu_presence_penalty">Top P</label>
                        <input
                            id="mvu_presence_penalty"
                            v-model="store.settings.额外模型解析配置.top_p"
                            :disabled="!additional_extra_configuration_supported"
                            type="number"
                            class="text_pole"
                            min="0"
                            max="1"
                            step="0.01"
                            placeholder="1.0"
                        />
                    </div>
                </template>
            </template>
        </template>
    </Section>
</template>

<script setup lang="ts">
import Checkbox from '@/panel/component/Checkbox.vue';
import Section from '@/panel/component/Section.vue';
import Select from '@/panel/component/Select.vue';
import auto_analyze_help from '@/panel/help/auto_analyze.md';
import panel_extra_mode_help from '@/panel/help/extra_mode.md';
import panel_method_help from '@/panel/help/update_method.md';
import { useSettingsStore } from '@/settings';
import { getSillyTavernVersion, getTavernHelperVersion, showHelpPopup } from '@/util';
import { compare } from 'compare-versions';
import { watch } from 'vue';

const additional_extra_configuration_supported = compare(getTavernHelperVersion(), '4.0.14', '>=');

const store = useSettingsStore();

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
</script>
