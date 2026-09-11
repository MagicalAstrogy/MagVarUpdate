<template>
    <Section :label="t('panel.button.section')">
        <template #content>
            <div v-if="has_input" class="mvu-button-input">
                <label class="mvu-button-input__label">
                    {{ t(input_button?.input_label_key ?? '') }}
                </label>
                <textarea
                    v-model="incremental_repair_hint"
                    class="text_pole mvu-button-input__field"
                    rows="2"
                    maxlength="500"
                    :placeholder="t(input_button?.input_placeholder_key ?? '')"
                ></textarea>
            </div>
            <div class="mvu-button-wrap">
                <div
                    v-for="button in visible_buttons"
                    :key="button.name"
                    class="menu_button menu_button_icon interactable"
                    tabindex="0"
                    role="button"
                    @click="
                        button.function(
                            button.input_label_key ? incremental_repair_hint : undefined
                        )
                    "
                >
                    {{ t(button.label_key) }}
                </div>
            </div>
        </template>
    </Section>
</template>

<script setup lang="ts">
import { buttons } from '@/button';
import { useMvuI18n } from '@/i18n';
import Section from '@/panel/component/Section.vue';
import { useDataStore } from '@/store';
import { computed, ref } from 'vue';

const store = useDataStore();
const { t } = useMvuI18n();
const incremental_repair_hint = ref('');
const visible_buttons = computed(() =>
    buttons.filter(
        button => !(button.is_legacy ?? false) || store.settings.兼容性.显示老旧功能 === true
    )
);
const input_button = computed(() => visible_buttons.value.find(button => button.input_label_key));
const has_input = computed(() => input_button.value !== undefined);
</script>

<style scoped>
.mvu-button-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.6rem;
    align-items: center;
}

.mvu-button-input {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 0.55rem;
}

.mvu-button-input__label {
    font-size: 0.9em;
    opacity: 0.85;
}

.mvu-button-input__field {
    box-sizing: border-box;
    width: 100%;
    min-height: 2.5rem;
    resize: vertical;
    line-height: 1.35;
}

.mvu-button-wrap :deep(.menu_button) {
    box-sizing: border-box;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    justify-content: flex-start;
    padding: 0.35rem 0.6rem;
    min-height: unset;
    height: 2.05rem;
    line-height: 1.1;
}
</style>
