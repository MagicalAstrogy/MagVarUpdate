<template>
    <Section label="兼容性">
        <template #content>
            <Checkbox v-model="store.settings.兼容性.更新到聊天变量">
                <span>变量更新到聊天变量</span>
                <HelpIcon
                    help="启用后, 所有变量更新结果也会输出到聊天变量中. 如果部分老角色卡无法正常游玩, 可以开启这个开关."
                />
                <OverrideBadge
                    v-if="store.has_character_settings_override('兼容性.更新到聊天变量')"
                />
            </Checkbox>

            <Checkbox v-model="store.settings.兼容性.显示老旧功能">
                <span>显示老旧功能</span>
            </Checkbox>

            <Checkbox v-model="store.settings.兼容性.sendas不视为user消息">
                <span>sendas 不视为 user 消息</span>
                <HelpIcon :help="sandas_message_help" />
                <OverrideBadge
                    v-if="store.has_character_settings_override('兼容性.sendas不视为user消息')"
                />
            </Checkbox>
        </template>
    </Section>
</template>

<script setup lang="ts">
import Checkbox from '@/panel/component/Checkbox.vue';
import HelpIcon from '@/panel/component/HelpIcon.vue';
import OverrideBadge from '@/panel/component/OverrideBadge.vue';
import Section from '@/panel/component/Section.vue';
import sandas_message_help from '@/panel/compatibility_sandas_message.md';
import { useDataStore } from '@/store';

const store = useDataStore();
</script>
