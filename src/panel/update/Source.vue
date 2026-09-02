<template>
    <Detail :title="t('panel.source.section')">
        <Select
            :model-value="store.settings.额外模型解析配置.模型来源"
            :options="model_source_options"
            @update:model-value="selectModelSource"
        />

        <div v-if="pi_feature_disabled" class="mvu-field-error">
            {{ t('panel.source.pi.featureDisabled') }}
        </div>

        <Detail v-if="is_profile_source" :title="t('panel.source.profile.section')">
            <Field :label="t('panel.source.profile.current')">
                <div class="mvu-api-profile-controls">
                    <select
                        v-model="selectedProfileName"
                        class="text_pole"
                        :aria-label="t('panel.source.profile.ariaLabel')"
                    >
                        <option value="">{{ t('panel.source.profile.manual') }}</option>
                        <option
                            v-for="profile in store.settings.额外模型解析配置.api方案列表"
                            :key="profile.名称"
                            :value="profile.名称"
                        >
                            {{ profile.名称 }} · {{ getProfileBackendLabel(profile.backend) }}
                        </option>
                    </select>

                    <input
                        v-model="newProfileName"
                        type="text"
                        class="text_pole"
                        :placeholder="t('panel.source.profile.newName')"
                    />
                </div>
            </Field>

            <div class="mvu-api-profile-actions">
                <input
                    class="menu_button menu_button_icon interactable"
                    type="button"
                    :value="t('panel.source.profile.save')"
                    @click="saveCurrentProfile"
                />
                <input
                    class="menu_button menu_button_icon interactable"
                    type="button"
                    :value="t('panel.source.profile.saveAs')"
                    @click="saveAsNewProfile"
                />
                <input
                    class="menu_button menu_button_icon interactable"
                    type="button"
                    :value="t('panel.source.profile.delete')"
                    :disabled="!canDeleteCurrentProfile"
                    @click="deleteCurrentProfile"
                />
            </div>
        </Detail>

        <template v-if="is_custom_source">
            <div class="mvu-field-grid">
                <Field :label="t('panel.source.apiAddress')">
                    <input
                        v-model="store.settings.额外模型解析配置.api地址"
                        type="text"
                        class="text_pole"
                        placeholder="http://localhost:1234/v1"
                    />
                </Field>

                <Field :label="t('panel.source.apiKey')">
                    <input
                        v-model="store.settings.额外模型解析配置.密钥"
                        type="password"
                        class="text_pole"
                        :placeholder="t('panel.source.apiKeyPlaceholder')"
                    />
                </Field>

                <Field :label="t('panel.source.modelName')">
                    <ModelSelect />
                </Field>
            </div>
        </template>

        <template v-else-if="is_pi_source">
            <div class="mvu-field-grid">
                <Field :label="t('panel.source.pi.provider')">
                    <Select
                        :model-value="store.settings.额外模型解析配置.pi.provider"
                        :options="pi_provider_options"
                        @update:model-value="selectPiProvider"
                    />
                </Field>

                <Field :label="t('panel.source.pi.apiLabel')">
                    <select
                        :value="store.settings.额外模型解析配置.pi.api"
                        class="text_pole"
                        :disabled="pi_api_readonly"
                        @change="selectPiApi"
                    >
                        <option v-for="api in pi_api_display_options" :key="api" :value="api">
                            {{ getPiApiLabel(api) }}
                        </option>
                    </select>
                </Field>

                <Field :label="t('panel.source.pi.authType')">
                    <select
                        :value="store.settings.额外模型解析配置.pi.authType"
                        class="text_pole"
                        :disabled="pi_auth_readonly"
                        @change="selectPiAuth"
                    >
                        <option
                            v-for="auth_type in pi_auth_display_options"
                            :key="auth_type"
                            :value="auth_type"
                        >
                            {{ getPiAuthLabel(auth_type) }}
                        </option>
                    </select>
                </Field>

                <Field v-if="show_pi_endpoint" :label="t('panel.source.pi.endpoint')">
                    <input
                        :value="store.settings.额外模型解析配置.pi.endpoint"
                        type="text"
                        class="text_pole"
                        :placeholder="pi_endpoint_placeholder"
                        @input="selectPiEndpoint"
                    />
                </Field>

                <Field v-if="show_pi_api_key" :label="t('panel.source.apiKey')">
                    <input
                        v-model="store.settings.额外模型解析配置.密钥"
                        type="password"
                        class="text_pole"
                        :placeholder="t('panel.source.apiKeyPlaceholder')"
                    />
                </Field>

                <Field :label="t('panel.source.pi.model')">
                    <div class="mvu-pi-model-controls">
                        <input
                            v-model="store.settings.额外模型解析配置.pi.model"
                            type="text"
                            class="text_pole"
                            autocomplete="off"
                        />
                        <select
                            v-model="selected_catalog_model_id"
                            class="text_pole"
                            :aria-label="t('panel.source.pi.catalogModel')"
                            :disabled="pi_catalog_models.length === 0"
                        >
                            <option value="">{{ t('panel.source.pi.customModel') }}</option>
                            <option
                                v-for="model in pi_catalog_models"
                                :key="`${model.api}:${model.id}`"
                                :value="model.id"
                            >
                                {{ getPiModelLabel(model) }}
                            </option>
                        </select>
                    </div>
                </Field>
            </div>

            <div v-if="pi_configuration_error" class="mvu-field-error">
                {{ pi_configuration_error }}
            </div>

            <div v-if="pi_capability_summary" class="mvu-note">
                {{ pi_capability_summary }}
            </div>

            <Detail v-if="show_pi_oauth" :title="t('panel.source.pi.oauth.section')">
                <Field :label="t('panel.source.pi.oauth.status')">
                    <div class="mvu-oauth-status">
                        <span>{{ oauth_status_label }}</span>
                        <small v-if="oauth_expiry_label">{{ oauth_expiry_label }}</small>
                    </div>
                </Field>

                <div class="mvu-api-profile-actions">
                    <input
                        class="menu_button menu_button_icon interactable"
                        type="button"
                        :value="
                            oauthStatus.loggedIn
                                ? t('panel.source.pi.oauth.relogin')
                                : t('panel.source.pi.oauth.login')
                        "
                        :disabled="oauthBusy"
                        @click="beginOAuthLogin"
                    />
                    <input
                        v-if="oauthAttempt"
                        class="menu_button menu_button_icon interactable"
                        type="button"
                        :value="t('panel.source.pi.oauth.cancel')"
                        @click="cancelOAuthLogin(true)"
                    />
                    <input
                        v-if="oauthStatus.loggedIn"
                        class="menu_button menu_button_icon interactable"
                        type="button"
                        :value="t('panel.source.pi.oauth.logout')"
                        :disabled="oauthBusy"
                        @click="logoutOAuth"
                    />
                </div>

                <template v-if="oauthAttempt">
                    <Field :label="t('panel.source.pi.oauth.authorizationUrl')">
                        <input
                            :value="oauthAttempt.authorizationUrl"
                            type="text"
                            class="text_pole"
                            readonly
                            @focus="selectInputText"
                        />
                    </Field>

                    <div class="mvu-api-profile-actions">
                        <a
                            class="menu_button menu_button_icon interactable mvu-link-button"
                            :href="oauthAttempt.authorizationUrl"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {{ t('panel.source.pi.oauth.openAuthorization') }}
                        </a>
                        <input
                            class="menu_button menu_button_icon interactable"
                            type="button"
                            :value="t('panel.source.pi.oauth.copyAuthorization')"
                            @click="copyOAuthAuthorizationUrl"
                        />
                    </div>

                    <div class="mvu-note">{{ t('panel.source.pi.oauth.callbackHelp') }}</div>
                    <Field :label="t('panel.source.pi.oauth.callbackUrl')">
                        <input
                            v-model="oauthCallbackUrl"
                            type="password"
                            class="text_pole"
                            autocomplete="off"
                            spellcheck="false"
                        />
                    </Field>
                    <div class="mvu-api-profile-actions">
                        <input
                            class="menu_button menu_button_icon interactable"
                            type="button"
                            :value="t('panel.source.pi.oauth.complete')"
                            :disabled="oauthBusy || oauthCallbackUrl.trim().length === 0"
                            @click="completeOAuthLogin"
                        />
                    </div>
                </template>

                <div v-if="oauthProgress" class="mvu-note">{{ oauthProgress }}</div>
                <div v-if="oauthError" class="mvu-field-error">{{ oauthError }}</div>
            </Detail>
        </template>

        <Detail v-if="is_profile_source" :title="t('panel.source.advanced')">
            <div v-if="custom_advanced_disabled" class="mvu-note">
                {{ t('panel.source.unsupportedAdvanced') }}
            </div>

            <div class="mvu-field-grid">
                <Field v-if="is_pi_source" :label="t('panel.source.pi.contextWindow')">
                    <input
                        :value="pi_context_window_input_value"
                        type="number"
                        class="text_pole"
                        min="1"
                        step="1"
                        @input="updatePiContextWindow"
                    />
                    <small v-if="uses_catalog_context_window" class="mvu-note">
                        {{
                            t('panel.source.pi.contextWindowCatalog', {
                                value: effective_context_window,
                            })
                        }}
                    </small>
                    <small v-else-if="uses_manual_context_window" class="mvu-note">
                        {{ t('panel.source.pi.contextWindowOverride') }}
                    </small>
                    <div
                        v-if="pi_token_errors.includes('context-window-required')"
                        class="mvu-field-error"
                    >
                        {{ t('panel.source.pi.contextWindowRequired') }}
                    </div>
                </Field>

                <Field :label="t('panel.source.maxTokens')">
                    <input
                        v-model.number="store.settings.额外模型解析配置.最大回复token数"
                        :disabled="custom_advanced_disabled"
                        type="number"
                        class="text_pole"
                        :min="is_pi_source ? 1 : 0"
                        :step="is_pi_source ? 1 : 128"
                        placeholder="4096"
                    />
                    <div
                        v-if="pi_token_errors.includes('max-tokens-positive-integer')"
                        class="mvu-field-error"
                    >
                        {{ t('panel.source.pi.maxTokensPositive') }}
                    </div>
                    <div
                        v-if="pi_token_errors.includes('max-tokens-exceed-context-window')"
                        class="mvu-field-error"
                    >
                        {{ t('panel.source.pi.maxTokensExceedContext') }}
                    </div>
                </Field>

                <Field :label="t('panel.source.chatHistory')">
                    <RangeNumber
                        v-model="store.settings.额外模型解析配置.max_chat_history"
                        :disabled="custom_advanced_disabled"
                        :min="2"
                        :max="100"
                        :step="1"
                    />
                </Field>

                <Field :label="t('panel.source.temperature')">
                    <RangeNumber
                        v-model="store.settings.额外模型解析配置.温度"
                        :disabled="temperature_disabled"
                        :min="0"
                        :max="pi_temperature_max"
                        :step="0.01"
                    />
                </Field>

                <Field :label="t('panel.source.frequencyPenalty')">
                    <RangeNumber
                        v-model="store.settings.额外模型解析配置.频率惩罚"
                        :disabled="frequency_penalty_disabled"
                        :min="-2"
                        :max="2"
                        :step="0.01"
                    />
                </Field>

                <Field :label="t('panel.source.presencePenalty')">
                    <RangeNumber
                        v-model="store.settings.额外模型解析配置.存在惩罚"
                        :disabled="presence_penalty_disabled"
                        :min="-2"
                        :max="2"
                        :step="0.01"
                    />
                </Field>

                <Field :label="t('panel.source.topP')">
                    <RangeNumber
                        v-model="store.settings.额外模型解析配置.top_p"
                        :disabled="top_p_disabled"
                        :min="0"
                        :max="1"
                        :step="0.01"
                    />
                </Field>

                <Field :label="t('panel.source.topK')">
                    <RangeNumber
                        v-model="store.settings.额外模型解析配置.top_k"
                        :disabled="top_k_disabled"
                        :min="0"
                        :max="500"
                        :step="1"
                    />
                </Field>

                <Field v-if="is_pi_source" :label="t('panel.source.pi.customHeaders')">
                    <small class="mvu-note">{{
                        t('panel.source.pi.customOverridesSwitchHelp')
                    }}</small>
                    <textarea
                        v-model="store.settings.额外模型解析配置.pi.customHeaders"
                        class="text_pole mvu-pi-advanced-textarea"
                        rows="5"
                        autocomplete="off"
                        spellcheck="false"
                        placeholder="X-Client-Name: MVU"
                    ></textarea>
                    <small class="mvu-note">{{ t('panel.source.pi.customHeadersHelp') }}</small>
                    <div class="mvu-api-profile-actions">
                        <input
                            class="menu_button menu_button_icon interactable"
                            type="button"
                            :value="t('panel.source.pi.clearCustomField')"
                            :disabled="
                                store.settings.额外模型解析配置.pi.customHeaders.length === 0
                            "
                            @click="store.settings.额外模型解析配置.pi.customHeaders = ''"
                        />
                    </div>
                </Field>

                <Field v-if="is_pi_source" :label="t('panel.source.pi.customIncludeBody')">
                    <textarea
                        v-model="store.settings.额外模型解析配置.pi.customIncludeBody"
                        class="text_pole mvu-pi-advanced-textarea"
                        rows="6"
                        autocomplete="off"
                        spellcheck="false"
                        placeholder="metadata:&#10;  source: mvu"
                    ></textarea>
                    <small class="mvu-note">{{ t('panel.source.pi.customIncludeBodyHelp') }}</small>
                    <div class="mvu-api-profile-actions">
                        <input
                            class="menu_button menu_button_icon interactable"
                            type="button"
                            :value="t('panel.source.pi.clearCustomField')"
                            :disabled="
                                store.settings.额外模型解析配置.pi.customIncludeBody.length === 0
                            "
                            @click="store.settings.额外模型解析配置.pi.customIncludeBody = ''"
                        />
                    </div>
                </Field>

                <Field v-if="is_pi_source" :label="t('panel.source.pi.customExcludeBody')">
                    <textarea
                        v-model="store.settings.额外模型解析配置.pi.customExcludeBody"
                        class="text_pole mvu-pi-advanced-textarea"
                        rows="4"
                        autocomplete="off"
                        spellcheck="false"
                        placeholder="- store"
                    ></textarea>
                    <small class="mvu-note">{{ t('panel.source.pi.customExcludeBodyHelp') }}</small>
                    <div class="mvu-api-profile-actions">
                        <input
                            class="menu_button menu_button_icon interactable"
                            type="button"
                            :value="t('panel.source.pi.clearCustomField')"
                            :disabled="
                                store.settings.额外模型解析配置.pi.customExcludeBody.length === 0
                            "
                            @click="store.settings.额外模型解析配置.pi.customExcludeBody = ''"
                        />
                    </div>
                </Field>
            </div>
        </Detail>
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
    type ExtraModelApiProfileBackend,
    type ExtraModelApiProfileFields,
} from '@/function/update/extra_model_api_profiles';
import {
    beginPiOAuth,
    cancelPiOAuth,
    completePiOAuth,
    getPiOAuthCredentialStatus,
    logoutPiOAuth,
    PiOAuthError,
    type PiOAuthAttemptView,
    type PiOAuthCredentialStatus,
} from '@/function/update/pi/oauth';
import { getLocalizedPiErrorMessage } from '@/function/update/pi/error_localization';
import { isPiMultiproviderEnabled } from '@/function/update/pi/feature_flag';
import { normalizePiEndpoint } from '@/function/update/pi/model_resolver';
import type { Api, Model } from '@/function/update/pi/pi_gateway';
import {
    getPiCatalogModels,
    getPiProviderDefinition,
    isPiCatalogModelApiCompatible,
    listPiProviderDefinitions,
    type PiAuthType,
    type PiProviderDefinition,
    type PiWireApi,
} from '@/function/update/pi/provider_registry';
import { useMvuI18n } from '@/i18n';
import Detail from '@/panel/component/Detail.vue';
import Field from '@/panel/component/Field.vue';
import ModelSelect from '@/panel/component/ModelSelect.vue';
import RangeNumber from '@/panel/component/RangeNumber.vue';
import Select from '@/panel/component/Select.vue';
import {
    findPiCatalogModel,
    includePersistedPiOption,
    isPiOAuthUiContextCurrent,
    isPiSourceFieldReadonly,
    parsePiContextWindowInput,
    resolvePiApiKeyScope,
    resolvePiContextWindow,
    resolvePiEndpointSelection,
    resolvePiRequestTargetIdentity,
    resolvePiSourceCapabilities,
    resolvePiSourceSelection,
    transitionPiApiKey,
    transitionPiRequestOverrides,
    type PiOAuthUiContext,
    validatePiTokenSettings,
} from '@/panel/update/pi_source_form';
import { useDataStore } from '@/store';
import { compare } from 'compare-versions';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const store = useDataStore();
const { locale, t } = useMvuI18n();

