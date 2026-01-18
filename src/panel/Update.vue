<template>
    <Section label="变量更新方式">
        <template #label-suffix>
            <HelpIcon :help="update_method_help" />
        </template>
        <template #content>
            <Method />

            <template v-if="store.settings.更新方式 === '额外模型解析'">
                <Prompt />
                <Request />
                <Source />
            </template>
        </template>
    </Section>
</template>

<script setup lang="ts">
import HelpIcon from '@/panel/component/HelpIcon.vue';
import Section from '@/panel/component/Section.vue';
import Method from '@/panel/update/Method.vue';
import Prompt from '@/panel/update/Prompt.vue';
import Request from '@/panel/update/Request.vue';
import Source from '@/panel/update/Source.vue';
import update_method_help from '@/panel/update_method.md';
import { useDataStore } from '@/store';

const store = useDataStore();
</script>
