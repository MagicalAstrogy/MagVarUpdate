<template>
    <Detail title="提示词设定">
        <Field label="破限方案">
            <Checkbox v-model="store.settings.额外模型解析配置.发送预设">
                <span>启用</span>
            </Checkbox>
        </Field>

        <Field label="函数调用">
            <template #label-suffix>
                <HelpIcon :help="prompt_toolcall_help" />
            </template>
            <Checkbox v-model="store.settings.额外模型解析配置.使用函数调用">
                <span>启用</span>
            </Checkbox>
        </Field>
    </Detail>
</template>

<script setup lang="ts">
import Checkbox from '@/panel/component/Checkbox.vue';
import Detail from '@/panel/component/Detail.vue';
import Field from '@/panel/component/Field.vue';
import prompt_toolcall_help from '@/panel/update/prompt_toolcall.md';
import { useDataStore } from '@/store';
import { watch } from 'vue';
import HelpIcon from '../component/HelpIcon.vue';

const store = useDataStore();

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
                toastr.error("请在预设面板勾选'使用函数调用'选项", "[MVU]无法使用'函数调用'", {
                    timeOut: 5000,
                });
            }
            store.settings.额外模型解析配置.使用函数调用 = true;
        }
    }
);
</script>
