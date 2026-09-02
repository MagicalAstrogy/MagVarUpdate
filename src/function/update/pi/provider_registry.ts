import {
    ANTHROPIC_MODELS,
    GOOGLE_MODELS,
    OPENAI_CODEX_MODELS,
    OPENAI_MODELS,
    anthropicMessagesApi,
    googleGenerativeAIApi,
    openAICodexResponsesApi,
    openAICompletionsApi,
    openAIResponsesApi,
    type Api,
    type Model,
    type ProviderStreams,
} from './pi_gateway';
import {
    PI_PROVIDER_KEYS,
    PI_PROVIDER_TARGET_REGISTRY,
    type PiAuthType,
    type PiProviderKey,
    type PiWireApi,
} from './provider_target';

export { PI_AUTH_TYPES, PI_PROVIDER_KEYS, PI_WIRE_APIS } from './provider_target';
export type { PiAuthType, PiProviderKey, PiWireApi } from './provider_target';

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
    allowCustomEndpoint: boolean;
    apiCapabilities: Readonly<Partial<Record<PiWireApi, Readonly<PiApiCapabilities>>>>;
    fields: Readonly<PiProviderFieldVisibility>;
    oauth?: Readonly<PiOAuthDefinition>;
}

type Catalog = Readonly<Record<string, Model<Api>>>;
type ApiLoader = () => ProviderStreams;

const CATALOGS: Readonly<Record<PiProviderKey, Catalog>> = {
    openai: OPENAI_MODELS,
    'openai-codex': OPENAI_CODEX_MODELS,
    anthropic: ANTHROPIC_MODELS,
    google: GOOGLE_MODELS,
};

/** Provider catalog entries that are known to have been shut down upstream. */
const GOOGLE_RETIRED_MODEL_IDS: ReadonlySet<string> = new Set(['gemini-3.1-flash-lite-preview']);

const API_LOADERS: Readonly<Record<PiWireApi, ApiLoader>> = {
    'openai-responses': openAIResponsesApi,
    'openai-completions': openAICompletionsApi,
    'openai-codex-responses': openAICodexResponsesApi,
    'anthropic-messages': anthropicMessagesApi,
    'google-generative-ai': googleGenerativeAIApi,
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
    structuredOutput: false,
    jsonObjectOutput: false,
    temperature: false,
    temperatureRange: TEMPERATURE_ZERO_TO_TWO,
    sampling: NO_SAMPLING,
});

const ANTHROPIC_CAPABILITIES: Readonly<PiApiCapabilities> = Object.freeze({
    streaming: true,
    tools: true,
    imageInput: true,
    structuredOutput: false,
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

export const PI_PROVIDER_REGISTRY: Readonly<Record<PiProviderKey, PiProviderDefinition>> =
    Object.freeze({
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
        anthropic: Object.freeze({
            ...PI_PROVIDER_TARGET_REGISTRY.anthropic,
            displayName: Object.freeze({ 'zh-CN': 'Anthropic', en: 'Anthropic' }),
            apiCapabilities: Object.freeze({
                'anthropic-messages': ANTHROPIC_CAPABILITIES,
            }),
            fields: MIXED_AUTH_FIELDS,
            oauth: ANTHROPIC_OAUTH,
        }),
        google: Object.freeze({
            ...PI_PROVIDER_TARGET_REGISTRY.google,
            displayName: Object.freeze({ 'zh-CN': 'Google Gemini', en: 'Google Gemini' }),
            apiCapabilities: Object.freeze({
                'google-generative-ai': GOOGLE_CAPABILITIES,
            }),
            fields: API_KEY_FIELDS,
        }),
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

/**
 * Only ordinary Gemini generation models whose tool support is explicitly understood belong
 * here. Agent, computer-use, image, live, robotics and Gemma catalog entries deliberately fail
 * closed even though they share the same wire API.
 */
const GOOGLE_TOOL_MODEL_IDS: ReadonlySet<string> = new Set([
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite',
    'gemini-3.1-pro-preview',
    'gemini-3.1-pro-preview-customtools',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
]);

/** Models with explicitly documented native JSON / JSON Schema response support. */
const GOOGLE_STRUCTURED_OUTPUT_MODEL_IDS: ReadonlySet<string> = new Set([
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite',
    'gemini-3.1-pro-preview',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
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

const OPENAI_NO_TOOL_MODEL_IDS: ReadonlySet<string> = new Set(['gpt-4', 'gpt-realtime-2.1']);

const OPENAI_NO_STRUCTURED_OUTPUT_MODEL_IDS: ReadonlySet<string> = new Set([
    'gpt-4',
    'gpt-4-turbo',
    'gpt-4o-2024-05-13',
    'gpt-5.2-pro',
    'gpt-5.4-pro',
    'gpt-realtime-2.1',
    'o1-pro',
    'o3-pro',
]);

/** JSON mode predates JSON Schema support and is available on some schema-denied models. */
const OPENAI_NO_JSON_OBJECT_OUTPUT_MODEL_IDS: ReadonlySet<string> = new Set([
    'gpt-4',
    'gpt-5.2-pro',
    'gpt-5.4-pro',
    'gpt-realtime-2.1',
    'o1-pro',
    'o3-pro',
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
 * Advanced capabilities are tied to the original provider/API/default endpoint tuple. A model
 * cloned onto another wire API or a custom endpoint remains usable for text, but does not inherit
 * capabilities that have not been audited for that route.
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
        catalogModel.baseUrl !== definition.defaultBaseUrl ||
        model.baseUrl !== definition.defaultBaseUrl
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
    const advancedCapabilitiesVerified = catalogModel !== undefined;
    const googleToolsAllowed =
        definition.key !== 'google' ||
        (catalogModel !== undefined && GOOGLE_TOOL_MODEL_IDS.has(catalogModel.id));
    const googleStructuredOutputAllowed =
        definition.key !== 'google' ||
        (catalogModel !== undefined && GOOGLE_STRUCTURED_OUTPUT_MODEL_IDS.has(catalogModel.id));
    const openAIToolsAllowed =
        definition.key !== 'openai' ||
        (catalogModel !== undefined && !OPENAI_NO_TOOL_MODEL_IDS.has(catalogModel.id));
    const openAIStructuredOutputAllowed =
        definition.key !== 'openai' ||
        (catalogModel !== undefined && !OPENAI_NO_STRUCTURED_OUTPUT_MODEL_IDS.has(catalogModel.id));
    const openAIJsonObjectOutputAllowed =
        definition.key !== 'openai' ||
        (catalogModel !== undefined &&
            !OPENAI_NO_JSON_OBJECT_OUTPUT_MODEL_IDS.has(catalogModel.id));
    const samplingModel = catalogModel ?? options.model;
    const anthropicSamplingAllowed =
        definition.key !== 'anthropic' ||
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
        // Unknown, remapped, or custom-endpoint models have no auditable advanced capability
        // metadata. Keep ordinary text requests available, but fail closed for those features.
        streaming: registered.streaming && streamingAllowed,
        tools:
            registered.tools &&
            advancedCapabilitiesVerified &&
            googleToolsAllowed &&
            openAIToolsAllowed,
        structuredOutput:
            registered.structuredOutput &&
            advancedCapabilitiesVerified &&
            googleStructuredOutputAllowed &&
            openAIStructuredOutputAllowed,
        jsonObjectOutput:
            registered.jsonObjectOutput &&
            advancedCapabilitiesVerified &&
            googleStructuredOutputAllowed &&
            openAIJsonObjectOutputAllowed,
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
