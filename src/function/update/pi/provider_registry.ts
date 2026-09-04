import {
    ANT_LING_MODELS,
    ANTHROPIC_MODELS,
    BASETEN_MODELS,
    CEREBRAS_MODELS,
    DEEPSEEK_MODELS,
    FIREWORKS_MODELS,
    GITHUB_COPILOT_MODELS,
    GOOGLE_MODELS,
    GROQ_MODELS,
    HUGGINGFACE_MODELS,
    KIMI_CODING_MODELS,
    MINIMAX_CN_MODELS,
    MINIMAX_MODELS,
    MISTRAL_MODELS,
    MOONSHOTAI_CN_MODELS,
    MOONSHOTAI_MODELS,
    NVIDIA_MODELS,
    OPENAI_CODEX_MODELS,
    OPENAI_MODELS,
    OPENCODE_GO_MODELS,
    OPENCODE_MODELS,
    OPENROUTER_MODELS,
    QWEN_TOKEN_PLAN_CN_MODELS,
    QWEN_TOKEN_PLAN_INDIVIDUAL_MODELS,
    QWEN_TOKEN_PLAN_MODELS,
    TOGETHER_MODELS,
    VERCEL_AI_GATEWAY_MODELS,
    XAI_MODELS,
    XIAOMI_MODELS,
    XIAOMI_TOKEN_PLAN_AMS_MODELS,
    XIAOMI_TOKEN_PLAN_CN_MODELS,
    XIAOMI_TOKEN_PLAN_SGP_MODELS,
    ZAI_CODING_CN_MODELS,
    ZAI_MODELS,
    anthropicMessagesApi,
    googleGenerativeAIApi,
    mistralConversationsApi,
    openAICodexResponsesApi,
    openAICompletionsApi,
    openAIResponsesApi,
    type Api,
    type Model,
    type ProviderStreams,
} from './pi_gateway';
import { createGoogleProxyAwareApi } from './google_proxy_adapter';
import {
    getPiProviderApiBaseUrl,
    PI_PROVIDER_KEYS,
    PI_PROVIDER_TARGET_REGISTRY,
    type PiAuthType,
    type PiProviderKey,
    type PiWireApi,
} from './provider_target';

export {
    isPiCorsProxyRequired,
    PI_AUTH_TYPES,
    PI_PROVIDER_KEYS,
    PI_WIRE_APIS,
    shouldUsePiCorsProxy,
} from './provider_target';
export type { PiAuthType, PiProviderKey, PiWireApi } from './provider_target';

/**
 * Codex protocol level implemented by the pinned pi-ai adapter/catalog. Keep this tied to an
 * adapter upgrade rather than MVU's unrelated application version: the models endpoint uses it to
 * hide entries whose request shape the active adapter cannot yet support.
 */
export const OPENAI_CODEX_ADAPTER_CLIENT_VERSION = '0.144.0';

export type PiFieldMode = 'hidden' | 'readonly' | 'select' | 'editable';

export interface PiProviderFieldVisibility {
    api: PiFieldMode;
    authType: PiFieldMode;
    endpoint: PiFieldMode;
    apiKey: 'hidden' | 'when-api-key';
    oauth: 'hidden' | 'when-oauth';
    model: 'editable';
    contextWindow: 'editable';
}

export interface PiApiCapabilities {
    /** The selected adapter/model combination supports MVU's streaming execution path. */
    streaming: boolean;
    tools: boolean;
    imageInput: boolean;
    /** Native JSON Schema response support. */
    structuredOutput: boolean;
    /** Native unconstrained JSON-object response support. */
    jsonObjectOutput: boolean;
    temperature: boolean;
    temperatureRange: readonly [minimum: number, maximum: number];
    sampling: Readonly<{
        topP: boolean;
        topK: boolean;
        frequencyPenalty: boolean;
        presencePenalty: boolean;
    }>;
}

export type PiOAuthExchangeKind = 'json' | 'form';

/**
 * Public-client OAuth metadata shared by the Source UI and the browser-safe OAuth bridge.
 * PKCE verifier/state values are request-scoped and intentionally do not belong here.
 */
