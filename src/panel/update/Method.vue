<template>
    <Select v-model="store.settings.更新方式" :options="['随AI输出', '额外模型解析']" />

    <template
        v-if="
            store.runtimes.unsupported_warnings !== '' && store.settings.更新方式 === '额外模型解析'
        "
    >
        <div class="mvu-warning">
            <span class="mvu-warning__icon">ℹ️</span>
            <span class="mvu-warning__text">
                世界书 [{{ store.runtimes.unsupported_warnings }}] 未适配额外模型解析, 视为
                [mvu_plot] 条目 (只会发给剧情 AI、不会发给变量更新 AI).
                <HelpIcon :help="update_method_help" />
            </span>
        </div>
    </template>
</template>

<script setup lang="ts">
import HelpIcon from '@/panel/component/HelpIcon.vue';
import Select from '@/panel/component/Select.vue';
import update_method_help from '@/panel/update_method.md';
import { useDataStore } from '@/store';

const store = useDataStore();
</script>

<style scoped>
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
</style>
