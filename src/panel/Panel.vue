<template>
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>MVU 变量框架</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>

        <div class="inline-drawer-content">
            <Version />
            <Notification />
            <Update />
            <Button />
            <Cleanup />
            <Compatibility />
        </div>
    </div>
</template>

<script setup lang="ts">
import Button from '@/panel/Button.vue';
import Cleanup from '@/panel/Cleanup.vue';
import Compatibility from '@/panel/Compatibility.vue';
import Notification from '@/panel/Notification.vue';
import Update from '@/panel/Update.vue';
import Version from '@/panel/Version.vue';
</script>

<style scoped>
.inline-drawer-content {
    flex-direction: column;
    gap: 0.75rem;
    padding-top: 0.5rem;
}
</style>
