<template>
    <Detail title="请求策略">
        <Field label="请求方式">
            <template #label-suffix>
                <HelpIcon :help="request_method_help" />
            </template>
            <Select
                v-model="store.settings.额外模型解析配置.请求方式"
                :options="[
                    '依次请求，失败后重试',
                    '同时请求多次',
                    '先请求一次, 失败后再同时请求多次',
                ]"
            />
        </Field>

        <Field label="请求次数">
            <RangeNumber
                v-model="store.settings.额外模型解析配置.请求次数"
                :min="
                    store.settings.额外模型解析配置.请求方式 === '先请求一次, 失败后再同时请求多次'
                        ? 2
                        : 1
                "
                :max="10"
                :step="1"
            />
        </Field>

        <Field label="自动请求">
            <template #label-suffix>
                <HelpIcon
                    help="如果关闭, 当 AI 回复完成时将不再自动触发额外模型解析, 而是需要你主动点击`重试额外模型解析`按钮才会进行解析工作并添加状态栏占位符 `<StatusPlaceHolderImpl/>`"
                />
            </template>
            <Checkbox v-model="store.settings.额外模型解析配置.启用自动请求">
                <span>启用</span>
            </Checkbox>
        </Field>
    </Detail>
</template>

<script setup lang="ts">
import Checkbox from '@/panel/component/Checkbox.vue';
import Detail from '@/panel/component/Detail.vue';
import Field from '@/panel/component/Field.vue';
import HelpIcon from '@/panel/component/HelpIcon.vue';
import RangeNumber from '@/panel/component/RangeNumber.vue';
import Select from '@/panel/component/Select.vue';
import request_method_help from '@/panel/update/request_method.md';
import { useDataStore } from '@/store';
import { getTavernHelperVersion } from '@/util';
import { compare } from 'compare-versions';
import { watch } from 'vue';

const store = useDataStore();

watch(
    () => store.settings.额外模型解析配置.请求方式,
    value => {
        if (value !== '依次请求，失败后重试' && compare(getTavernHelperVersion(), '4.4.3', '<')) {
            toastr.warning(
                '请升级酒馆助手到 4.4.3 或更高版本，否则批量请求功能可能让预设的「流式传输」设置失效',
                '[MVU]批量请求可能有问题',
                {
                    timeOut: 5000,
                }
            );
        }
    }
);
</script>