const additional_extra_configuration_supported = compare(
    store.versions.tavernhelper,
    '4.0.14',
    '>='
);
const pi_multiprovider_enabled = isPiMultiproviderEnabled();
const is_custom_source = computed(() => store.settings.额外模型解析配置.模型来源 === '自定义');
const is_pi_source_selected = computed(() => store.settings.额外模型解析配置.模型来源 === '更多');
const is_pi_source = computed(() => is_pi_source_selected.value && pi_multiprovider_enabled);
const pi_feature_disabled = computed(
    () => is_pi_source_selected.value && !pi_multiprovider_enabled
);
const is_profile_source = computed(() => is_custom_source.value || is_pi_source_selected.value);
const custom_advanced_disabled = computed(
    () => is_custom_source.value && !additional_extra_configuration_supported
);

const model_source_options = computed(() => {
    const options = [
        { value: '与插头相同', label: t('panel.source.sameAsConnection') },
        { value: '自定义', label: t('panel.source.custom') },
    ];
    if (pi_multiprovider_enabled || is_pi_source_selected.value) {
        options.push({ value: '更多', label: t('panel.source.more') });
    }
    return options;
});

type ExtraModelSource = '与插头相同' | '自定义' | '更多';

function getApiKeyContext() {
    const config = store.settings.额外模型解析配置;
    const definition = getPiProviderDefinition(config.pi.provider);
    return {
        source: config.模型来源,
        authType: config.pi.authType,
        keyScope: resolvePiApiKeyScope(
            definition,
            config.pi.api,
            config.pi.authType,
            config.pi.endpoint
        ),
    };
}

