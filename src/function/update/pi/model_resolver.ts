import { type Api, type Model } from './pi_gateway';
import {
    getPiCatalogModels,
    getPiProviderDefinition,
    isPiCatalogModelApiCompatible,
    type PiAuthType,
    type PiProviderDefinition,
    type PiProviderKey,
    type PiWireApi,
} from './provider_registry';
import {
    getPiProviderApiBaseUrl,
    normalizePiApiBaseEndpoint,
    normalizePiTargetEndpoint,
    PiEndpointValidationError,
} from './provider_target';

export { resolvePiApiKeyScope } from './provider_target';

export interface PiModelConfiguration {
    provider: string;
    api: string;
    authType: string;
    endpoint?: string;
    model: string;
    /** Zero means "use catalog metadata". A positive value overrides the catalog. */
    contextWindow?: number;
}

export interface ResolvePiModelInput {
    piConfig: PiModelConfiguration | unknown;
    maxTokens: number | unknown;
    apiKey?: string | unknown;
}

export type PiModelResolutionErrorCode =
    | 'invalid_config'
    | 'unknown_provider'
    | 'unsupported_api'
    | 'unsupported_auth'
    | 'missing_api_key'
    | 'invalid_endpoint'
    | 'custom_endpoint_not_allowed'
    | 'oauth_endpoint_not_allowed'
    | 'oauth_api_mismatch'
    | 'missing_model'
    | 'invalid_context_window'
    | 'missing_context_window'
    | 'invalid_max_tokens'
    | 'max_tokens_exceed_context';

export class PiModelResolutionError extends Error {
    constructor(
        public readonly code: PiModelResolutionErrorCode,
        message: string
    ) {
        super(message);
        this.name = 'PiModelResolutionError';
    }
}

export interface ValidatedPiConfiguration {
    definition: PiProviderDefinition;
    provider: PiProviderKey;
    api: PiWireApi;
    authType: PiAuthType;
    endpoint: string;
    modelId: string;
    manualContextWindow: number;
    configuredMaxTokens: number;
    apiKey?: string;
    catalogModel?: Model<Api>;
    effectiveContextWindow: number;
    effectiveMaxTokens: number;
}

export interface ResolvedPiModel {
    definition: PiProviderDefinition;
    model: Model<Api>;
    catalogHit: boolean;
    effectiveContextWindow: number;
    effectiveMaxTokens: number;
    authType: PiAuthType;
    apiKey?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(
    source: Record<string, unknown>,
    field: string,
    errorCode: PiModelResolutionErrorCode,
    label: string
): string {
    const value = source[field];
    if (typeof value !== 'string' || value.trim() === '') {
        throw new PiModelResolutionError(errorCode, `${label} must be a non-empty string`);
    }
    return value.trim();
}

/** Canonicalize and enforce the browser-safe transport policy for a custom Pi endpoint. */
export function normalizePiEndpoint(endpoint: string): string {
    try {
        return normalizePiTargetEndpoint(endpoint);
    } catch (error) {
        if (error instanceof PiEndpointValidationError) {
            throw new PiModelResolutionError('invalid_endpoint', error.message);
        }
        throw error;
    }
}

/** Empty and explicitly configured canonical default endpoints are equivalent. */
export function isPiDefaultProviderEndpoint(
    definition: PiProviderDefinition,
    endpoint: string,
    api: PiWireApi = definition.defaultApi
): boolean {
    const requested = endpoint.trim();
    if (requested === '') {
        return true;
    }
    try {
        return (
            normalizePiApiBaseEndpoint(api, requested) ===
            normalizePiApiBaseEndpoint(api, getPiProviderApiBaseUrl(definition, api))
        );
    } catch {
        return false;
    }
}

function validateNonNegativeInteger(value: unknown, field: string): number {
    if (value === undefined) {
        return 0;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new PiModelResolutionError(
            'invalid_context_window',
            `${field} must be a non-negative integer`
        );
    }
    return value;
}

function validatePositiveInteger(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new PiModelResolutionError(
            'invalid_max_tokens',
            `${field} must be a positive integer`
        );
    }
    return value;
}

