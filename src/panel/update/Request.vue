<template>
    <Detail title="请求策略">
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
import { useDataStore } from '@/store';

const store = useDataStore();
</script>