function applyApiKeyTransition(mutator: () => void): void {
    const config = store.settings.额外模型解析配置;
    const previous = getApiKeyContext();
    const active_api_key = config.密钥;
    mutator();
    const transitioned = transitionPiApiKey(previous, getApiKeyContext(), active_api_key, {
        customApiKey: config.customApiKey,
        apiKeys: config.pi.apiKeys,
    });
    config.customApiKey = transitioned.customApiKey;
    config.pi.apiKeys = transitioned.apiKeys;
    config.密钥 = transitioned.activeApiKey;
}

function getPiRequestTargetIdentity(): string {
    const pi = store.settings.额外模型解析配置.pi;
    return resolvePiRequestTargetIdentity(
        getPiProviderDefinition(pi.provider),
        pi.provider,
        pi.api,
        pi.authType,
        pi.endpoint
    );
}

function applyPiConnectionTransition(mutator: () => void): void {
    const previous_target = getPiRequestTargetIdentity();
    const pi = store.settings.额外模型解析配置.pi;
    const previous_overrides = {
        customHeaders: pi.customHeaders,
        customIncludeBody: pi.customIncludeBody,
        customExcludeBody: pi.customExcludeBody,
    };
    applyApiKeyTransition(mutator);
    Object.assign(
        pi,
        transitionPiRequestOverrides(
            previous_target,
            getPiRequestTargetIdentity(),
            previous_overrides
        )
    );
}