function findCatalogModel(
    definition: PiProviderDefinition,
    modelId: string
): Model<Api> | undefined {
    return getPiCatalogModels(definition.key).find(model => model.id === modelId);
}

/** Validate the source/API/auth/model metadata combination without mutating settings or catalogs. */
export function validatePiConfiguration(input: ResolvePiModelInput): ValidatedPiConfiguration {
    if (!isRecord(input.piConfig)) {
        throw new PiModelResolutionError(
            'invalid_config',
            'More source configuration must be an object'
        );
    }

    const provider = requiredString(
        input.piConfig,
        'provider',
        'unknown_provider',
        'More source provider'
    );
    const definition = getPiProviderDefinition(provider);
    if (!definition) {
        throw new PiModelResolutionError(
            'unknown_provider',
            `Unknown More source provider: ${provider}`
        );
    }

    const api = requiredString(input.piConfig, 'api', 'unsupported_api', 'More source API');
    if (!definition.allowedApis.some(candidate => candidate === api)) {
        throw new PiModelResolutionError(
            'unsupported_api',
            `Provider ${definition.key} does not support API ${api}`
        );
    }

    const authType = requiredString(
        input.piConfig,
        'authType',
        'unsupported_auth',
        'More source auth type'
    );
    if (!definition.allowedAuthTypes.some(candidate => candidate === authType)) {
        throw new PiModelResolutionError(
            'unsupported_auth',
            `Provider ${definition.key} does not support ${authType} authentication`
        );
    }

    const rawEndpoint = input.piConfig.endpoint;
    if (rawEndpoint !== undefined && typeof rawEndpoint !== 'string') {
        throw new PiModelResolutionError(
            'invalid_endpoint',
            'More source endpoint must be a string'
        );
    }
    const requestedEndpoint = (rawEndpoint ?? '').trim();

    if (authType === 'oauth') {
        if (!definition.oauth) {
            throw new PiModelResolutionError(
                'unsupported_auth',
                `Provider ${definition.key} has no OAuth registration`
            );
        }
        if (requestedEndpoint) {
            throw new PiModelResolutionError(
                'oauth_endpoint_not_allowed',
                'OAuth providers cannot use a custom endpoint'
            );
        }
        if (api !== definition.oauth.api) {
            throw new PiModelResolutionError(
                'oauth_api_mismatch',
                `OAuth for ${definition.key} requires API ${definition.oauth.api}`
            );
        }
    } else if (requestedEndpoint && !definition.allowCustomEndpoint) {
        throw new PiModelResolutionError(
            'custom_endpoint_not_allowed',
            `Provider ${definition.key} does not allow a custom endpoint`
        );
    }

    let endpoint: string;
    const defaultEndpoint = getPiProviderApiBaseUrl(definition, api as PiWireApi);
    try {
        endpoint = requestedEndpoint
            ? normalizePiApiBaseEndpoint(api as PiWireApi, requestedEndpoint)
            : defaultEndpoint;
    } catch (error) {
        if (error instanceof PiEndpointValidationError) {
            throw new PiModelResolutionError('invalid_endpoint', error.message);
        }
        throw error;
    }
    const usesDefaultEndpoint = endpoint === normalizePiEndpoint(defaultEndpoint);
    const modelId = requiredString(input.piConfig, 'model', 'missing_model', 'More source model');
    const manualContextWindow = validateNonNegativeInteger(
        input.piConfig.contextWindow,
        'More source contextWindow'
    );
    const configuredMaxTokens = validatePositiveInteger(input.maxTokens, 'maximum reply tokens');
    const catalogModelById = findCatalogModel(definition, modelId);
    const catalogModelMatchesApi =
        catalogModelById !== undefined &&
        isPiCatalogModelApiCompatible(definition, catalogModelById, api as PiWireApi);
    if (catalogModelById && !catalogModelMatchesApi && usesDefaultEndpoint) {
        throw new PiModelResolutionError(
            'unsupported_api',
            `Model ${modelId} is registered for ${catalogModelById.api}, not ${api}`
        );
    }
    // On a custom OpenAI-compatible endpoint the same identifier may refer to an entirely
    // different model. Require manual metadata and treat it as dynamic instead of replaying
    // catalog metadata from another wire API.
    const catalogModel =
        catalogModelMatchesApi && usesDefaultEndpoint ? catalogModelById : undefined;

    if (!catalogModel && manualContextWindow === 0) {
        throw new PiModelResolutionError(
            'missing_context_window',
            `Model ${modelId} is not in the ${definition.key} catalog; contextWindow is required`
        );
    }

    const effectiveContextWindow =
        manualContextWindow > 0 ? manualContextWindow : catalogModel!.contextWindow;
    if (!Number.isInteger(effectiveContextWindow) || effectiveContextWindow <= 0) {
        throw new PiModelResolutionError(
            'invalid_context_window',
            'effective contextWindow must be a positive integer'
        );
    }
    if (configuredMaxTokens > effectiveContextWindow) {
        throw new PiModelResolutionError(
            'max_tokens_exceed_context',
            'maximum reply tokens must not exceed contextWindow'
        );
    }

    const effectiveMaxTokens = catalogModel
        ? Math.min(configuredMaxTokens, catalogModel.maxTokens)
        : configuredMaxTokens;

    let apiKey: string | undefined;
    if (authType === 'api_key') {
        if (typeof input.apiKey !== 'string' || input.apiKey.trim() === '') {
            throw new PiModelResolutionError(
                'missing_api_key',
                `An API key is required for ${definition.key}`
            );
        }
        apiKey = input.apiKey;
    }

    return {
        definition,
        provider: definition.providerId,
        api: api as PiWireApi,
        authType: authType as PiAuthType,
        endpoint,
        modelId,
        manualContextWindow,
        configuredMaxTokens,
        apiKey,
        catalogModel,
        effectiveContextWindow,
        effectiveMaxTokens,
    };
}