export interface PiOAuthDefinition {
    providerId: PiProviderKey;
    api: PiWireApi;
    clientId: string;
    authorizeUrl: string;
    tokenUrl: string;
    redirectUri: string;
    allowedCallbackHosts: readonly ('localhost' | '127.0.0.1')[];
    scope: string;
    exchangeKind: PiOAuthExchangeKind;
    authorizeParams: Readonly<Record<string, string>>;
    tokenParams: Readonly<Record<string, string>>;
    includeStateInTokenRequest: boolean;
    /** Milliseconds subtracted from the upstream expiry when persisting a credential. */
    expirySkewMs: number;
}

export interface PiProviderDefinition {
    key: PiProviderKey;
    providerId: PiProviderKey;
    displayName: Readonly<{
        'zh-CN': string;
        en: string;
    }>;
    defaultApi: PiWireApi;
    allowedApis: readonly PiWireApi[];
    defaultAuthType: PiAuthType;
    allowedAuthTypes: readonly PiAuthType[];
    defaultBaseUrl: string;
    apiBaseUrls?: Readonly<Partial<Record<PiWireApi, string>>>;
    readonly corsProxyRequiredApis: readonly PiWireApi[];
    allowCustomEndpoint: boolean;
    apiCapabilities: Readonly<Partial<Record<PiWireApi, Readonly<PiApiCapabilities>>>>;
    fields: Readonly<PiProviderFieldVisibility>;
    oauth?: Readonly<PiOAuthDefinition>;
}

type Catalog = Readonly<Record<string, Model<Api>>>;
type ApiLoader = () => ProviderStreams;

const CATALOGS: Readonly<Record<PiProviderKey, Catalog>> = {
    'ant-ling': ANT_LING_MODELS,
    anthropic: ANTHROPIC_MODELS,
    baseten: BASETEN_MODELS,
    cerebras: CEREBRAS_MODELS,
    deepseek: DEEPSEEK_MODELS,
    fireworks: FIREWORKS_MODELS,
    'github-copilot': GITHUB_COPILOT_MODELS,
    google: GOOGLE_MODELS,
    groq: GROQ_MODELS,
    huggingface: HUGGINGFACE_MODELS,
    'kimi-coding': KIMI_CODING_MODELS,
    minimax: MINIMAX_MODELS,
    'minimax-cn': MINIMAX_CN_MODELS,
    mistral: MISTRAL_MODELS,
    moonshotai: MOONSHOTAI_MODELS,
    'moonshotai-cn': MOONSHOTAI_CN_MODELS,
    nvidia: NVIDIA_MODELS,
    openai: OPENAI_MODELS,
    'openai-codex': OPENAI_CODEX_MODELS,
    opencode: OPENCODE_MODELS,
    'opencode-go': OPENCODE_GO_MODELS,
    openrouter: OPENROUTER_MODELS,
    'qwen-token-plan': QWEN_TOKEN_PLAN_MODELS,
    'qwen-token-plan-cn': QWEN_TOKEN_PLAN_CN_MODELS,
    'qwen-token-plan-individual': QWEN_TOKEN_PLAN_INDIVIDUAL_MODELS,
    together: TOGETHER_MODELS,
    'vercel-ai-gateway': VERCEL_AI_GATEWAY_MODELS,
    xai: XAI_MODELS,
    xiaomi: XIAOMI_MODELS,
    'xiaomi-token-plan-ams': XIAOMI_TOKEN_PLAN_AMS_MODELS,
    'xiaomi-token-plan-cn': XIAOMI_TOKEN_PLAN_CN_MODELS,
    'xiaomi-token-plan-sgp': XIAOMI_TOKEN_PLAN_SGP_MODELS,
    zai: ZAI_MODELS,
    'zai-coding-cn': ZAI_CODING_CN_MODELS,
};

/** Provider catalog entries that are known to have been shut down upstream. */
const GOOGLE_RETIRED_MODEL_IDS: ReadonlySet<string> = new Set(['gemini-3.1-flash-lite-preview']);