function cacheCurrentApiKey(): void {
    const config = store.settings.额外模型解析配置;
    const context = getApiKeyContext();
    const transitioned = transitionPiApiKey(context, context, config.密钥, {
        customApiKey: config.customApiKey,
        apiKeys: config.pi.apiKeys,
    });
    config.customApiKey = transitioned.customApiKey;
    config.pi.apiKeys = transitioned.apiKeys;
    config.密钥 = transitioned.activeApiKey;
}

function initializeApiKeyCache(): void {
    const config = store.settings.额外模型解析配置;
    const context = getApiKeyContext();
    if (context.source === '自定义' || (context.source === '更多' && context.keyScope !== '')) {
        cacheCurrentApiKey();
        return;
    }

    if (context.source === '与插头相同') {
        // Before Pi existed, the dormant root key belonged to the stored Custom endpoint. Migrate
        // it only into that slot; it must never become a Pi provider key implicitly.
        if (config.customApiKey === '' && config.密钥 !== '') {
            config.customApiKey = config.密钥;
        }
        cacheCurrentApiKey();
        return;
    }

    // A legacy root key under OAuth has no active wire meaning. Preserve it only in a valid API-key
    // scope for the same provider/endpoint, then clear the shared field.
    if (context.source === '更多') {
        const definition = getPiProviderDefinition(config.pi.provider);
        const inactive_scope = resolvePiApiKeyScope(
            definition,
            config.pi.api,
            'api_key',
            config.pi.endpoint
        );
        if (
            inactive_scope !== '' &&
            config.密钥 !== '' &&
            !Object.prototype.hasOwnProperty.call(config.pi.apiKeys, inactive_scope)
        ) {
            config.pi.apiKeys = { ...config.pi.apiKeys, [inactive_scope]: config.密钥 };
        }
        cacheCurrentApiKey();
    }
}

function selectModelSource(source: string): void {
    if (!['与插头相同', '自定义', '更多'].includes(source)) {
        return;
    }
    applyApiKeyTransition(() => {
        store.settings.额外模型解析配置.模型来源 = source as ExtraModelSource;
    });
}

initializeApiKeyCache();

