export const PI_PROVIDER_KEYS = [
    'ant-ling',
    'anthropic',
    'baseten',
    'cerebras',
    'deepseek',
    'fireworks',
    'github-copilot',
    'google',
    'groq',
    'huggingface',
    'kimi-coding',
    'minimax',
    'minimax-cn',
    'mistral',
    'moonshotai',
    'moonshotai-cn',
    'nvidia',
    'openai',
    'openai-codex',
    'opencode',
    'opencode-go',
    'openrouter',
    'qwen-token-plan',
    'qwen-token-plan-cn',
    'qwen-token-plan-individual',
    'together',
    'vercel-ai-gateway',
    'xai',
    'xiaomi',
    'xiaomi-token-plan-ams',
    'xiaomi-token-plan-cn',
    'xiaomi-token-plan-sgp',
    'zai',
    'zai-coding-cn',
] as const;
export type PiProviderKey = (typeof PI_PROVIDER_KEYS)[number];

export const PI_WIRE_APIS = [
    'openai-responses',
    'openai-completions',
    'openai-codex-responses',
    'anthropic-messages',
    'google-generative-ai',
    'mistral-conversations',
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
    apiBaseUrls?: Readonly<Partial<Record<PiWireApi, string>>>;
    /** Wire APIs whose built-in endpoint requires SillyTavern's CORS proxy in a browser. */
    readonly corsProxyRequiredApis: readonly PiWireApi[];
    allowCustomEndpoint: boolean;
}

type PiProviderTargetDefinitionInput = Omit<PiProviderTargetDefinition, 'corsProxyRequiredApis'> & {
    readonly corsProxyRequiredApis?: readonly PiWireApi[];
};

const NO_CORS_PROXY_REQUIRED_APIS: readonly PiWireApi[] = Object.freeze([]);

function definePiProviderTarget(
    input: PiProviderTargetDefinitionInput
): Readonly<PiProviderTargetDefinition> {
    return Object.freeze({
        ...input,
        corsProxyRequiredApis:
            input.corsProxyRequiredApis === undefined
                ? NO_CORS_PROXY_REQUIRED_APIS
                : Object.freeze([...input.corsProxyRequiredApis]),
    });
}

/**
 * Lightweight source of truth for provider/API/auth/endpoint compatibility. Keeping this separate
 * from catalogs and adapters lets settings migration validate credential targets without loading
 * the provider SDK boundary.
 */
export const PI_PROVIDER_TARGET_REGISTRY: Readonly<
    Record<PiProviderKey, Readonly<PiProviderTargetDefinition>>