const API_LOADERS: Readonly<Record<PiWireApi, ApiLoader>> = {
    'openai-responses': openAIResponsesApi,
    'openai-completions': openAICompletionsApi,
    'openai-codex-responses': openAICodexResponsesApi,
    'anthropic-messages': anthropicMessagesApi,
    'google-generative-ai': () => createGoogleProxyAwareApi(googleGenerativeAIApi()),
    'mistral-conversations': mistralConversationsApi,
};

const TOP_P_ONLY = Object.freeze({
    topP: true,
    topK: false,
    frequencyPenalty: false,
    presencePenalty: false,
});

const TOP_P_TOP_K = Object.freeze({
    topP: true,
    topK: true,
    frequencyPenalty: false,
    presencePenalty: false,
});

const OPENAI_COMPLETIONS_SAMPLING = Object.freeze({
    topP: true,
    topK: false,
    frequencyPenalty: true,
    presencePenalty: true,
});

const NO_SAMPLING = Object.freeze({
    topP: false,
    topK: false,
    frequencyPenalty: false,
    presencePenalty: false,
});

const TEMPERATURE_ZERO_TO_TWO = Object.freeze([0, 2] as const);
const TEMPERATURE_ZERO_TO_ONE = Object.freeze([0, 1] as const);

const OPENAI_RESPONSES_CAPABILITIES: Readonly<PiApiCapabilities> = Object.freeze({
    streaming: true,
    tools: true,
    imageInput: true,
    structuredOutput: true,
    jsonObjectOutput: true,
    temperature: true,
    temperatureRange: TEMPERATURE_ZERO_TO_TWO,
    sampling: TOP_P_ONLY,
});

const OPENAI_COMPLETIONS_CAPABILITIES: Readonly<PiApiCapabilities> = Object.freeze({
    streaming: true,
    tools: true,
    imageInput: true,
    structuredOutput: true,
    jsonObjectOutput: true,
    temperature: true,
    temperatureRange: TEMPERATURE_ZERO_TO_TWO,
    sampling: OPENAI_COMPLETIONS_SAMPLING,
});

const CODEX_CAPABILITIES: Readonly<PiApiCapabilities> = Object.freeze({
    streaming: true,
    tools: true,
    imageInput: true,
    structuredOutput: true,
    jsonObjectOutput: true,
    temperature: false,
    temperatureRange: TEMPERATURE_ZERO_TO_TWO,
    sampling: NO_SAMPLING,
});

const ANTHROPIC_CAPABILITIES: Readonly<PiApiCapabilities> = Object.freeze({
    streaming: true,
    tools: true,
    imageInput: true,
    structuredOutput: true,
    jsonObjectOutput: false,
    temperature: true,
    temperatureRange: TEMPERATURE_ZERO_TO_ONE,
    sampling: TOP_P_TOP_K,
});

const GOOGLE_CAPABILITIES: Readonly<PiApiCapabilities> = Object.freeze({
    streaming: true,
    tools: true,
    imageInput: true,
    structuredOutput: true,
    jsonObjectOutput: true,
    temperature: true,
    temperatureRange: TEMPERATURE_ZERO_TO_TWO,
    sampling: TOP_P_TOP_K,
});

const MISTRAL_CAPABILITIES: Readonly<PiApiCapabilities> = Object.freeze({
    streaming: true,
    tools: true,
    imageInput: true,
    structuredOutput: true,
    jsonObjectOutput: true,
    temperature: true,
    temperatureRange: TEMPERATURE_ZERO_TO_ONE,
    sampling: OPENAI_COMPLETIONS_SAMPLING,
});

const API_CAPABILITIES: Readonly<Record<PiWireApi, Readonly<PiApiCapabilities>>> = Object.freeze({
    'openai-responses': OPENAI_RESPONSES_CAPABILITIES,
    'openai-completions': OPENAI_COMPLETIONS_CAPABILITIES,
    'openai-codex-responses': CODEX_CAPABILITIES,
    'anthropic-messages': ANTHROPIC_CAPABILITIES,
    'google-generative-ai': GOOGLE_CAPABILITIES,
    'mistral-conversations': MISTRAL_CAPABILITIES,
});