function createDynamicModel(configuration: ValidatedPiConfiguration): Model<Api> {
    return {
        id: configuration.modelId,
        name: configuration.modelId,
        api: configuration.api,
        provider: configuration.provider,
        baseUrl: configuration.endpoint,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: configuration.effectiveContextWindow,
        maxTokens: configuration.effectiveMaxTokens,
    };
}

function cloneCatalogModel(configuration: ValidatedPiConfiguration): Model<Api> {
    const original = configuration.catalogModel!;
    const model = structuredClone(original) as Model<Api>;

    model.api = configuration.api;
    model.provider = configuration.provider;
    model.baseUrl = configuration.endpoint;
    model.contextWindow = configuration.effectiveContextWindow;
    model.maxTokens = configuration.effectiveMaxTokens;

    // Compatibility metadata is API-shaped. Do not replay Responses flags into Completions.
    if (original.api !== configuration.api) {
        delete model.compat;
    }
    return model;
}

export function resolvePiModel(input: ResolvePiModelInput): ResolvedPiModel {
    const configuration = validatePiConfiguration(input);
    const catalogHit = configuration.catalogModel !== undefined;
    return {
        definition: configuration.definition,
        model: catalogHit ? cloneCatalogModel(configuration) : createDynamicModel(configuration),
        catalogHit,
        effectiveContextWindow: configuration.effectiveContextWindow,
        effectiveMaxTokens: configuration.effectiveMaxTokens,
        authType: configuration.authType,
        apiKey: configuration.apiKey,
    };
}

/** Convenience adapter for the persisted Chinese-keyed extra-model settings object. */
export function resolvePiModelFromExtraModelSettings(settings: unknown): ResolvedPiModel {
    if (!isRecord(settings)) {
        throw new PiModelResolutionError(
            'invalid_config',
            'extra-model settings must be an object'
        );
    }
    return resolvePiModel({
        piConfig: settings.pi,
        maxTokens: settings['最大回复token数'],
        apiKey: settings['密钥'],
    });
}
