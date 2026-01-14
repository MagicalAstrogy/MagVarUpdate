<template>
    <div class="mvu-field flex-container flexFlowColumn">
        <label class="mvu-field__label">
            <span>{{ label }}</span>
            <slot name="label-suffix" />
        </label>
        <slot />
    </div>
</template>

<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<style scoped>
.mvu-field {
    gap: 0.25rem;
}

.mvu-field__label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
}
</style>
