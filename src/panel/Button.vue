<template>
    <Section>
        <template #title>修复按钮</template>
        <template #content>
            <div class="flex-container flex">
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