const pi_provider_definitions = listPiProviderDefinitions();
const pi_provider_options = computed(() => {
    const options = pi_provider_definitions.map(definition => ({
        value: definition.key,
        label: definition.displayName[locale.value === 'zh-CN' ? 'zh-CN' : 'en'],
    }));
    const persisted_provider = store.settings.额外模型解析配置.pi.provider;
    return getPiProviderDefinition(persisted_provider)
        ? options
        : [
              {
                  value: persisted_provider,
                  label: t('panel.source.pi.unknownProviderOption', {
                      provider: persisted_provider,
                  }),
              },
              ...options,
          ];
});
const selected_pi_provider = computed<PiProviderDefinition | undefined>(() =>
    getPiProviderDefinition(store.settings.额外模型解析配置.pi.provider)
);
const pi_api_options = computed(
    () => selected_pi_provider.value?.allowedApis ?? ([] as readonly PiWireApi[])
);
const pi_auth_options = computed(
    () => selected_pi_provider.value?.allowedAuthTypes ?? ([] as readonly PiAuthType[])
);
const pi_api_display_options = computed(() =>
    includePersistedPiOption(pi_api_options.value, store.settings.额外模型解析配置.pi.api)
);
const pi_auth_display_options = computed(() =>
    includePersistedPiOption(pi_auth_options.value, store.settings.额外模型解析配置.pi.authType)
);
const pi_api_readonly = computed(() =>
    isPiSourceFieldReadonly(
        selected_pi_provider.value?.fields.api,
        pi_api_options.value,
        store.settings.额外模型解析配置.pi.api
    )
);
const pi_auth_readonly = computed(() =>
    isPiSourceFieldReadonly(
        selected_pi_provider.value?.fields.authType,
        pi_auth_options.value,
        store.settings.额外模型解析配置.pi.authType
    )
);
const show_pi_endpoint = computed(
    () =>
        selected_pi_provider.value?.fields.endpoint === 'editable' &&
        store.settings.额外模型解析配置.pi.authType === 'api_key'
);
const show_pi_api_key = computed(
    () =>
        store.settings.额外模型解析配置.pi.authType === 'api_key' &&
        selected_pi_provider.value?.fields.apiKey === 'when-api-key'
);
const show_pi_oauth = computed(
    () =>
        store.settings.额外模型解析配置.pi.authType === 'oauth' &&
        selected_pi_provider.value?.fields.oauth === 'when-oauth' &&
        selected_pi_provider.value.oauth !== undefined
);
const pi_endpoint_placeholder = computed(() => {
    const endpoint = selected_pi_provider.value?.defaultBaseUrl ?? '';
    return endpoint
        ? t('panel.source.pi.endpointDefault', { endpoint })
        : t('panel.source.apiKeyPlaceholder');
});
const pi_catalog_models = computed<readonly Model<Api>[]>(() => {
    const provider = selected_pi_provider.value;
    if (!provider) {
        return [];
    }
    const api = store.settings.额外模型解析配置.pi.api;
    return getPiCatalogModels(provider.key).filter(model =>
        isPiCatalogModelApiCompatible(provider, model, api as PiWireApi)
    );
});
const selected_catalog_model = computed(() =>
    findPiCatalogModel(pi_catalog_models.value, store.settings.额外模型解析配置.pi.model)
);
const selected_catalog_model_id = computed<string>({
    get: () => selected_catalog_model.value?.id ?? '',
    set: value => {
        if (value) {
            store.settings.额外模型解析配置.pi.model = value;
        }
    },
});
const effective_context_window = computed(() =>
    resolvePiContextWindow(
        store.settings.额外模型解析配置.pi.contextWindow,
        selected_catalog_model.value?.contextWindow
    )
);
const pi_context_window_input_value = computed(() => {
    const configured = store.settings.额外模型解析配置.pi.contextWindow;
    return configured === 0 ? effective_context_window.value || '' : configured;
});
const uses_catalog_context_window = computed(
    () =>
        store.settings.额外模型解析配置.pi.contextWindow === 0 && effective_context_window.value > 0
);
const uses_manual_context_window = computed(() => {
    const configured = store.settings.额外模型解析配置.pi.contextWindow;
    return typeof configured === 'number' && Number.isInteger(configured) && configured > 0;
});
const pi_token_errors = computed(() =>
    is_pi_source.value
        ? validatePiTokenSettings(
              effective_context_window.value,
              store.settings.额外模型解析配置.最大回复token数
          )
        : []
);
const selected_pi_capabilities = computed(() => {
    const provider = selected_pi_provider.value;
    if (!provider) {
        return undefined;
    }
    return resolvePiSourceCapabilities(
        provider,
        store.settings.额外模型解析配置.pi.api as PiWireApi,
        store.settings.额外模型解析配置.pi.endpoint,
        selected_catalog_model.value
    );
});
const temperature_disabled = computed(
    () =>
        custom_advanced_disabled.value ||
        (is_pi_source.value && selected_pi_capabilities.value?.temperature !== true)
);
const pi_temperature_max = computed(() =>
    is_pi_source.value ? (selected_pi_capabilities.value?.temperatureRange[1] ?? 2) : 2
);
function samplingFieldDisabled(
    field: keyof NonNullable<typeof selected_pi_capabilities.value>['sampling']
): boolean {
    return (
        custom_advanced_disabled.value ||
        (is_pi_source.value && selected_pi_capabilities.value?.sampling[field] !== true)
    );
}
const top_p_disabled = computed(() => samplingFieldDisabled('topP'));
const top_k_disabled = computed(() => samplingFieldDisabled('topK'));
const frequency_penalty_disabled = computed(() => samplingFieldDisabled('frequencyPenalty'));
const presence_penalty_disabled = computed(() => samplingFieldDisabled('presencePenalty'));
const pi_capability_summary = computed(() => {
    const capabilities = selected_pi_capabilities.value;
    if (!capabilities) {
        return '';
    }
    const labels = [
        capabilities.tools ? t('panel.source.pi.capability.tools') : '',
        capabilities.imageInput ? t('panel.source.pi.capability.images') : '',
        capabilities.structuredOutput ? t('panel.source.pi.capability.structured') : '',
    ].filter(Boolean);
    return labels.length
        ? t('panel.source.pi.capabilities', { capabilities: labels.join(' · ') })
        : '';
});

function applyPiSourceSelection(definition: PiProviderDefinition, api: string, auth: string): void {
    const resolved = resolvePiSourceSelection(definition, api, auth);
    const pi = store.settings.额外模型解析配置.pi;
    pi.provider = definition.key;
    pi.api = resolved.api;
    pi.authType = resolved.authType;
    pi.endpoint = resolvePiEndpointSelection(definition, resolved.authType, pi.endpoint);
}

function selectPiProvider(provider_key: string): void {
    const definition = getPiProviderDefinition(provider_key);
    if (!definition) {
        return;
    }
    applyPiConnectionTransition(() => {
        applyPiSourceSelection(definition, definition.defaultApi, definition.defaultAuthType);
    });
}

function selectPiSourceField(field: 'api' | 'authType', event: Event): void {
    const definition = selected_pi_provider.value;
    const input = event.target as HTMLSelectElement | null;
    if (!definition || !input) {
        return;
    }
    applyPiConnectionTransition(() => {
        const pi = store.settings.额外模型解析配置.pi;
        if (field === 'api') {
            pi.api = input.value;
        } else {
            pi.authType = input.value as PiAuthType;
        }
        applyPiSourceSelection(definition, pi.api, pi.authType);
    });
}

function selectPiApi(event: Event): void {
    selectPiSourceField('api', event);
}

function selectPiAuth(event: Event): void {
    selectPiSourceField('authType', event);
}

function selectPiEndpoint(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) {
        return;
    }
    applyPiConnectionTransition(() => {
        store.settings.额外模型解析配置.pi.endpoint = input.value;
    });
}

