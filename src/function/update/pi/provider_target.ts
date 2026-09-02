export const PI_PROVIDER_KEYS = ['openai', 'openai-codex', 'anthropic', 'google'] as const;
export type PiProviderKey = (typeof PI_PROVIDER_KEYS)[number];

export const PI_WIRE_APIS = [
    'openai-responses',
    'openai-completions',
    'openai-codex-responses',
    'anthropic-messages',
    'google-generative-ai',
] as const;
export type PiWireApi = (typeof PI_WIRE_APIS)[number];

export const PI_AUTH_TYPES = ['api_key', 'oauth'] as const;
export type PiAuthType = (typeof PI_AUTH_TYPES)[number];

export interface PiProviderTargetDefinition {
    key: PiProviderKey;
    providerId: PiProviderKey;
    defaultApi: PiWireApi;
    allowedApis: readonly PiWireApi[];
    defaultAuthType: PiAuthType;
    allowedAuthTypes: readonly PiAuthType[];
    defaultBaseUrl: string;
    allowCustomEndpoint: boolean;
}

/**
 * Lightweight source of truth for provider/API/auth/endpoint compatibility. Keeping this separate
 * from catalogs and adapters lets settings migration validate credential targets without loading
 * the provider SDK boundary.
 */
export const PI_PROVIDER_TARGET_REGISTRY: Readonly<
    Record<PiProviderKey, Readonly<PiProviderTargetDefinition>>
> = Object.freeze({
    openai: Object.freeze({
        key: 'openai',
        providerId: 'openai',
        defaultApi: 'openai-responses',
        allowedApis: Object.freeze(['openai-responses', 'openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://api.openai.com/v1',
        allowCustomEndpoint: true,
    }),
    'openai-codex': Object.freeze({
        key: 'openai-codex',
        providerId: 'openai-codex',
        defaultApi: 'openai-codex-responses',
        allowedApis: Object.freeze(['openai-codex-responses'] as const),
        defaultAuthType: 'oauth',
        allowedAuthTypes: Object.freeze(['oauth'] as const),
        defaultBaseUrl: 'https://chatgpt.com/backend-api',
        allowCustomEndpoint: false,
    }),
    anthropic: Object.freeze({
        key: 'anthropic',
        providerId: 'anthropic',
        defaultApi: 'anthropic-messages',
        allowedApis: Object.freeze(['anthropic-messages'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key', 'oauth'] as const),
        defaultBaseUrl: 'https://api.anthropic.com',
        allowCustomEndpoint: true,
    }),
    google: Object.freeze({
        key: 'google',
        providerId: 'google',
        defaultApi: 'google-generative-ai',
        allowedApis: Object.freeze(['google-generative-ai'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        allowCustomEndpoint: false,
    }),
});

export function getPiProviderTargetDefinition(
    key: string
): Readonly<PiProviderTargetDefinition> | undefined {
    return Object.prototype.hasOwnProperty.call(PI_PROVIDER_TARGET_REGISTRY, key)
        ? PI_PROVIDER_TARGET_REGISTRY[key as PiProviderKey]
        : undefined;
}

export class PiEndpointValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PiEndpointValidationError';
    }
}

const HTTP_LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Canonicalize and enforce the browser-safe transport policy for a Pi endpoint. */
export function normalizePiTargetEndpoint(endpoint: string): string {
    let parsed: URL;
    try {
        parsed = new URL(endpoint.trim());
    } catch {
        throw new PiEndpointValidationError('More source endpoint must be a valid URL');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new PiEndpointValidationError('More source endpoint must use http or https');
    }
    if (
        parsed.protocol === 'http:' &&
        !HTTP_LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase())
    ) {
        throw new PiEndpointValidationError(
            'More source HTTP endpoint must use localhost, 127.0.0.1, or [::1]'
        );
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new PiEndpointValidationError(
            'More source endpoint must not contain credentials, a query, or a fragment'
        );
    }

    const normalized_path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${normalized_path}`;
}

const PI_API_OPERATION_PATH_SUFFIXES: Partial<Record<PiWireApi, readonly string[]>> = {
    'openai-responses': ['/responses'],
    'openai-completions': ['/chat/completions', '/completions'],
    'anthropic-messages': ['/v1/messages', '/messages'],
};

/**
 * Normalize a safe endpoint to the API base expected by provider SDKs, removing at most one
 * operation-route suffix that the selected SDK appends itself.
 */
export function normalizePiApiBaseEndpoint(api: PiWireApi, endpoint: string): string {
    const normalized_endpoint = normalizePiTargetEndpoint(endpoint);
    const parsed = new URL(normalized_endpoint);
    const normalized_path_lower = parsed.pathname.toLowerCase();
    const operation_path = PI_API_OPERATION_PATH_SUFFIXES[api]?.find(suffix =>
        normalized_path_lower.endsWith(suffix)
    );
    if (!operation_path) {
        return normalized_endpoint;
    }

    const base_path = parsed.pathname.slice(0, -operation_path.length).replace(/\/+$/, '');
    return normalizePiTargetEndpoint(`${parsed.origin}${base_path}`);
}

/** Resolve a credential-cache slot only for a complete, valid API-key wire target. */
export function resolvePiApiKeyScope(
    definition: Readonly<PiProviderTargetDefinition> | undefined,
    api: string,
    auth_type: string,
    endpoint: string
): string {
    if (
        !definition ||
        auth_type !== 'api_key' ||
        !definition.allowedAuthTypes.includes('api_key') ||
        !definition.allowedApis.includes(api as PiWireApi) ||
        (endpoint.trim() !== '' && !definition.allowCustomEndpoint)
    ) {
        return '';
    }

    try {
        const effective_endpoint = normalizePiApiBaseEndpoint(
            api as PiWireApi,
            endpoint.trim() === '' ? definition.defaultBaseUrl : endpoint
        );
        return `${definition.key}\n${effective_endpoint}`;
    } catch {
        return '';
    }
}
