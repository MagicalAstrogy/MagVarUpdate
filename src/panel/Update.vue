<template>
    <Section>
        <template #title>
            变量更新方式
            <HelpIcon :help="panel_method_help" />
        </template>
        <template #content>
            <Field label="更新方式">
                <Select v-model="store.settings.更新方式" :options="['随AI输出', '额外模型解析']" />
            </Field>

            <template
                v-if="
                    temp_contents.unsupported_warnings !== '' &&
                    store.settings.更新方式 === '额外模型解析'
                "
            >
                <div class="mvu-warning">
                    <span class="mvu-warning__icon">⚠️</span>
                    <span class="mvu-warning__text">
                        世界书 [{{ temp_contents.unsupported_warnings }}]
                        不支持额外模型解析，不会包含在额外模型解析轮次中，适配 [mvu_update]
                        条目以解决此问题。
                    </span>
                </div>
            </template>

            <template v-if="store.settings.更新方式 === '额外模型解析'">
                <div class="mvu-subtitle">
                    <span>解析方式</span>
                    <HelpIcon :help="panel_extra_mode_help" />
                </div>

                <Checkbox v-model="store.settings.额外模型解析配置.发送预设">
                    <span>发送预设</span>
                </Checkbox>

                <Checkbox v-model="store.settings.额外模型解析配置.使用函数调用">
                    <span>使用函数调用</span>
                </Checkbox>

                <Checkbox v-model="store.settings.自动触发额外模型解析">
                    <span>自动触发</span>
                    <HelpIcon :help="auto_analyze_help" />
                </Checkbox>

                <Field label="模型来源">
                    <Select
                        v-model="store.settings.额外模型解析配置.模型来源"
                        :options="['与插头相同', '自定义']"
                    />
                </Field>

                <template v-if="store.settings.额外模型解析配置.模型来源 === '自定义'">
                    <div class="mvu-subtitle">自定义 API</div>

                    <div class="mvu-field-grid">
                        <Field label="API 地址">
                            <input
                                v-model="store.settings.额外模型解析配置.api地址"
                                type="text"
                                class="text_pole"
                                placeholder="http://localhost:1234/v1"
                            />
                        </Field>

                        <Field label="API 密钥">
                            <input
                                v-model="store.settings.额外模型解析配置.密钥"
                                type="password"
                                class="text_pole"
                                placeholder="留空表示无需密钥"
                            />
                        </Field>

                        <Field label="模型名称">
                            <ModelSelect />
                        </Field>
                    </div>

                    <details class="mvu-details">
                        <summary class="mvu-details__summary">高级参数</summary>
                        <div class="mvu-details__content">
                            <div v-if="!additional_extra_configuration_supported" class="mvu-note">
                                ⚠️酒馆助手版本过低，不支持以下配置
                            </div>

                            <div class="mvu-advanced-grid">
                                <Field label="最大回复 token">
                                    <input
                                        v-model.number="
                                            store.settings.额外模型解析配置.最大回复token数
                                        "
                                        :disabled="!additional_extra_configuration_supported"
                                        type="number"
                                        class="text_pole"
                                        min="0"
                                        step="128"
                                        placeholder="4096"
                                    />
                                </Field>

                                <Field label="温度">
                                    <RangeNumber
                                        v-model="store.settings.额外模型解析配置.温度"
                                        :disabled="!additional_extra_configuration_supported"
                                        :min="0"
                                        :max="2"
                                        :step="0.01"
                                    />
                                </Field>

                                <Field label="Top P">
                                    <RangeNumber
                                        v-model="store.settings.额外模型解析配置.top_p"
                                        :disabled="!additional_extra_configuration_supported"
                                        :min="0"
                                        :max="1"
                                        :step="0.01"
                                    />
                                </Field>

                                <Field label="频率惩罚">
                                    <RangeNumber
                                        v-model="store.settings.额外模型解析配置.频率惩罚"
                                        :disabled="!additional_extra_configuration_supported"
                                        :min="-2"
                                        :max="2"
                                        :step="0.01"
                                    />
                                </Field>

                                <Field label="存在惩罚">
                                    <RangeNumber
                                        v-model="store.settings.额外模型解析配置.存在惩罚"
                                        :disabled="!additional_extra_configuration_supported"
                                        :min="-2"
                                        :max="2"
                                        :step="0.01"
                                    />
                                </Field>
                            </div>
                        </div>
                    </details>
                </template>
            </template>
        </template>
    </Section>
</template>

<script setup lang="ts">
import Checkbox from '@/panel/component/Checkbox.vue';
import Field from '@/panel/component/Field.vue';
import HelpIcon from '@/panel/component/HelpIcon.vue';
import ModelSelect from '@/panel/component/ModelSelect.vue';
import RangeNumber from '@/panel/component/RangeNumber.vue';
import Section from '@/panel/component/Section.vue';
import Select from '@/panel/component/Select.vue';
import auto_analyze_help from '@/panel/help/auto_analyze.md';
import panel_extra_mode_help from '@/panel/help/extra_mode.md';
import panel_method_help from '@/panel/help/update_method.md';
import { useSettingsStore, useTempContents } from '@/settings';
import { getSillyTavernVersion, getTavernHelperVersion } from '@/util';
import { compare } from 'compare-versions';
import { watch } from 'vue';

const additional_extra_configuration_supported = compare(getTavernHelperVersion(), '4.0.14', '>=');

const store = useSettingsStore();
const temp_contents = useTempContents().temp_contents;

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

<style scoped>
.mvu-subtitle {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-weight: 600;
    opacity: 0.9;
}

.mvu-field-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.mvu-details {
    border: 1px dashed var(--SmartThemeBorderColor, rgba(45, 45, 45, 1));
    border-radius: 10px;
    padding: 0.5rem 0.7rem;
    background-color: rgba(0, 0, 0, 0.06);
    background-color: color-mix(
        in srgb,
        var(--SmartThemeBlurTintColor, rgba(31, 31, 31, 1)) 70%,
        transparent
    );
}

.mvu-details__summary {
    cursor: pointer;
    user-select: none;
    font-weight: 600;
    opacity: 0.95;
}

.mvu-details__content {
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.mvu-note {
    opacity: 0.85;
    color: var(--SmartThemeEmColor, inherit);
}

.mvu-warning {
    margin-top: 0.5rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid color-mix(in srgb, var(--SmartThemeEmColor, #d39e00) 35%, transparent);
    border-radius: 10px;
    background-color: color-mix(in srgb, var(--SmartThemeEmColor, #fff3cd) 15%, transparent);
    color: var(--SmartThemeEmColor, #856404);
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 0.5rem;
    align-items: center;
}

.mvu-warning__icon {
    line-height: 1;
}

.mvu-warning__text {
    word-break: break-word;
}

.mvu-advanced-grid {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}

@media (max-width: 420px) {
    .mvu-option-grid {
        grid-template-columns: 1fr;
    }
}
</style>
