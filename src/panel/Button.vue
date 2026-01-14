<template>
    <Section>
        <template #title>修复按钮</template>
        <template #content>
            <div class="mvu-button-wrap">
                <div
                    v-for="button in buttons"
                    :key="button.name"
                    class="menu_button menu_button_icon interactable"
                    tabindex="0"
                    role="button"
                    @click="button.function"
                >
                    {{ button.name }}
                </div>
            </div>
        </template>
    </Section>
</template>

<script setup lang="ts">
import { buttons } from '@/button';
import Section from '@/panel/component/Section.vue';
</script>

<style scoped>
.mvu-button-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.6rem;
    align-items: center;
}

.mvu-button-wrap :deep(.menu_button) {
    box-sizing: border-box;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    justify-content: flex-start;
    padding: 0.35rem 0.6rem;
    min-height: unset;
    height: 2.05rem;
    line-height: 1.1;
}
</style>
