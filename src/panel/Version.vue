<template>
    <Section label="当前版本">
        <template #content>
            <span> {{ build_date }} ({{ commit_id }}) </span>
        </template>
    </Section>
</template>

<script setup lang="ts">
import Section from '@/panel/component/Section.vue';

const build_date = __BUILD_DATE__ ?? 'Unknown';
const commit_id = __COMMIT_ID__ ?? 'Unknown';
</script>