const ANTHROPIC_OAUTH: Readonly<PiOAuthDefinition> = Object.freeze({
    providerId: 'anthropic',
    api: 'anthropic-messages',
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    authorizeUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://platform.claude.com/v1/oauth/token',
    redirectUri: 'http://localhost:53692/callback',
    allowedCallbackHosts: Object.freeze(['localhost', '127.0.0.1'] as const),
    scope: 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload',
    exchangeKind: 'json',
    authorizeParams: Object.freeze({ code: 'true' }),
    tokenParams: Object.freeze({}),
    includeStateInTokenRequest: true,
    expirySkewMs: 5 * 60 * 1000,
});

const OPENAI_CODEX_OAUTH: Readonly<PiOAuthDefinition> = Object.freeze({
    providerId: 'openai-codex',
    api: 'openai-codex-responses',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    authorizeUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    redirectUri: 'http://localhost:1455/auth/callback',
    allowedCallbackHosts: Object.freeze(['localhost', '127.0.0.1'] as const),
    scope: 'openid profile email offline_access',
    exchangeKind: 'form',
    authorizeParams: Object.freeze({
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
        originator: 'pi',
    }),
    tokenParams: Object.freeze({}),
    includeStateInTokenRequest: false,
    expirySkewMs: 0,
});

const EDITABLE_OPENAI_FIELDS: Readonly<PiProviderFieldVisibility> = Object.freeze({
    api: 'select',
    authType: 'readonly',
    endpoint: 'editable',
    apiKey: 'when-api-key',
    oauth: 'hidden',
    model: 'editable',
    contextWindow: 'editable',
});

const OAUTH_FIELDS: Readonly<PiProviderFieldVisibility> = Object.freeze({
    api: 'readonly',
    authType: 'readonly',
    endpoint: 'hidden',
    apiKey: 'hidden',
    oauth: 'when-oauth',
    model: 'editable',
    contextWindow: 'editable',
});

const MIXED_AUTH_FIELDS: Readonly<PiProviderFieldVisibility> = Object.freeze({
    api: 'readonly',
    authType: 'select',
    endpoint: 'editable',
    apiKey: 'when-api-key',
    oauth: 'when-oauth',
    model: 'editable',
    contextWindow: 'editable',
});

const API_KEY_FIELDS: Readonly<PiProviderFieldVisibility> = Object.freeze({
    api: 'readonly',
    authType: 'readonly',
    endpoint: 'hidden',
    apiKey: 'when-api-key',
    oauth: 'hidden',
    model: 'editable',
    contextWindow: 'editable',
});

const MULTI_API_KEY_FIELDS: Readonly<PiProviderFieldVisibility> = Object.freeze({
    ...API_KEY_FIELDS,
    api: 'select',
});

function fixedApiKeyProvider(
    key: PiProviderKey,
    name: string,
    chineseName = name
): Readonly<PiProviderDefinition> {
    const target = PI_PROVIDER_TARGET_REGISTRY[key];
    const apiCapabilities = Object.freeze(
        Object.fromEntries(target.allowedApis.map(api => [api, API_CAPABILITIES[api]]))
    ) as Readonly<Partial<Record<PiWireApi, Readonly<PiApiCapabilities>>>>;
    return Object.freeze({
        ...target,
        displayName: Object.freeze({ 'zh-CN': chineseName, en: name }),
        apiCapabilities,
        fields: target.allowedApis.length > 1 ? MULTI_API_KEY_FIELDS : API_KEY_FIELDS,
    });
}

