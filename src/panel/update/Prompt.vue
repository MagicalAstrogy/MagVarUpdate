<template>
    <Detail title="请求内容">
        <Field label="破限方案">
            <template #label-suffix>
                <HelpIcon :help="prompt_break_help" />
            </template>
            <Select
                v-model="store.settings.额外模型解析配置.破限方案"
                :options="['使用内置破限', '使用当前预设', '使用其他预设']"
            />
        </Field>

        <Field v-if="store.settings.额外模型解析配置.破限方案 === '使用其他预设'" label="目标预设">
            <Select
                v-if="available_preset_names.length > 0"
                v-model="store.settings.额外模型解析配置.其他预设名称"
                :options="available_preset_names"
            />
            <input v-else class="text_pole" type="text" disabled value="未检测到可用的已保存预设" />
        </Field>

        <Field label="应答格式">
            <template #label-suffix>
                <HelpIcon :help="prompt_toolcall_help" />
            </template>
            <Select
                v-model="store.settings.额外模型解析配置.应答格式"
                :options="response_format_options"
            />
        </Field>

        <Field label="兼容假流式">
            <template #label-suffix>
                <HelpIcon
                    help="勾选后, 额外模型解析将会要求 AI 流式传输, 从而兼容一些需要假流式来保活的渠道模型"
                />
            </template>
            <Checkbox v-model="store.settings.额外模型解析配置.兼容假流式">
                <span>启用</span>
            </Checkbox>
        </Field>
    </Detail>
</template>

<script setup lang="ts">
import { getAvailableExtraModelPresetNames } from '@/function/update/extra_model_preset';
import { getFunctionCallingApiVersionUnsupportedMessage } from '@/function/is_function_calling_supported';
import Checkbox from '@/panel/component/Checkbox.vue';
import Detail from '@/panel/component/Detail.vue';
import Field from '@/panel/component/Field.vue';
import Select from '@/panel/component/Select.vue';
import prompt_break_help from '@/panel/update/prompt_break.md';
import prompt_toolcall_help from '@/panel/update/prompt_toolcall.md';
import { EXTRA_MODEL_RESPONSE_FORMATS, useDataStore } from '@/store';
import { computed, watch } from 'vue';
import HelpIcon from '../component/HelpIcon.vue';

const store = useDataStore();
const available_preset_names = computed(() => getAvailableExtraModelPresetNames());
const response_format_options = [...EXTRA_MODEL_RESPONSE_FORMATS];

function ensureValidPresetSelection() {
    if (store.settings.额外模型解析配置.破限方案 !== '使用其他预设') {
        return;
    }

    if (available_preset_names.value.length === 0) {
        store.settings.额外模型解析配置.其他预设名称 = '';
        return;
    }

    if (!available_preset_names.value.includes(store.settings.额外模型解析配置.其他预设名称)) {
        [store.settings.额外模型解析配置.其他预设名称] = available_preset_names.value;
    }
}

watch(available_preset_names, ensureValidPresetSelection, { immediate: true });
watch(
    () => store.settings.额外模型解析配置.破限方案,
    () => ensureValidPresetSelection(),
    { immediate: true }
);

watch(
    () => store.settings.额外模型解析配置.应答格式,
    value => {
        if (value === '工具调用') {
            const version_message = getFunctionCallingApiVersionUnsupportedMessage();
            if (version_message) {
                toastr.error(version_message, "[MVU]无法使用'工具调用'", {
                    timeOut: 5000,
                });
                store.settings.额外模型解析配置.应答格式 = '聊天消息';
                return;
            }
            if (!SillyTavern.ToolManager.isToolCallingSupported()) {
                toastr.error(
                    '当前 API 源不支持工具调用，请换用支持 tools 的渠道模型或改用其他应答格式',
                    "[MVU]无法使用'工具调用'",
                    {
                        timeOut: 5000,
                    }
                );
                store.settings.额外模型解析配置.应答格式 = '聊天消息';
                return;
            }
        }
    }
);
</script>
