<template>
    <Section>
        <template #title>自动清理变量</template>
        <template #content>
            <Checkbox v-model="store.settings.auto_cleanup.启用">
                <span>启用自动清理变量</span>
            </Checkbox>

            <details class="mvu-details">
                <summary class="mvu-details__summary">清理策略</summary>
                <div class="mvu-details__content">
                    <Field id="mvu_snapshot_keep_interval" label="快照保留间隔">
                        <input
                            id="mvu_snapshot_keep_interval"
                            v-model.number="store.settings.快照保留间隔"
                            type="number"
                            min="1"
                            step="1"
                            class="text_pole"
                            placeholder="50"
                        />
                    </Field>

                    <Field id="mvu_keep_recent_floors" label="要保留变量的最近楼层数">
                        <input
                            id="mvu_keep_recent_floors"
                            v-model.number="store.settings.auto_cleanup.要保留变量的最近楼层数"
                            type="number"
                            min="1"
                            step="1"
                            class="text_pole"
                            placeholder="20"
                        />
                    </Field>

                    <Field id="mvu_restore_recent_floors" label="触发恢复变量的最近楼层数">
                        <input
                            id="mvu_restore_recent_floors"
                            v-model.number="store.settings.auto_cleanup.触发恢复变量的最近楼层数"
                            type="number"
                            min="1"
                            step="1"
                            class="text_pole"
                            placeholder="10"
                        />
                    </Field>
                </div>
            </details>
        </template>
    </Section>
</template>

<script setup lang="ts">
import Checkbox from '@/panel/component/Checkbox.vue';
import Field from '@/panel/component/Field.vue';
import Section from '@/panel/component/Section.vue';
import { useSettingsStore } from '@/settings';

const store = useSettingsStore();
</script>

<style scoped>
.mvu-details {
    border: 1px dashed var(--SmartThemeBorderColor, rgba(45, 45, 45, 1));
    border-radius: 10px;
    padding: 0.5rem 0.7rem;
    background-color: color-mix(
        in srgb,
        var(--SmartThemeBlurTintColor, rgba(31, 31, 31, 1)) 70%,
        transparent
    );
}

.mvu-details__summary {
    cursor: pointer;
    user-select: none;
    font-weight: 600;
    opacity: 0.95;
}

.mvu-details__content {
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
</style>
