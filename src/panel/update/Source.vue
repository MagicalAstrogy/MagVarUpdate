<template>
    <Detail title="模型来源">
        <Select
            v-model="store.settings.额外模型解析配置.模型来源"
            :options="['与插头相同', '自定义']"
        />

        <template v-if="store.settings.额外模型解析配置.模型来源 === '自定义'">
            <div class="mvu-field-grid">
                <Field label="API 地址">
                    <input
                        v-model="store.settings.额外模型解析配置.api地址"
                        type="text"
                        class="text_pole"
                        placeholder="http://localhost:1234/v1"
                    />
                </Field>

                <Field label="API 密钥">
                    <input
                        v-model="store.settings.额外模型解析配置.密钥"
                        type="password"
                        class="text_pole"
                        placeholder="留空表示无需密钥"
                    />
                </Field>

                <Field label="模型名称">
                    <ModelSelect />
                </Field>
            </div>

            <Detail title="高级参数">
                <div v-if="!additional_extra_configuration_supported" class="mvu-note">
                    ⚠️酒馆助手版本过低，不支持以下配置
                </div>

                <div class="mvu-field-grid">
                    <Field label="最大回复 token">
                        <input
                            v-model.number="store.settings.额外模型解析配置.最大回复token数"
                            :disabled="!additional_extra_configuration_supported"
                            type="number"
                            class="text_pole"
                            min="0"
                            step="128"
                            placeholder="4096"
                        />
                    </Field>

                    <Field label="温度">
                        <RangeNumber
                            v-model="store.settings.额外模型解析配置.温度"
                            :disabled="!additional_extra_configuration_supported"
                            :min="0"
                            :max="2"
                            :step="0.01"
                        />
                    </Field>

                    <Field label="频率惩罚">
                        <RangeNumber
                            v-model="store.settings.额外模型解析配置.频率惩罚"
                            :disabled="!additional_extra_configuration_supported"
                            :min="-2"
                            :max="2"
                            :step="0.01"
                        />
                    </Field>

                    <Field label="存在惩罚">
                        <RangeNumber
                            v-model="store.settings.额外模型解析配置.存在惩罚"
                            :disabled="!additional_extra_configuration_supported"
                            :min="-2"
                            :max="2"
                            :step="0.01"
                        />
                    </Field>

                    <Field label="Top P">
                        <RangeNumber
                            v-model="store.settings.额外模型解析配置.top_p"
                            :disabled="!additional_extra_configuration_supported"
                            :min="0"
                            :max="1"
                            :step="0.01"
                        />
                    </Field>

                    <Field label="Top K">
                        <RangeNumber
                            v-model="store.settings.额外模型解析配置.top_k"
                            :disabled="!additional_extra_configuration_supported"
                            :min="0"
                            :max="500"
                            :step="1"
                        />
                    </Field>
                </div>
            </Detail>
        </template>
    </Detail>
</template>

<script setup lang="ts">
import Detail from '@/panel/component/Detail.vue';
import Field from '@/panel/component/Field.vue';
import ModelSelect from '@/panel/component/ModelSelect.vue';
import RangeNumber from '@/panel/component/RangeNumber.vue';
import Select from '@/panel/component/Select.vue';
import { useDataStore } from '@/store';
import { getTavernHelperVersion } from '@/util';
import { compare } from 'compare-versions';

const additional_extra_configuration_supported = compare(getTavernHelperVersion(), '4.0.14', '>=');

const store = useDataStore();
</script>

<style scoped>
.mvu-field-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.mvu-note {
    opacity: 0.85;
    color: var(--SmartThemeEmColor, inherit);
}
</style>