const pi_configuration_error = computed(() => {
    if (!is_pi_source.value) {
        return '';
    }
    const pi = store.settings.额外模型解析配置.pi;
    const definition = selected_pi_provider.value;
    if (!definition) {
        return t('panel.source.pi.error.unknownProvider', { provider: pi.provider });
    }
    if (!definition.allowedApis.includes(pi.api as PiWireApi)) {
        return t('panel.source.pi.error.unsupportedApi', {
            provider: definition.displayName[locale.value === 'zh-CN' ? 'zh-CN' : 'en'],
            api: pi.api,
        });
    }
    if (!definition.allowedAuthTypes.includes(pi.authType as PiAuthType)) {
        return t('panel.source.pi.error.unsupportedAuth', {
            provider: definition.displayName[locale.value === 'zh-CN' ? 'zh-CN' : 'en'],
            auth: pi.authType,
        });
    }
    if (pi.endpoint.trim() !== '' && (pi.authType === 'oauth' || !definition.allowCustomEndpoint)) {
        return t('panel.source.pi.error.unsupportedEndpoint');
    }
    if (pi.endpoint.trim() !== '') {
        try {
            normalizePiEndpoint(pi.endpoint);
        } catch (error) {
            return getLocalizedPiErrorMessage(error);
        }
    }
    return '';
});

function getPiApiLabel(api: string): string {
    switch (api) {
        case 'openai-responses':
            return t('panel.source.pi.api.openaiResponses');
        case 'openai-completions':
            return t('panel.source.pi.api.openaiCompletions');
        case 'openai-codex-responses':
            return t('panel.source.pi.api.openaiCodexResponses');
        case 'anthropic-messages':
            return t('panel.source.pi.api.anthropicMessages');
        case 'google-generative-ai':
            return t('panel.source.pi.api.googleGenerativeAi');
        default:
            return api;
    }
}

function getPiAuthLabel(auth_type: string): string {
    switch (auth_type) {
        case 'api_key':
            return t('panel.source.pi.auth.apiKey');
        case 'oauth':
            return t('panel.source.pi.auth.oauth');
        default:
            return auth_type;
    }
}

function getPiModelLabel(model: Model<Api>): string {
    return model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id;
}

function updatePiContextWindow(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    store.settings.额外模型解析配置.pi.contextWindow = parsePiContextWindowInput(
        input?.value ?? '',
        input?.validity.badInput ?? false
    );
}

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

function getProfileBackendLabel(backend?: ExtraModelApiProfileBackend): string {
    return t(
        backend === 'pi' ? 'panel.source.profile.backendPi' : 'panel.source.profile.backendCustom'
    );
}

function assignProfileConfig(next_config: ExtraModelApiProfileFields): void {
    Object.assign(store.settings.额外模型解析配置, next_config);
    // The profile root key is authoritative only for its exact Custom/API-key endpoint. Install it
    // after the complete snapshot, never into the previous slot. OAuth/invalid Pi targets clear it.
    cacheCurrentApiKey();
}

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
            t('panel.source.switchDirty'),
            SillyTavern.POPUP_TYPE.CONFIRM,
            '',
            {
                okButton: t('panel.source.continue'),
                cancelButton: t('common.cancel'),
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
        try {
            isApplyingProfile.value = true;
            assignProfileConfig(
                clearUnboundExtraModelApiProfileFields(store.settings.额外模型解析配置)
            );
        } finally {
            isApplyingProfile.value = false;
        }
        return;
    }

    try {
        isApplyingProfile.value = true;
        assignProfileConfig(selectExtraModelApiProfile(store.settings.额外模型解析配置, value));
    } catch (error) {
        toastr.error(format_error(error), t('panel.source.switchFailureTitle'));
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
        isApplyingProfile.value = true;
        assignProfileConfig(saved);
        selectedProfileName.value = saved.当前api方案;
        toastr.success(
            t('panel.source.profileSaved', { name: _.escape(saved.当前api方案) }),
            t('runtime.common.mvuTitle')
        );
    } catch (error) {
        toastr.error(format_error(error), t('panel.source.saveFailureTitle'));
    } finally {
        isApplyingProfile.value = false;
    }
}

function saveAsNewProfile() {
    const profile_name = newProfileName.value.trim();
    if (!profile_name) {
        toastr.warning(t('panel.source.enterProfileName'), t('runtime.common.mvuTitle'));
        return;
    }

    try {
        const saved = saveAsNewExtraModelApiProfile(store.settings.额外模型解析配置, profile_name);
        isApplyingProfile.value = true;
        assignProfileConfig(saved);
        selectedProfileName.value = saved.当前api方案;
        newProfileName.value = '';
        toastr.success(
            t('panel.source.profileSavedAs', { name: _.escape(saved.当前api方案) }),
            t('runtime.common.mvuTitle')
        );
    } catch (error) {
        toastr.error(format_error(error), t('panel.source.saveFailureTitle'));
    } finally {
        isApplyingProfile.value = false;
    }
}

async function deleteCurrentProfile() {
    const profile_name = selectedProfileName.value.trim();
    if (!profile_name) {
        return;
    }
    // 与 canDeleteCurrentProfile 同一产品规则，见上方注释
    if (store.settings.额外模型解析配置.api方案列表.length < 2) {
        toastr.warning(t('panel.source.keepTwoProfiles'), t('runtime.common.mvuTitle'));
        return;
    }

    try {
        const next_config = await deleteActiveExtraModelApiProfileWithConfirmation(
            store.settings.额外模型解析配置,
            profile_name,
            async confirmation => {
                const is_discard_confirmation = confirmation === 'discard_unsaved_changes';
                const content = document.createElement('span');
                content.textContent = t(
                    is_discard_confirmation
                        ? 'panel.source.deleteDirty'
                        : 'panel.source.deleteConfirm',
                    { name: profile_name }
                );
                const result = await SillyTavern.callGenericPopup(
                    content,
                    SillyTavern.POPUP_TYPE.CONFIRM,
                    '',
                    {
                        okButton: is_discard_confirmation
                            ? t('panel.source.discardChanges')
                            : t('panel.source.delete'),
                        cancelButton: t('common.cancel'),
                    }
                );
                return result === SillyTavern.POPUP_RESULT.AFFIRMATIVE;
            }
        );
        if (next_config === null) {
            return;
        }

        isApplyingProfile.value = true;
        assignProfileConfig(next_config);
        selectedProfileName.value = next_config.当前api方案;
        toastr.info(
            t('panel.source.profileDeleted', { name: _.escape(profile_name) }),
            t('runtime.common.mvuTitle')
        );
    } catch (error) {
        toastr.error(format_error(error), t('panel.source.deleteFailureTitle'));
    } finally {
        isApplyingProfile.value = false;
    }
}

