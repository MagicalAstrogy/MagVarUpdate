<template>
    <Section label="兼容性">
        <template #content>
            <Checkbox v-model="store.settings.兼容性.更新到聊天变量">
                <span>变量更新到聊天变量</span>
                <HelpIcon
                    help="启用后, 所有变量更新结果也会输出到聊天变量中. 如果部分老角色卡无法正常游玩, 可以开启这个开关."
                />
            </Checkbox>

            <Checkbox v-model="store.settings.兼容性.显示老旧功能">
                <span>显示老旧功能</span>
            </Checkbox>
        </template>
    </Section>
</template>

<script setup lang="ts">
import Checkbox from '@/panel/component/Checkbox.vue';
import HelpIcon from '@/panel/component/HelpIcon.vue';
import Section from '@/panel/component/Section.vue';
import { useDataStore } from '@/store';

const store = useDataStore();
</script>
