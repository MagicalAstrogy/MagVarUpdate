<template>
    <i
        class="fa-solid fa-circle-question fa-sm note-link-span mvu-help-icon"
        role="button"
        tabindex="0"
        aria-label="帮助"
        @click="showHelpPopup(help)"
    />
</template>

<script setup lang="ts">
import { showHelpPopup } from '@/util';

defineProps<{ help: string }>();
</script>

<style scoped>
.mvu-help-icon {
    cursor: pointer;
}
</style>
