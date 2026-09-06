<template>
    <label class="checkbox_label" :for="id">
        <input :id="id" v-model="model" type="checkbox" :disabled="disabled" />
        <slot />
    </label>
</template>

<script setup lang="ts">
defineProps<{
    id?: string;
    disabled?: boolean;
}>();

const model = defineModel<boolean>({ required: true });
</script>