export const PI_PROVIDER_REGISTRY: Readonly<Record<PiProviderKey, PiProviderDefinition>> =
    Object.freeze({
        'ant-ling': fixedApiKeyProvider('ant-ling', 'Ant Ling'),
        anthropic: Object.freeze({
            ...PI_PROVIDER_TARGET_REGISTRY.anthropic,
            displayName: Object.freeze({ 'zh-CN': 'Anthropic', en: 'Anthropic' }),
            apiCapabilities: Object.freeze({
                'anthropic-messages': ANTHROPIC_CAPABILITIES,
            }),
            fields: MIXED_AUTH_FIELDS,
            oauth: ANTHROPIC_OAUTH,
        }),
        baseten: fixedApiKeyProvider('baseten', 'Baseten'),
        cerebras: fixedApiKeyProvider('cerebras', 'Cerebras'),
        deepseek: fixedApiKeyProvider('deepseek', 'DeepSeek'),
        fireworks: fixedApiKeyProvider('fireworks', 'Fireworks'),
        'github-copilot': fixedApiKeyProvider('github-copilot', 'GitHub Copilot'),
        google: Object.freeze({
            ...PI_PROVIDER_TARGET_REGISTRY.google,
            displayName: Object.freeze({ 'zh-CN': 'Google Gemini', en: 'Google Gemini' }),
            apiCapabilities: Object.freeze({
                'google-generative-ai': GOOGLE_CAPABILITIES,
            }),
            fields: API_KEY_FIELDS,
        }),
        groq: fixedApiKeyProvider('groq', 'Groq'),
        huggingface: fixedApiKeyProvider('huggingface', 'Hugging Face'),
        'kimi-coding': fixedApiKeyProvider('kimi-coding', 'Kimi For Coding'),
        minimax: fixedApiKeyProvider('minimax', 'MiniMax'),
        'minimax-cn': fixedApiKeyProvider('minimax-cn', 'MiniMax CN', 'MiniMax（中国）'),
        mistral: fixedApiKeyProvider('mistral', 'Mistral'),
        moonshotai: fixedApiKeyProvider('moonshotai', 'Moonshot AI'),
        'moonshotai-cn': fixedApiKeyProvider(
            'moonshotai-cn',
            'Moonshot AI CN',
            'Moonshot AI（中国）'
        ),
        nvidia: fixedApiKeyProvider('nvidia', 'NVIDIA'),
        openai: Object.freeze({
            ...PI_PROVIDER_TARGET_REGISTRY.openai,
            displayName: Object.freeze({ 'zh-CN': 'OpenAI', en: 'OpenAI' }),
            apiCapabilities: Object.freeze({
                'openai-responses': OPENAI_RESPONSES_CAPABILITIES,
                'openai-completions': OPENAI_COMPLETIONS_CAPABILITIES,
            }),
            fields: EDITABLE_OPENAI_FIELDS,
        }),
        'openai-codex': Object.freeze({
            ...PI_PROVIDER_TARGET_REGISTRY['openai-codex'],
            displayName: Object.freeze({ 'zh-CN': 'OpenAI Codex', en: 'OpenAI Codex' }),
            apiCapabilities: Object.freeze({
                'openai-codex-responses': CODEX_CAPABILITIES,
            }),
            fields: OAUTH_FIELDS,
            oauth: OPENAI_CODEX_OAUTH,
        }),
        opencode: fixedApiKeyProvider('opencode', 'OpenCode Zen'),
        'opencode-go': fixedApiKeyProvider('opencode-go', 'OpenCode Go'),
        openrouter: fixedApiKeyProvider('openrouter', 'OpenRouter'),
        'qwen-token-plan': fixedApiKeyProvider('qwen-token-plan', 'Qwen Token Plan'),
        'qwen-token-plan-cn': fixedApiKeyProvider(
            'qwen-token-plan-cn',
            'Qwen Token Plan CN',
            'Qwen Token Plan（中国）'
        ),
        'qwen-token-plan-individual': fixedApiKeyProvider(
            'qwen-token-plan-individual',
            'Qwen Token Plan Individual'
        ),
        together: fixedApiKeyProvider('together', 'Together'),
        'vercel-ai-gateway': fixedApiKeyProvider('vercel-ai-gateway', 'Vercel AI Gateway'),
        xai: fixedApiKeyProvider('xai', 'xAI'),
        xiaomi: fixedApiKeyProvider('xiaomi', 'Xiaomi'),
        'xiaomi-token-plan-ams': fixedApiKeyProvider(
            'xiaomi-token-plan-ams',
            'Xiaomi Token Plan AMS'
        ),
        'xiaomi-token-plan-cn': fixedApiKeyProvider(
            'xiaomi-token-plan-cn',
            'Xiaomi Token Plan CN',
            'Xiaomi Token Plan（中国）'
        ),
        'xiaomi-token-plan-sgp': fixedApiKeyProvider(
            'xiaomi-token-plan-sgp',
            'Xiaomi Token Plan SGP'
        ),
        zai: fixedApiKeyProvider('zai', 'Z.AI'),
        'zai-coding-cn': fixedApiKeyProvider(
            'zai-coding-cn',
            'Z.AI Coding CN',
            'Z.AI Coding（中国）'
        ),
    } satisfies Record<PiProviderKey, PiProviderDefinition>);

