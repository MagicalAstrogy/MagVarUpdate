<template>
    <label class="checkbox_label">
        <input v-model="model" type="checkbox" />
        <slot />
    </label>
</template>

<script setup lang="ts">
const model = defineModel<boolean>({ required: true });
</script>