const oauthAttempt = ref<PiOAuthAttemptView | null>(null);
const oauthStatus = ref<PiOAuthCredentialStatus>({ loggedIn: false });
const oauthStatusLoading = ref(false);
const oauthBusy = ref(false);
const oauthCallbackUrl = ref('');
const oauthProgress = ref('');
const oauthError = ref('');
let oauthOperationController: AbortController | undefined;
let oauthStatusController: AbortController | undefined;
let oauthUiGeneration = 0;
let oauthStatusGeneration = 0;
let oauthComponentMounted = true;

function captureOAuthUiContext(provider: PiProviderDefinition): PiOAuthUiContext {
    return {
        generation: oauthUiGeneration,
        providerId: provider.providerId,
        profileName: selectedProfileName.value,
    };
}

function isOAuthUiContextCurrent(context: PiOAuthUiContext): boolean {
    return isPiOAuthUiContextCurrent(context, {
        generation: oauthUiGeneration,
        providerId: selected_pi_provider.value?.providerId,
        profileName: selectedProfileName.value,
        mounted: oauthComponentMounted,
        active: is_pi_source.value && show_pi_oauth.value,
    });
}

const oauth_status_label = computed(() =>
    oauthStatusLoading.value
        ? t('panel.source.pi.oauth.checking')
        : oauthStatus.value.loggedIn
          ? t('panel.source.pi.oauth.loggedIn')
          : t('panel.source.pi.oauth.loggedOut')
);
const oauth_expiry_label = computed(() =>
    oauthStatus.value.expiresAt
        ? t('panel.source.pi.oauth.expiresAt', {
              time: new Date(oauthStatus.value.expiresAt).toLocaleString(),
          })
        : ''
);

function closeOAuthAttempt(options: { cancel: boolean; keepProgress?: boolean }): void {
    oauthUiGeneration += 1;
    oauthOperationController?.abort();
    oauthOperationController = undefined;
    if (options.cancel && oauthAttempt.value) {
        cancelPiOAuth(oauthAttempt.value.id);
    }
    oauthAttempt.value = null;
    oauthCallbackUrl.value = '';
    oauthBusy.value = false;
    oauthError.value = '';
    if (!options.keepProgress) {
        oauthProgress.value = '';
    }
}

function cancelOAuthLogin(show_progress = false): void {
    const had_attempt = oauthAttempt.value !== null || oauthBusy.value;
    closeOAuthAttempt({ cancel: true });
    if (show_progress && had_attempt) {
        oauthProgress.value = t('panel.source.pi.oauth.cancel');
    }
}

async function refreshOAuthStatus(): Promise<void> {
    oauthStatusController?.abort();
    const provider = selected_pi_provider.value;
    if (!show_pi_oauth.value || !provider) {
        oauthStatus.value = { loggedIn: false };
        oauthStatusLoading.value = false;
        return;
    }

    const generation = ++oauthStatusGeneration;
    const controller = new AbortController();
    oauthStatusController = controller;
    oauthStatusLoading.value = true;
    try {
        const status = await getPiOAuthCredentialStatus(provider.providerId, {
            signal: controller.signal,
        });
        if (oauthComponentMounted && generation === oauthStatusGeneration) {
            oauthStatus.value = status;
        }
    } catch (error) {
        if (
            oauthComponentMounted &&
            generation === oauthStatusGeneration &&
            !controller.signal.aborted
        ) {
            oauthStatus.value = { loggedIn: false };
            oauthError.value = getOAuthErrorMessage(error);
        }
    } finally {
        if (oauthComponentMounted && generation === oauthStatusGeneration) {
            oauthStatusLoading.value = false;
        }
    }
}

watch(
    () =>
        [
            store.settings.额外模型解析配置.模型来源,
            selectedProfileName.value,
            store.settings.额外模型解析配置.pi.provider,
            store.settings.额外模型解析配置.pi.authType,
        ] as const,
    (value, old_value) => {
        if (old_value && !_.isEqual(value, old_value)) {
            cancelOAuthLogin(false);
        }
        void refreshOAuthStatus();
    },
    { immediate: true }
);

async function beginOAuthLogin(): Promise<void> {
    const provider = selected_pi_provider.value;
    if (!show_pi_oauth.value || !provider) {
        return;
    }
    const confirmation_context = captureOAuthUiContext(provider);

    if (oauthStatus.value.loggedIn) {
        const display_name = provider.displayName[locale.value === 'zh-CN' ? 'zh-CN' : 'en'];
        const result = await SillyTavern.callGenericPopup(
            t('panel.source.pi.oauth.reloginConfirm', { provider: display_name }),
            SillyTavern.POPUP_TYPE.CONFIRM,
            '',
            {
                okButton: t('panel.source.pi.oauth.relogin'),
                cancelButton: t('common.cancel'),
            }
        );
        if (
            result !== SillyTavern.POPUP_RESULT.AFFIRMATIVE ||
            !isOAuthUiContextCurrent(confirmation_context)
        ) {
            return;
        }
    }

    if (!isOAuthUiContextCurrent(confirmation_context)) {
        return;
    }

    cancelOAuthLogin(false);
    const operation_context = captureOAuthUiContext(provider);
    oauthBusy.value = true;
    oauthProgress.value = t('panel.source.pi.oauth.preparing');
    oauthError.value = '';
    const operation_controller = new AbortController();
    oauthOperationController = operation_controller;

    let popup: Window | null = null;
    try {
        popup = window.open('about:blank', '_blank');
        if (popup) {
            popup.opener = null;
        }
    } catch {
        popup = null;
    }

    try {
        const attempt = await beginPiOAuth(provider.providerId, {
            signal: operation_controller.signal,
        });
        if (!isOAuthUiContextCurrent(operation_context)) {
            cancelPiOAuth(attempt.id);
            popup?.close();
            return;
        }
        oauthAttempt.value = attempt;
        oauthProgress.value = t('panel.source.pi.oauth.waitingCallback');
        if (popup && !popup.closed) {
            popup.location.replace(attempt.authorizationUrl);
        }
    } catch (error) {
        popup?.close();
        if (isOAuthUiContextCurrent(operation_context)) {
            oauthError.value = getOAuthErrorMessage(error);
            oauthProgress.value = '';
        }
    } finally {
        if (isOAuthUiContextCurrent(operation_context)) {
            oauthBusy.value = false;
        }
    }
}

