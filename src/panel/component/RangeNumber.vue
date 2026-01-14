<template>
    <div class="mvu-range-number">
        <template v-for="type in ['range', 'number']" :key="type">
            <input
                :class="`mvu-range-number__${type}`"
                :type="type"
                :min="min"
                :max="max"
                :step="step"
                :disabled="disabled"
                :value="model"
                @input="onInput"
            />
        </template>
    </div>
</template>

<script setup lang="ts">
const model = defineModel<number>({ required: true });
const props = defineProps<{
    min: number;
    max: number;
    step: number;
    disabled?: boolean;
}>();

function clamp(value: number) {
    return _.clamp(value, props.min, props.max);
}

function onInput(event: Event) {
    const value = Number($(event).val());
    if (Number.isFinite(value)) {
        model.value = clamp(value);
    }
}
</script>

<style scoped>
.mvu-range-number {
    display: grid;
    grid-template-columns: 1fr 7.5rem;
    gap: 0.5rem;
    align-items: center;
}

.mvu-range-number__range {
    width: 100%;
}

.mvu-range-number__number {
    text-align: left;
    padding-top: 0.3rem;
    padding-bottom: 0.3rem;
}

@media (max-width: 420px) {
    .mvu-range-number {
        grid-template-columns: 1fr 6.5rem;
    }
}
</style>
