<template>
    <label class="checkbox_label" :for="id">
        <input :id="id" v-model="model" type="checkbox" :disabled="disabled" />
        <slot />
    </label>
</template>

<script setup lang="ts">
defineProps<{
    id?: string;
    /** 将能力限制传给原生控件，禁用时保留已有配置值。 */
    disabled?: boolean;
}>();

const model = defineModel<boolean>({ required: true });
</script>
