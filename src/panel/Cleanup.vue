<template>
    <Section>
        <template #title>自动清理变量</template>
        <template #content>
            <Checkbox v-model="store.settings.auto_cleanup.启用">
                <span>启用自动清理变量</span>
            </Checkbox>

            <div class="flex-container flexFlowColumn">
                <label for="mvu_snapshot_interval">快照保留间隔</label>
                <input
                    id="mvu_snapshot_interval"
                    v-model.number="store.settings.快照保留间隔"
                    type="number"
                    min="1"
                    step="1"
                    class="text_pole"
                    placeholder="50"
                />
            </div>

            <div class="flex-container flexFlowColumn">
                <label for="mvu_snapshot_interval">要保留变量的最近楼层数</label>
                <input
                    id="mvu_snapshot_interval"
                    v-model.number="store.settings.auto_cleanup.要保留变量的最近楼层数"
                    type="number"
                    min="1"
                    step="1"
                    class="text_pole"
                    placeholder="50"
                />
            </div>

            <div class="flex-container flexFlowColumn">
                <label for="mvu_snapshot_interval">触发恢复变量的最近楼层数</label>
                <input
                    id="mvu_snapshot_interval"
                    v-model.number="store.settings.auto_cleanup.触发恢复变量的最近楼层数"
                    type="number"
                    min="1"
                    step="1"
                    class="text_pole"
                    placeholder="50"
                />
            </div>
        </template>
    </Section>
</template>

<script setup lang="ts">
import Checkbox from '@/panel/component/Checkbox.vue';
import Section from '@/panel/component/Section.vue';
import { useSettingsStore } from '@/settings';

const store = useSettingsStore();
</script>