export function listPiProviderDefinitions(): readonly PiProviderDefinition[] {
    return PI_PROVIDER_KEYS.map(key => PI_PROVIDER_REGISTRY[key]);
}

export function getPiProviderDefinition(key: string): PiProviderDefinition | undefined {
    return Object.prototype.hasOwnProperty.call(PI_PROVIDER_REGISTRY, key)
        ? PI_PROVIDER_REGISTRY[key as PiProviderKey]
        : undefined;
}

/** Compatibility spelling used by the OAuth/UI integration. */
export const getPiProviderRegistration = getPiProviderDefinition;

export function getPiCatalogModels(key: PiProviderKey | string): readonly Model<Api>[] {
    const definition = getPiProviderDefinition(key);
    if (!definition) {
        return [];
    }
    const models = Object.values(CATALOGS[definition.key]);
    return definition.key === 'google'
        ? models.filter(model => !GOOGLE_RETIRED_MODEL_IDS.has(model.id))
        : models;
}

function modelSupportsTemperature(model: Model<Api> | undefined): boolean {
    const compat = model?.compat;
    return (
        compat === undefined ||
        !('supportsTemperature' in compat) ||
        compat.supportsTemperature !== false
    );
}

/**
 * Anthropic rejects every sampling control (temperature, top_p and top_k) for these catalog
 * models. Keep the explicit IDs alongside the provider registry so a missing compat flag cannot
 * accidentally make a newly published catalog entry permissive.
 */
const ANTHROPIC_NO_SAMPLING_MODEL_IDS: ReadonlySet<string> = new Set([
    'claude-fable-5',
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-opus-5',
    'claude-sonnet-5',
]);

/** Catalog models explicitly available through OpenAI Chat Completions as well as Responses. */
const OPENAI_CHAT_COMPLETIONS_MODEL_IDS: ReadonlySet<string> = new Set([
    'gpt-4',
    'gpt-4-turbo',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4o',
    'gpt-4o-2024-05-13',
    'gpt-4o-2024-08-06',
    'gpt-4o-2024-11-20',
    'gpt-4o-mini',
    'gpt-5',
    'gpt-5-chat-latest',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-5.1',
    'gpt-5.2',
    'gpt-5.2-chat-latest',
    'gpt-5.3-chat-latest',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-5.5',
    'gpt-5.6-luna',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'o1',
    'o3',
    'o3-mini',
    'o4-mini',
]);

const OPENAI_NON_STREAMING_MODEL_IDS: ReadonlySet<string> = new Set([
    'gpt-5.5-pro',
    'gpt-realtime-2.1',
    'o1-pro',
    'o3-pro',
]);

const GOOGLE_NO_SAMPLING_MODEL_IDS: ReadonlySet<string> = new Set([
    'gemini-3.6-flash',
    'gemini-3.7-flash',
]);

/** Whether pinned catalog metadata is valid for the selected provider wire API. */
export function isPiCatalogModelApiCompatible(
    definition: PiProviderDefinition,
    model: Model<Api>,
    api: PiWireApi
): boolean {
    if (model.api === api) {
        return true;
    }
    return (
        definition.key === 'openai' &&
        model.api === 'openai-responses' &&
        api === 'openai-completions' &&
        OPENAI_CHAT_COMPLETIONS_MODEL_IDS.has(model.id)
    );
}

