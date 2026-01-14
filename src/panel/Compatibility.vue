<template>
    <Section>
        <template #title>兼容性</template>
        <template #content>
            <Checkbox v-model="store.settings.更新到聊天变量">
                <span>变量更新到聊天变量</span>
                <HelpIcon :help="chat_variable_help" />
            </Checkbox>

            <Checkbox v-model="store.settings.legacy.显示老旧功能">
                <span>显示老旧功能</span>
            </Checkbox>
        </template>
    </Section>
</template>

<script setup lang="ts">
import Checkbox from '@/panel/component/Checkbox.vue';
import HelpIcon from '@/panel/component/HelpIcon.vue';
import Section from '@/panel/component/Section.vue';
import chat_variable_help from '@/panel/help/chat_variable.md';
import { useSettingsStore } from '@/settings';

const store = useSettingsStore();
</script>
