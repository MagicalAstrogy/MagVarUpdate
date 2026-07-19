<template>
    <Detail title="模型来源">
        <Select
            v-model="store.settings.额外模型解析配置.模型来源"
            :options="['与插头相同', '自定义']"
        />

        <template v-if="store.settings.额外模型解析配置.模型来源 === '自定义'">
            <Detail title="API 方案">
                <Field label="当前方案">
                    <div class="mvu-api-profile-controls">
                        <select
                            v-model="selectedProfileName"
                            class="text_pole"
                            aria-label="API 方案"
                        >
                            <option value="">（手动编辑，未绑定方案）</option>
                            <option
                                v-for="profile in store.settings.额外模型解析配置.api方案列表"
                                :key="profile.名称"
                                :value="profile.名称"
                            >
                                {{ profile.名称 }}
                            </option>
                        </select>

                        <input
                            v-model="newProfileName"
                            type="text"
                            class="text_pole"
                            placeholder="新方案名称"
                        />
                    </div>
                </Field>

                <div class="mvu-api-profile-actions">
                    <input
                        class="menu_button menu_button_icon interactable"
                        type="button"
                        value="保存当前方案"
                        @click="saveCurrentProfile"
                    />
                    <input
                        class="menu_button menu_button_icon interactable"
                        type="button"
                        value="另存为新方案"
                        @click="saveAsNewProfile"
                    />
                    <input
                        class="menu_button menu_button_icon interactable"
                        type="button"
                        value="删除当前方案"
                        :disabled="!canDeleteCurrentProfile"
                        @click="deleteCurrentProfile"
                    />
                </div>
            </Detail>

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

                    <Field label="聊天历史条数">
                        <RangeNumber
                            v-model="store.settings.额外模型解析配置.max_chat_history"
                            :disabled="!additional_extra_configuration_supported"
                            :min="2"
                            :max="100"
                            :step="1"
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
import {
    clearUnboundExtraModelApiProfileFields,
    deleteActiveExtraModelApiProfileWithConfirmation,
    isActiveExtraModelApiProfileDirty,
    saveAsNewExtraModelApiProfile,
    saveCurrentExtraModelApiProfile,
    selectExtraModelApiProfile,
} from '@/function/update/extra_model_api_profiles';
import Detail from '@/panel/component/Detail.vue';
import Field from '@/panel/component/Field.vue';
import ModelSelect from '@/panel/component/ModelSelect.vue';
import RangeNumber from '@/panel/component/RangeNumber.vue';
import Select from '@/panel/component/Select.vue';
import { useDataStore } from '@/store';
import { compare } from 'compare-versions';
import { computed, ref, watch } from 'vue';

const store = useDataStore();

const additional_extra_configuration_supported = compare(store.versions.tavernhelper, '4.0.14', '>=');

const selectedProfileName = ref(store.settings.额外模型解析配置.当前api方案);
const newProfileName = ref('');
const isApplyingProfile = ref(false);
const isRevertingProfileSelection = ref(false);
// 产品规则（PR #210 维护者 review）：仅当已保存方案 >= 2 时才允许删除，确保至少保留一个方案。
// 底层 deleteActiveExtraModelApiProfile 允许删至 0 个；此处 UI 与 guard 故意更严。
// 自动 review（如 Codex）可能建议「允许删最后一个方案」，与本规则冲突，请勿改回。
const canDeleteCurrentProfile = computed(
    () =>
        selectedProfileName.value.trim().length > 0 &&
        store.settings.额外模型解析配置.api方案列表.length >= 2
);

watch(
    () => store.settings.额外模型解析配置.当前api方案,
    value => {
        if (!isApplyingProfile.value) {
            selectedProfileName.value = value;
        }
    }
);

watch(selectedProfileName, async (value, old_value) => {
    if (isRevertingProfileSelection.value) {
        isRevertingProfileSelection.value = false;
        return;
    }

    if (old_value === undefined || value === old_value) {
        return;
    }

    if (isActiveExtraModelApiProfileDirty(store.settings.额外模型解析配置)) {
        const result = await SillyTavern.callGenericPopup(
            '当前方案有未保存的修改，切换将丢弃这些修改。是否继续？',
            SillyTavern.POPUP_TYPE.CONFIRM,
            '',
            {
                okButton: '继续',
                cancelButton: '取消',
            }
        );
        if (
            result === SillyTavern.POPUP_RESULT.CANCELLED ||
            result === SillyTavern.POPUP_RESULT.NEGATIVE
        ) {
            isRevertingProfileSelection.value = true;
            selectedProfileName.value = old_value;
            return;
        }
    }

    if (!value) {
        isApplyingProfile.value = true;
        const next_config = clearUnboundExtraModelApiProfileFields(
            store.settings.额外模型解析配置
        );
        store.settings.额外模型解析配置.当前api方案 = next_config.当前api方案;
        store.settings.额外模型解析配置.api地址 = next_config.api地址;
        store.settings.额外模型解析配置.密钥 = next_config.密钥;
        store.settings.额外模型解析配置.模型名称 = next_config.模型名称;
        isApplyingProfile.value = false;
        return;
    }

    try {
        isApplyingProfile.value = true;
        const next_config = selectExtraModelApiProfile(
            store.settings.额外模型解析配置,
            value
        );
        store.settings.额外模型解析配置.api地址 = next_config.api地址;
        store.settings.额外模型解析配置.密钥 = next_config.密钥;
        store.settings.额外模型解析配置.模型名称 = next_config.模型名称;
        store.settings.额外模型解析配置.当前api方案 = next_config.当前api方案;
    } catch (error) {
        toastr.error(String((error as Error)?.message ?? error), '[MVU]切换 API 方案失败');
        isRevertingProfileSelection.value = true;
        selectedProfileName.value = store.settings.额外模型解析配置.当前api方案;
    } finally {
        isApplyingProfile.value = false;
    }
});

