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

/** 设置中保存的 Pi 连接与模型选择，字符串取值仍需通过注册表校验。 */
export interface PiModelConfiguration {
    provider: string;
    api: string;
    authType: string;
    endpoint?: string;
    model: string;
    /** 0 或未填写表示使用目录窗口；正值覆盖目录，目录外模型必须显式填写。 */
    contextWindow?: number;
}

/** 模型解析边界的原始输入，接受 unknown 以校验旧设置和外部调用。 */
export interface ResolvePiModelInput {
    piConfig: PiModelConfiguration | unknown;
    /** 用户配置的最大回复 token 数，尚未应用模型目录的输出上限。 */
    maxTokens: number | unknown;
    apiKey?: string | unknown;
}

/** 连接、认证和模型预算校验的失败分类，供预检及本地化提示使用。 */
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
    /** 保留模型配置错误码，供预检和界面给出稳定的错误分类。 */
    constructor(
        public readonly code: PiModelResolutionErrorCode,
        message: string
    ) {
        super(message);
        this.name = 'PiModelResolutionError';
    }
}

/** 校验并规范化后的连接配置，保留目录依据与最终预算，供构造本次 Pi Model 使用。 */
export interface ValidatedPiConfiguration {
    definition: PiProviderDefinition;
    provider: PiProviderKey;
    api: PiWireApi;
    authType: PiAuthType;
    endpoint: string;
    modelId: string;
    /** 用户显式窗口；0 表示采用匹配目录项的上下文窗口。 */
    manualContextWindow: number;
    configuredMaxTokens: number;
    apiKey?: string;
    /** 仅在默认端点且协议兼容时使用，避免套用自定义端点的同名模型。 */
    catalogModel?: Model<Api>;
    effectiveContextWindow: number;
    /** 用户回复额度与适用目录输出上限的较小值。 */
    effectiveMaxTokens: number;
}

/** 交给运行时的模型解析结果，model 是本次请求独立的目录副本或动态元数据。 */
export interface ResolvedPiModel {
    definition: PiProviderDefinition;
    model: Model<Api>;
    /** 是否实际采用了匹配目录的元数据，而非仅命中同名模型。 */
    catalogHit: boolean;
    effectiveContextWindow: number;
    effectiveMaxTokens: number;
    authType: PiAuthType;
    apiKey?: string;
}

/** 判断输入是否为可读取配置字段的非空、非数组对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 读取并规范必填字符串，缺失时抛出指定的模型配置错误。 */
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

/** 规范自定义端点并执行浏览器传输限制，将端点错误转换为模型配置错误。 */
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

/** 判断端点是否等同服务商的协议默认地址，空值与显式填写默认地址视为相同。 */
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

/** 校验允许 0 哨兵值的配置整数，拒绝无效值隐式回退。 */
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

/** 校验必须大于 0 的配置整数，供回复 token 等硬性预算使用。 */
function validatePositiveInteger(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new PiModelResolutionError(
            'invalid_max_tokens',
            `${field} must be a positive integer`
        );
    }
    return value;
}

/** 从所选服务商目录中查找模型，并检查目录项与当前协议是否兼容。 */
function findCatalogModel(
    definition: PiProviderDefinition,
    modelId: string
): Model<Api> | undefined {
    return getPiCatalogModels(definition.key).find(model => model.id === modelId);
}

/**
 * 校验服务商、协议、认证、端点、模型和 token 参数的组合。
 * 只使用适用于当前端点的目录元数据，不修改设置或共享目录对象。
 */
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
        apiKey = input.apiKey.trim();
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

/** 为目录外或自定义端点模型构造独立元数据，使用显式窗口与保守能力默认值。 */
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

/** 复制目录模型后应用本次端点和预算，防止请求修改共享目录元数据。 */
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

/** 在配置校验后选择目录模型或动态模型，并返回本次请求的有效预算及认证信息。 */
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

/** 从中文字段的额外模型设置中提取 Pi 连接和回复预算，再调用统一模型解析。 */
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
