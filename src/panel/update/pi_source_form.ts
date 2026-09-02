import type { Api, Model } from '@/function/update/pi/pi_gateway';
import {
    isPiDefaultProviderEndpoint,
    normalizePiEndpoint,
} from '@/function/update/pi/model_resolver';
import { resolvePiApiKeyScope } from '@/function/update/pi/provider_target';
import {
    resolvePiCapabilities,
    type PiApiCapabilities,
    type PiAuthType,
    type PiFieldMode,
    type PiProviderDefinition,
    type PiWireApi,
} from '@/function/update/pi/provider_registry';

export type PiTokenValidationError =
    | 'context-window-required'
    | 'max-tokens-positive-integer'
    | 'max-tokens-exceed-context-window';

export type PiSourceSelection = {
    api: PiWireApi;
    authType: PiAuthType;
};

export type PiOAuthUiContext = Readonly<{
    generation: number;
    providerId: string;
    profileName: string;
}>;

export type PiOAuthUiState = Readonly<{
    generation: number;
    providerId?: string;
    profileName: string;
    mounted: boolean;
    active: boolean;
}>;

export type PiApiKeyContext = Readonly<{
    source: string;
    authType: string;
    keyScope: string;
}>;

export type PiApiKeyCaches = Readonly<{
    customApiKey: string;
    apiKeys: Readonly<Record<string, string>>;
}>;

export type PiApiKeyTransition = Readonly<{
    activeApiKey: string;
    customApiKey: string;
    apiKeys: Record<string, string>;
}>;

/**
 * Move the shared visible key through source/provider-specific slots. OAuth and inactive sources
 * intentionally expose an empty active key, so a key can never flow into a different endpoint.
 */
export function transitionPiApiKey(
    previous: PiApiKeyContext,
    next: PiApiKeyContext,
    active_api_key: string,
    caches: PiApiKeyCaches
): PiApiKeyTransition {
    let custom_api_key = caches.customApiKey;
    const api_keys = { ...caches.apiKeys };

    if (previous.source === '自定义') {
        custom_api_key = active_api_key;
    } else if (
        previous.source === '更多' &&
        previous.authType === 'api_key' &&
        previous.keyScope !== ''
    ) {
        api_keys[previous.keyScope] = active_api_key;
    }

    const next_api_key =
        next.source === '自定义'
            ? custom_api_key
            : next.source === '更多' && next.authType === 'api_key' && next.keyScope !== ''
              ? (api_keys[next.keyScope] ?? '')
              : '';

    return {
        activeApiKey: next_api_key,
        customApiKey: custom_api_key,
        apiKeys: api_keys,
    };
}

/** Resolve a key slot only for a complete, valid API-key wire target. */
export { resolvePiApiKeyScope };

/** Stable identity for request-level overrides; invalid endpoints remain distinct and fail closed. */
export function resolvePiRequestTargetIdentity(
    definition: PiProviderDefinition | undefined,
    provider: string,
    api: string,
    auth_type: string,
    endpoint: string
): string {
    const requested_endpoint =
        endpoint.trim() === '' && definition ? definition.defaultBaseUrl : endpoint.trim();
    let endpoint_identity: string;
    try {
        endpoint_identity = normalizePiEndpoint(requested_endpoint);
    } catch {
        endpoint_identity = `invalid:${requested_endpoint}`;
    }
    return JSON.stringify([provider, api, auth_type, endpoint_identity]);
}

export type PiRequestOverrides = Readonly<{
    customHeaders: string;
    customIncludeBody: string;
    customExcludeBody: string;
}>;

export function transitionPiRequestOverrides(
    previous_target: string,
    next_target: string,
    overrides: PiRequestOverrides
): PiRequestOverrides {
    return previous_target === next_target
        ? { ...overrides }
        : { customHeaders: '', customIncludeBody: '', customExcludeBody: '' };
}

/** Keep post-confirmation OAuth actions bound to the exact UI context that requested them. */
export function isPiOAuthUiContextCurrent(
    captured: PiOAuthUiContext,
    current: PiOAuthUiState
): boolean {
    return (
        current.mounted &&
        current.active &&
        current.generation === captured.generation &&
        current.providerId === captured.providerId &&
        current.profileName === captured.profileName
    );
}

/**
 * Keep an unsupported persisted value visible until the user explicitly replaces it.
 * This lets the form report migration/configuration errors without silently changing settings.
 */