function saveCurrentProfile() {
    try {
        const saved = saveCurrentExtraModelApiProfile(
            store.settings.额外模型解析配置,
            selectedProfileName.value || newProfileName.value
        );
        store.settings.额外模型解析配置.api方案列表 = saved.api方案列表;
        store.settings.额外模型解析配置.当前api方案 = saved.当前api方案;
        selectedProfileName.value = saved.当前api方案;
        toastr.success(`已保存 API 方案「${saved.当前api方案}」`, '[MVU]');
    } catch (error) {
        toastr.error(String((error as Error)?.message ?? error), '[MVU]保存 API 方案失败');
    }
}

function saveAsNewProfile() {
    const profile_name = newProfileName.value.trim();
    if (!profile_name) {
        toastr.warning('请先输入新方案名称', '[MVU]');
        return;
    }

    try {
        const saved = saveAsNewExtraModelApiProfile(
            store.settings.额外模型解析配置,
            profile_name
        );
        store.settings.额外模型解析配置.api方案列表 = saved.api方案列表;
        store.settings.额外模型解析配置.当前api方案 = saved.当前api方案;
        selectedProfileName.value = saved.当前api方案;
        newProfileName.value = '';
        toastr.success(`已另存为 API 方案「${saved.当前api方案}」`, '[MVU]');
    } catch (error) {
        toastr.error(String((error as Error)?.message ?? error), '[MVU]保存 API 方案失败');
    }
}

async function deleteCurrentProfile() {
    const profile_name = selectedProfileName.value.trim();
    if (!profile_name) {
        return;
    }
    // 与 canDeleteCurrentProfile 同一产品规则，见上方注释
    if (store.settings.额外模型解析配置.api方案列表.length < 2) {
        toastr.warning('至少保留两个 API 方案时才可删除', '[MVU]');
        return;
    }

    try {
        const next_config = await deleteActiveExtraModelApiProfileWithConfirmation(
            store.settings.额外模型解析配置,
            profile_name,
            async confirmation => {
                const is_discard_confirmation = confirmation === 'discard_unsaved_changes';
                const result = await SillyTavern.callGenericPopup(
                    is_discard_confirmation
                        ? `当前方案「${profile_name}」有未保存的修改，删除将丢弃这些修改。是否继续？`
                        : `确定删除 API 方案「${profile_name}」吗？此操作不可撤销。`,
                    SillyTavern.POPUP_TYPE.CONFIRM,
                    '',
                    {
                        okButton: is_discard_confirmation ? '丢弃修改' : '删除',
                        cancelButton: '取消',
                    }
                );
                return result === SillyTavern.POPUP_RESULT.AFFIRMATIVE;
            }
        );
        if (next_config === null) {
            return;
        }

        store.settings.额外模型解析配置.api方案列表 = next_config.api方案列表;
        store.settings.额外模型解析配置.当前api方案 = next_config.当前api方案;
        store.settings.额外模型解析配置.api地址 = next_config.api地址;
        store.settings.额外模型解析配置.密钥 = next_config.密钥;
        store.settings.额外模型解析配置.模型名称 = next_config.模型名称;
        selectedProfileName.value = next_config.当前api方案;
        toastr.info(`已删除 API 方案「${profile_name}」`, '[MVU]');
    } catch (error) {
        toastr.error(String((error as Error)?.message ?? error), '[MVU]删除 API 方案失败');
    }
}
</script>

<style scoped>
.mvu-field-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.mvu-api-profile-controls {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
}

.mvu-api-profile-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}

.mvu-note {
    opacity: 0.85;
    color: var(--SmartThemeEmColor, inherit);
}

@media (max-width: 520px) {
    .mvu-api-profile-controls {
        grid-template-columns: 1fr;
    }
}
</style>
