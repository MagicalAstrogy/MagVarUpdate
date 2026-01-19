<template>
    <Section label="通知设置">
        <template #content>
            <Checkbox v-model="store.settings.通知.MVU框架加载成功">
                <span>MVU框架加载成功时通知</span>
            </Checkbox>
            <Checkbox v-model="store.settings.通知.变量初始化成功">
                <span>变量初始化成功时通知</span>
            </Checkbox>
            <Checkbox v-model="store.settings.通知.变量更新出错">
                <span>变量初始化/更新出错时通知</span>
            </Checkbox>
            <Checkbox v-model="store.settings.通知.额外模型解析中">
                <span>额外模型解析中通知</span>
            </Checkbox>
        </template>
    </Section>
</template>

<script setup lang="ts">
import Checkbox from '@/panel/component/Checkbox.vue';
import Section from '@/panel/component/Section.vue';
import { useDataStore } from '@/store';

const store = useDataStore();
</script>