/**
 * Re-resolve and verify catalog metadata instead of trusting the caller's `catalogHit` bit.
 * Verified metadata is used for model-sensitive media, streaming, and sampling controls. Tools
 * and response formats intentionally remain wire-API capabilities: the real endpoint response is
 * authoritative when a particular model or compatible endpoint does not implement one of them.
 */
function verifiedCatalogModel(
    definition: PiProviderDefinition,
    api: PiWireApi,
    options: { model?: Model<Api>; catalogHit: boolean }
): Model<Api> | undefined {
    const model = options.model;
    if (!options.catalogHit || !model) {
        return undefined;
    }

    const catalogModel = getPiCatalogModels(definition.key).find(
        candidate => candidate.id === model.id
    );
    if (
        !catalogModel ||
        catalogModel.provider !== definition.providerId ||
        model.provider !== definition.providerId ||
        !isPiCatalogModelApiCompatible(definition, catalogModel, api) ||
        (model.api !== api && model.api !== catalogModel.api) ||
        catalogModel.baseUrl !== getPiProviderApiBaseUrl(definition, api) ||
        model.baseUrl !== getPiProviderApiBaseUrl(definition, api)
    ) {
        return undefined;
    }

    return catalogModel;
}

export function resolvePiCapabilities(
    definition: PiProviderDefinition,
    api: PiWireApi,
    options: { model?: Model<Api>; catalogHit: boolean }
): Readonly<PiApiCapabilities> | undefined {
    const registered = definition.apiCapabilities[api];
    if (!registered) {
        return undefined;
    }

    const catalogModel = verifiedCatalogModel(definition, api, options);
    const samplingModel = catalogModel ?? options.model;
    const anthropicSamplingAllowed =
        definition.key !== 'anthropic' ||
        catalogModel === undefined ||
        (samplingModel !== undefined &&
            modelSupportsTemperature(samplingModel) &&
            !ANTHROPIC_NO_SAMPLING_MODEL_IDS.has(samplingModel.id));
    // pi's Responses adapter selects `reasoning.effort: none` when the catalog explicitly
    // exposes it. Older GPT-5/o-series/pro models cannot turn reasoning off and reject
    // temperature/top_p. Dynamic OpenAI-compatible models remain API-level configurable.
    const openAISamplingAllowed =
        definition.key !== 'openai' ||
        !catalogModel?.reasoning ||
        catalogModel.thinkingLevelMap?.off === 'none';
    const googleSamplingAllowed =
        definition.key !== 'google' ||
        !catalogModel ||
        !GOOGLE_NO_SAMPLING_MODEL_IDS.has(catalogModel.id);
    const samplingAllowed =
        anthropicSamplingAllowed && openAISamplingAllowed && googleSamplingAllowed;
    const streamingAllowed =
        definition.key !== 'openai' ||
        !catalogModel ||
        !OPENAI_NON_STREAMING_MODEL_IDS.has(catalogModel.id);

    return Object.freeze({
        ...registered,
        // These are adapter-level promises. Any narrower endpoint/model support is reported by
        // the provider request itself instead of being guessed from a pinned catalog.
        streaming: registered.streaming && streamingAllowed,
        tools: registered.tools,
        structuredOutput: registered.structuredOutput,
        jsonObjectOutput: registered.jsonObjectOutput,
        imageInput: registered.imageInput && catalogModel?.input.includes('image') === true,
        temperature:
            registered.temperature && modelSupportsTemperature(samplingModel) && samplingAllowed,
        sampling: samplingAllowed ? registered.sampling : NO_SAMPLING,
    });
}

/** Create only the lazy wire implementations explicitly allowed by this source. */
export function createPiApiImplementations(
    definitionOrKey: PiProviderDefinition | PiProviderKey | string
): Partial<Record<PiWireApi, ProviderStreams>> {
    const definition =
        typeof definitionOrKey === 'string'
            ? getPiProviderDefinition(definitionOrKey)
            : definitionOrKey;
    if (!definition) {
        return {};
    }

    return Object.fromEntries(
        definition.allowedApis.map(api => [api, API_LOADERS[api]()])
    ) as Partial<Record<PiWireApi, ProviderStreams>>;
}