async function completeOAuthLogin(): Promise<void> {
    const attempt = oauthAttempt.value;
    const provider = selected_pi_provider.value;
    if (
        !attempt ||
        !provider ||
        attempt.providerId !== provider.providerId ||
        oauthCallbackUrl.value.trim().length === 0
    ) {
        return;
    }

    const callback_url = oauthCallbackUrl.value.trim();
    // The authorization code/state should not remain visible or retained in form state once the
    // user submits it. Invalid callbacks can be pasted again after the explicit error.
    oauthCallbackUrl.value = '';
    const operation_context = captureOAuthUiContext(provider);
    oauthBusy.value = true;
    oauthProgress.value = t('panel.source.pi.oauth.exchanging');
    oauthError.value = '';
    oauthOperationController ??= new AbortController();
    try {
        await completePiOAuth(attempt.id, callback_url, {
            signal: oauthOperationController.signal,
        });
        if (!isOAuthUiContextCurrent(operation_context)) {
            return;
        }
        closeOAuthAttempt({ cancel: false, keepProgress: true });
        oauthProgress.value = t('panel.source.pi.oauth.loginSucceeded');
        await refreshOAuthStatus();
    } catch (error) {
        if (!isOAuthUiContextCurrent(operation_context)) {
            return;
        }
        oauthError.value = getOAuthErrorMessage(error);
        oauthProgress.value = '';
        if (
            !(error instanceof PiOAuthError) ||
            !['invalid_callback', 'state_mismatch'].includes(error.code)
        ) {
            closeOAuthAttempt({ cancel: true });
            oauthError.value = getOAuthErrorMessage(error);
        }
    } finally {
        if (isOAuthUiContextCurrent(operation_context)) {
            oauthBusy.value = false;
        }
    }
}

async function logoutOAuth(): Promise<void> {
    const provider = selected_pi_provider.value;
    if (!provider || !oauthStatus.value.loggedIn) {
        return;
    }
    const confirmation_context = captureOAuthUiContext(provider);
    const display_name = provider.displayName[locale.value === 'zh-CN' ? 'zh-CN' : 'en'];
    const result = await SillyTavern.callGenericPopup(
        t('panel.source.pi.oauth.logoutConfirm', { provider: display_name }),
        SillyTavern.POPUP_TYPE.CONFIRM,
        '',
        {
            okButton: t('panel.source.pi.oauth.logout'),
            cancelButton: t('common.cancel'),
        }
    );
    if (
        result !== SillyTavern.POPUP_RESULT.AFFIRMATIVE ||
        !isOAuthUiContextCurrent(confirmation_context)
    ) {
        return;
    }

    cancelOAuthLogin(false);
    const operation_context = captureOAuthUiContext(provider);
    oauthBusy.value = true;
    const operation_controller = new AbortController();
    oauthOperationController = operation_controller;
    try {
        await logoutPiOAuth(provider.providerId, { signal: operation_controller.signal });
        if (isOAuthUiContextCurrent(operation_context)) {
            oauthProgress.value = t('panel.source.pi.oauth.logoutSucceeded');
            await refreshOAuthStatus();
        }
    } catch (error) {
        if (isOAuthUiContextCurrent(operation_context)) {
            oauthError.value = getOAuthErrorMessage(error);
            toastr.error(format_oauth_error(error), t('panel.source.pi.oauth.failureTitle'));
        }
    } finally {
        if (isOAuthUiContextCurrent(operation_context)) {
            oauthBusy.value = false;
        }
    }
}

async function copyOAuthAuthorizationUrl(): Promise<void> {
    const url = oauthAttempt.value?.authorizationUrl;
    if (!url) {
        return;
    }
    try {
        if (!navigator.clipboard?.writeText) {
            throw new Error('Clipboard API unavailable');
        }
        await navigator.clipboard.writeText(url);
        toastr.success(t('panel.source.pi.oauth.copySucceeded'), t('runtime.common.mvuTitle'));
    } catch {
        toastr.warning(t('panel.source.pi.oauth.copyFailed'), t('runtime.common.mvuTitle'));
    }
}

function selectInputText(event: FocusEvent): void {
    (event.target as HTMLInputElement | null)?.select();
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getOAuthErrorMessage(error: unknown): string {
    return getLocalizedPiErrorMessage(error);
}

function format_error(error: unknown): string {
    return t('runtime.common.errorCause', {
        cause: _.escape(getErrorMessage(error)),
    });
}

function format_oauth_error(error: unknown): string {
    return t('runtime.common.errorCause', {
        cause: _.escape(getOAuthErrorMessage(error)),
    });
}

onBeforeUnmount(() => {
    oauthComponentMounted = false;
    cancelOAuthLogin(false);
    oauthStatusGeneration += 1;
    oauthStatusController?.abort();
});
</script>

<style scoped>
.mvu-field-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.mvu-api-profile-controls,
.mvu-pi-model-controls {
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

.mvu-pi-advanced-textarea {
    width: 100%;
    min-height: 5rem;
    resize: vertical;
    font-family: var(--monoFontFamily, monospace);
    white-space: pre;
}

.mvu-field-error {
    color: var(--SmartThemeQuoteColor, #ff6b6b);
    line-height: 1.35;
    word-break: break-word;
}

.mvu-oauth-status {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.mvu-link-button {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
}

@media (max-width: 520px) {
    .mvu-api-profile-controls,
    .mvu-pi-model-controls {
        grid-template-columns: 1fr;
    }
}
</style>
