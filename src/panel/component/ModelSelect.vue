<template>
    <div class="mvu-model-select">
        <div class="mvu-model-select__row">
            <input v-model="model" type="text" class="text_pole" autocomplete="off" />
        </div>

        <div class="mvu-model-select__row mvu-model-select__row--controls">
            <select
                v-model="selected"
                class="text_pole"
                :disabled="options.length === 0"
                :aria-label="t('panel.modelSelect.ariaLabel')"
            >
                <option value="">{{ t('panel.modelSelect.chooseFromList') }}</option>
                <option v-for="option in options" :key="option.id" :value="option.id">
                    {{ option.label }}
                </option>
            </select>

            <input
                class="mvu-model-select__btn menu_button menu_button_icon interactable"
                type="button"
                :value="loading ? t('panel.modelSelect.loading') : t('panel.modelSelect.fetch')"
                :disabled="loading || disabled"
                @click="refresh"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { useMvuI18n } from '@/i18n';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

interface ModelSelectOption {
    id: string;
    label: string;
}

const props = withDefaults(
    defineProps<{
        catalogModels?: readonly ModelSelectOption[];
        loadModels: (signal: AbortSignal) => Promise<readonly string[]>;
        resetKey: number;
        disabled?: boolean;
    }>(),
    {
        catalogModels: () => [],
        disabled: false,
    }
);
const model = defineModel<string>({ required: true });
const { t } = useMvuI18n();

const loading = ref(false);
const fetched_models = ref<string[]>([]);
let request_generation = 0;
let request_controller: AbortController | undefined;

function normalizedCatalogModels(): ModelSelectOption[] {
    const seen = new Set<string>();
    return props.catalogModels.flatMap(option => {
        const id = option.id.trim();
        if (!id || seen.has(id)) {
            return [];
        }
        seen.add(id);
        return [{ id, label: option.label.trim() || id }];
    });
}

const options = computed<ModelSelectOption[]>(() => {
    const catalog = normalizedCatalogModels();
    const seen = new Set(catalog.map(option => option.id));
    return [
        ...catalog,
        ...fetched_models.value.flatMap(id => {
            const normalized_id = id.trim();
            if (!normalized_id || seen.has(normalized_id)) {
                return [];
            }
            seen.add(normalized_id);
            return [{ id: normalized_id, label: normalized_id }];
        }),
    ];
});

const selected = computed({
    get: () => (options.value.some(option => option.id === model.value) ? model.value : ''),
    set: (value: string) => {
        if (value) {
            model.value = value;
        }
    },
});

function cancelActiveRequest(): void {
    request_generation += 1;
    request_controller?.abort();
    request_controller = undefined;
    loading.value = false;
}

function resetFetchedModels(): void {
    cancelActiveRequest();
    fetched_models.value = [];
}

async function refresh(): Promise<void> {
    if (loading.value || props.disabled) {
        return;
    }

    cancelActiveRequest();
    const generation = request_generation;
    const controller = new AbortController();
    request_controller = controller;
    loading.value = true;
    try {
        const models = await props.loadModels(controller.signal);
        if (controller.signal.aborted || generation !== request_generation) {
            return;
        }
        fetched_models.value = [
            ...new Set(models.map(value => value.trim()).filter(Boolean)),
        ].sort();
        if (fetched_models.value.length === 0) {
            toastr.warning(t('panel.modelSelect.empty'), t('panel.modelSelect.fetchTitle'));
        }
    } catch (error) {
        if (controller.signal.aborted || generation !== request_generation) {
            return;
        }
        toastr.error(
            t('runtime.common.errorCause', {
                cause: _.escape(error instanceof Error ? error.message : String(error)),
            }),
            t('panel.modelSelect.fetchFailureTitle')
        );
    } finally {
        if (generation === request_generation) {
            loading.value = false;
            request_controller = undefined;
        }
    }
}

watch(() => props.resetKey, resetFetchedModels);
onBeforeUnmount(cancelActiveRequest);
</script>

<style scoped>
.mvu-model-select {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.mvu-model-select__row {
    width: 100%;
}

.mvu-model-select__row--controls {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
    align-items: center;
}

.mvu-model-select__btn {
    white-space: nowrap;
    text-align: left;
    padding: 0.35rem 0.6rem;
    min-height: unset;
    height: 2.05rem;
    line-height: 1.1;
}

@media (max-width: 520px) {
    .mvu-model-select__row--controls {
        grid-template-columns: 1fr;
    }
}
</style>