> = Object.freeze({
    'ant-ling': definePiProviderTarget({
        key: 'ant-ling',
        providerId: 'ant-ling',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://api.ant-ling.com/v1',
        corsProxyRequiredApis: ['openai-completions'],
        allowCustomEndpoint: false,
    }),
    anthropic: definePiProviderTarget({
        key: 'anthropic',
        providerId: 'anthropic',
        defaultApi: 'anthropic-messages',
        allowedApis: Object.freeze(['anthropic-messages'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key', 'oauth'] as const),
        defaultBaseUrl: 'https://api.anthropic.com',
        allowCustomEndpoint: true,
    }),
    baseten: definePiProviderTarget({
        key: 'baseten',
        providerId: 'baseten',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://inference.baseten.co/v1',
        allowCustomEndpoint: false,
    }),
    cerebras: definePiProviderTarget({
        key: 'cerebras',
        providerId: 'cerebras',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://api.cerebras.ai/v1',
        allowCustomEndpoint: false,
    }),
    deepseek: definePiProviderTarget({
        key: 'deepseek',
        providerId: 'deepseek',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://api.deepseek.com',
        allowCustomEndpoint: false,
    }),
    fireworks: definePiProviderTarget({
        key: 'fireworks',
        providerId: 'fireworks',
        defaultApi: 'anthropic-messages',
        allowedApis: Object.freeze(['anthropic-messages', 'openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://api.fireworks.ai/inference',
        apiBaseUrls: Object.freeze({
            'anthropic-messages': 'https://api.fireworks.ai/inference',
            'openai-completions': 'https://api.fireworks.ai/inference/v1',
        }),
        corsProxyRequiredApis: ['anthropic-messages'],
        allowCustomEndpoint: false,
    }),
    'github-copilot': definePiProviderTarget({
        key: 'github-copilot',
        providerId: 'github-copilot',
        defaultApi: 'anthropic-messages',
        allowedApis: Object.freeze([
            'anthropic-messages',
            'openai-completions',
            'openai-responses',
        ] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://api.individual.githubcopilot.com',
        corsProxyRequiredApis: ['anthropic-messages', 'openai-responses'],
        allowCustomEndpoint: false,
    }),
    google: definePiProviderTarget({
        key: 'google',
        providerId: 'google',
        defaultApi: 'google-generative-ai',
        allowedApis: Object.freeze(['google-generative-ai'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        allowCustomEndpoint: false,
    }),
    groq: definePiProviderTarget({
        key: 'groq',
        providerId: 'groq',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://api.groq.com/openai/v1',
        allowCustomEndpoint: false,
    }),
    huggingface: definePiProviderTarget({
        key: 'huggingface',
        providerId: 'huggingface',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://router.huggingface.co/v1',
        allowCustomEndpoint: false,
    }),
    'kimi-coding': definePiProviderTarget({
        key: 'kimi-coding',
        providerId: 'kimi-coding',
        defaultApi: 'anthropic-messages',
        allowedApis: Object.freeze(['anthropic-messages'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://api.kimi.com/coding',
        corsProxyRequiredApis: ['anthropic-messages'],
        allowCustomEndpoint: false,
    }),
    minimax: definePiProviderTarget({
        key: 'minimax',
        providerId: 'minimax',
        defaultApi: 'anthropic-messages',
        allowedApis: Object.freeze(['anthropic-messages'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://api.minimax.io/anthropic',
        allowCustomEndpoint: false,
    }),
    'minimax-cn': definePiProviderTarget({
        key: 'minimax-cn',
        providerId: 'minimax-cn',
        defaultApi: 'anthropic-messages',
        allowedApis: Object.freeze(['anthropic-messages'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://api.minimaxi.com/anthropic',
        corsProxyRequiredApis: ['anthropic-messages'],
        allowCustomEndpoint: false,
    }),
    mistral: definePiProviderTarget({
        key: 'mistral',
        providerId: 'mistral',
        defaultApi: 'mistral-conversations',
        allowedApis: Object.freeze(['mistral-conversations'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://api.mistral.ai',
        allowCustomEndpoint: false,
    }),
    moonshotai: definePiProviderTarget({
        key: 'moonshotai',
        providerId: 'moonshotai',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://api.moonshot.ai/v1',
        allowCustomEndpoint: false,
    }),
    'moonshotai-cn': definePiProviderTarget({
        key: 'moonshotai-cn',
        providerId: 'moonshotai-cn',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://api.moonshot.cn/v1',
        allowCustomEndpoint: false,
    }),
    nvidia: definePiProviderTarget({
        key: 'nvidia',
        providerId: 'nvidia',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
        corsProxyRequiredApis: ['openai-completions'],
        allowCustomEndpoint: false,
    }),
    openai: definePiProviderTarget({
        key: 'openai',
        providerId: 'openai',
        defaultApi: 'openai-responses',
        allowedApis: Object.freeze(['openai-responses', 'openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://api.openai.com/v1',
        allowCustomEndpoint: true,
    }),
    'openai-codex': definePiProviderTarget({
        key: 'openai-codex',
        providerId: 'openai-codex',
        defaultApi: 'openai-codex-responses',
        allowedApis: Object.freeze(['openai-codex-responses'] as const),
        defaultAuthType: 'oauth',
        allowedAuthTypes: Object.freeze(['oauth'] as const),
        defaultBaseUrl: 'https://chatgpt.com/backend-api',
        corsProxyRequiredApis: ['openai-codex-responses'],
        allowCustomEndpoint: false,
    }),
    opencode: definePiProviderTarget({
        key: 'opencode',
        providerId: 'opencode',
        defaultApi: 'anthropic-messages',
        allowedApis: Object.freeze([
            'anthropic-messages',
            'google-generative-ai',
            'openai-completions',
            'openai-responses',
        ] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://opencode.ai/zen',
        apiBaseUrls: Object.freeze({
            'anthropic-messages': 'https://opencode.ai/zen',
            'google-generative-ai': 'https://opencode.ai/zen/v1',
            'openai-completions': 'https://opencode.ai/zen/v1',
            'openai-responses': 'https://opencode.ai/zen/v1',
        }),
        corsProxyRequiredApis: [
            'anthropic-messages',
            'google-generative-ai',
            'openai-completions',
            'openai-responses',
        ],
        allowCustomEndpoint: false,
    }),
    'opencode-go': definePiProviderTarget({
        key: 'opencode-go',
        providerId: 'opencode-go',
        defaultApi: 'anthropic-messages',
        allowedApis: Object.freeze([
            'anthropic-messages',
            'openai-completions',
            'openai-responses',
        ] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://opencode.ai/zen/go',
        apiBaseUrls: Object.freeze({
            'anthropic-messages': 'https://opencode.ai/zen/go',
            'openai-completions': 'https://opencode.ai/zen/go/v1',
            'openai-responses': 'https://opencode.ai/zen/go/v1',
        }),
        corsProxyRequiredApis: ['anthropic-messages', 'openai-completions', 'openai-responses'],
        allowCustomEndpoint: false,
    }),
    openrouter: definePiProviderTarget({
        key: 'openrouter',
        providerId: 'openrouter',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://openrouter.ai/api/v1',
        allowCustomEndpoint: false,
    }),
    'qwen-token-plan': definePiProviderTarget({
        key: 'qwen-token-plan',
        providerId: 'qwen-token-plan',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
        allowCustomEndpoint: false,
    }),
    'qwen-token-plan-cn': definePiProviderTarget({
        key: 'qwen-token-plan-cn',
        providerId: 'qwen-token-plan-cn',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        allowCustomEndpoint: false,
    }),
    'qwen-token-plan-individual': definePiProviderTarget({
        key: 'qwen-token-plan-individual',
        providerId: 'qwen-token-plan-individual',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
        allowCustomEndpoint: false,
    }),
    together: definePiProviderTarget({
        key: 'together',
        providerId: 'together',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://api.together.ai/v1',
        allowCustomEndpoint: false,
    }),
    'vercel-ai-gateway': definePiProviderTarget({
        key: 'vercel-ai-gateway',
        providerId: 'vercel-ai-gateway',
        defaultApi: 'anthropic-messages',
        allowedApis: Object.freeze(['anthropic-messages'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://ai-gateway.vercel.sh',
        allowCustomEndpoint: false,
    }),
    xai: definePiProviderTarget({
        key: 'xai',
        providerId: 'xai',
        defaultApi: 'openai-responses',
        allowedApis: Object.freeze(['openai-responses'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://api.x.ai/v1',
        allowCustomEndpoint: false,
    }),
    xiaomi: definePiProviderTarget({
        key: 'xiaomi',
        providerId: 'xiaomi',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://api.xiaomimimo.com/v1',
        allowCustomEndpoint: false,
    }),
    'xiaomi-token-plan-ams': definePiProviderTarget({
        key: 'xiaomi-token-plan-ams',
        providerId: 'xiaomi-token-plan-ams',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
        allowCustomEndpoint: false,
    }),
    'xiaomi-token-plan-cn': definePiProviderTarget({
        key: 'xiaomi-token-plan-cn',
        providerId: 'xiaomi-token-plan-cn',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
        allowCustomEndpoint: false,
    }),
    'xiaomi-token-plan-sgp': definePiProviderTarget({
        key: 'xiaomi-token-plan-sgp',
        providerId: 'xiaomi-token-plan-sgp',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
        allowCustomEndpoint: false,
    }),
    zai: definePiProviderTarget({
        key: 'zai',
        providerId: 'zai',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
        allowCustomEndpoint: false,
    }),
    'zai-coding-cn': definePiProviderTarget({
        key: 'zai-coding-cn',
        providerId: 'zai-coding-cn',
        defaultApi: 'openai-completions',
        allowedApis: Object.freeze(['openai-completions'] as const),
        defaultAuthType: 'api_key',
        allowedAuthTypes: Object.freeze(['api_key'] as const),
        defaultBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
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

/** Return whether this built-in provider/API route must use SillyTavern's CORS proxy. */
export function isPiCorsProxyRequired(
    definition: Readonly<PiProviderTargetDefinition> | undefined,
    api: string
): boolean {
    return definition?.corsProxyRequiredApis.includes(api as PiWireApi) ?? false;
}

/**
 * Resolve the browser transport for the active target. Registered endpoints use the audited
 * provider/API policy; an explicitly entered endpoint is user-owned and follows its checkbox.
 */
export function shouldUsePiCorsProxy(
    definition: Readonly<PiProviderTargetDefinition> | undefined,
    api: string,
    endpoint: string,
    customEndpointUseProxy: unknown
): boolean {
    const explicit_endpoint = endpoint.trim();
    if (
        !definition ||
        explicit_endpoint === '' ||
        !definition.allowedApis.includes(api as PiWireApi)
    ) {
        return isPiCorsProxyRequired(definition, api);
    }
    try {
        const wire_api = api as PiWireApi;
        const configured_base = normalizePiApiBaseEndpoint(wire_api, explicit_endpoint);
        const registered_base = normalizePiApiBaseEndpoint(
            wire_api,
            getPiProviderApiBaseUrl(definition, wire_api)
        );
        if (configured_base === registered_base) {
            return isPiCorsProxyRequired(definition, api);
        }
    } catch {
        // Target validation reports malformed endpoints. Until then, keep the explicit checkbox
        // semantics so the UI does not mislabel an invalid value as a registered route.
    }
    return customEndpointUseProxy === true;
}

export function getPiProviderApiBaseUrl(
    definition: Readonly<PiProviderTargetDefinition>,
    api: PiWireApi
): string {
    return definition.apiBaseUrls?.[api] ?? definition.defaultBaseUrl;
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
            endpoint.trim() === ''
                ? getPiProviderApiBaseUrl(definition, api as PiWireApi)
                : endpoint
        );
        return `${definition.key}\n${effective_endpoint}`;
    } catch {
        return '';
    }
}
