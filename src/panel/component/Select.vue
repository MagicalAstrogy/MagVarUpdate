<template>
    <select v-model="model" class="text_pole">
        <template v-for="option in options" :key="option">
            <option :value="option">{{ option }}</option>
        </template>
    </select>
</template>

<script setup lang="ts">
const model = defineModel<string>({ required: true });

defineProps<{ options: string[] }>();
</script>