export function includePersistedPiOption<T extends string>(
    allowed_values: readonly T[],
    persisted_value: string
): readonly string[] {
    return persisted_value !== '' && !allowed_values.includes(persisted_value as T)
        ? [persisted_value, ...allowed_values]
        : allowed_values;
}

/**
 * A normally locked field becomes editable when its persisted value is invalid, so choosing an
 * allowed value is an explicit repair action. With no registered choices it remains locked.
 */
export function isPiSourceFieldReadonly(
    mode: PiFieldMode | undefined,
    allowed_values: readonly string[],
    persisted_value: string
): boolean {
    if (allowed_values.length === 0) {
        return true;
    }
    if (!allowed_values.includes(persisted_value)) {
        return false;
    }
    return mode !== 'select' || allowed_values.length <= 1;
}

export function resolvePiSourceSelection(
    definition: PiProviderDefinition,
    api: string,
    authType: string
): PiSourceSelection {
    const resolved_auth_type = definition.allowedAuthTypes.includes(authType as PiAuthType)
        ? (authType as PiAuthType)
        : definition.defaultAuthType;
    const oauth_api =
        resolved_auth_type === 'oauth' && definition.oauth !== undefined
            ? definition.oauth.api
            : undefined;
    const resolved_api =
        oauth_api ??
        (definition.allowedApis.includes(api as PiWireApi)
            ? (api as PiWireApi)
            : definition.defaultApi);

    return {
        api: resolved_api,
        authType: resolved_auth_type,
    };
}

export function resolvePiEndpointSelection(
    definition: PiProviderDefinition,
    auth_type: PiAuthType,
    endpoint: string
): string {
    return definition.allowCustomEndpoint && auth_type === 'api_key' ? endpoint : '';
}

/** Whether Source may safely inherit catalog-only capabilities for the configured endpoint. */
export function isPiEndpointCatalogCompatible(
    definition: PiProviderDefinition,
    endpoint: string
): boolean {
    return isPiDefaultProviderEndpoint(definition, endpoint);
}

export function resolvePiSourceCapabilities(
    definition: PiProviderDefinition,
    api: PiWireApi,
    endpoint: string,
    catalog_model?: Model<Api>
): Readonly<PiApiCapabilities> | undefined {
    const effective_catalog_model = isPiEndpointCatalogCompatible(definition, endpoint)
        ? catalog_model
        : undefined;
    return resolvePiCapabilities(definition, api, {
        model: effective_catalog_model,
        catalogHit: effective_catalog_model !== undefined,
    });
}

export function findPiCatalogModel(
    models: readonly Model<Api>[],
    model_id: string
): Model<Api> | undefined {
    return models.find(model => model.id === model_id);
}

export function resolvePiContextWindow(
    configured_context_window: unknown,
    catalog_context_window?: number
): number {
    if (configured_context_window === 0) {
        return Number.isInteger(catalog_context_window) && catalog_context_window! > 0
            ? catalog_context_window!
            : 0;
    }
    return typeof configured_context_window === 'number' &&
        Number.isInteger(configured_context_window) &&
        configured_context_window > 0
        ? configured_context_window
        : 0;
}

export const PI_INVALID_CONTEXT_WINDOW_INPUT = '__invalid_context_window__';

export function parsePiContextWindowInput(value: string, bad_input = false): number | string {
    if (bad_input) {
        return PI_INVALID_CONTEXT_WINDOW_INPUT;
    }
    if (value.trim() === '') {
        return 0;
    }
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : value;
}

export function validatePiTokenSettings(
    context_window: unknown,
    max_tokens: unknown
): PiTokenValidationError[] {
    const errors: PiTokenValidationError[] = [];
    const valid_context_window =
        typeof context_window === 'number' &&
        Number.isInteger(context_window) &&
        context_window > 0;
    const valid_max_tokens =
        typeof max_tokens === 'number' && Number.isInteger(max_tokens) && max_tokens > 0;
    if (!valid_context_window) {
        errors.push('context-window-required');
    }
    if (!valid_max_tokens) {
        errors.push('max-tokens-positive-integer');
    }
    if (valid_context_window && valid_max_tokens && max_tokens > context_window) {
        errors.push('max-tokens-exceed-context-window');
    }
    return errors;
}
