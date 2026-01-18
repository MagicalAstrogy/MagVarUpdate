<template>
    <Section label="自动清理变量">
        <template #content>
            <Checkbox v-model="store.settings.自动清理变量.启用">
                <span>启用自动清理变量</span>
            </Checkbox>

            <Detail title="清理策略">
                <Field id="mvu_snapshot_keep_interval" label="快照保留间隔">
                    <input
                        id="mvu_snapshot_keep_interval"
                        v-model.number="store.settings.自动清理变量.快照保留间隔"
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
                        v-model.number="store.settings.自动清理变量.要保留变量的最近楼层数"
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
                        v-model.number="store.settings.自动清理变量.触发恢复变量的最近楼层数"
                        type="number"
                        min="1"
                        step="1"
                        class="text_pole"
                        placeholder="10"
                    />
                </Field>
            </Detail>
        </template>
    </Section>
</template>

<script setup lang="ts">
import Checkbox from '@/panel/component/Checkbox.vue';
import Detail from '@/panel/component/Detail.vue';
import Field from '@/panel/component/Field.vue';
import Section from '@/panel/component/Section.vue';
import { useDataStore } from '@/store';

const store = useDataStore();
</script>
