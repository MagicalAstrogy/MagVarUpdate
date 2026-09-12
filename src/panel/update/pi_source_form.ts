import type { Api, Model } from '@/function/update/pi/pi_gateway';
import { isPiDefaultProviderEndpoint } from '@/function/update/pi/model_resolver';
import {
    getPiProviderApiBaseUrl,
    normalizePiApiBaseEndpoint,
    resolvePiApiKeyScope,
} from '@/function/update/pi/provider_target';
import {
    resolvePiCapabilities,
    type PiApiCapabilities,
    type PiAuthType,
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

export type PiSourceChoice = PiSourceSelection & {
    provider: string;
};

/** 生成仅供界面选择使用的组合标识，持久化仍保存原始服务商、协议和认证字段。 */
export function getPiSourceChoiceValue(choice: {
    provider: string;
    api: string;
    authType: string;
}): string {
    return JSON.stringify([choice.provider, choice.api, choice.authType]);
}

/** 展开服务商实际支持的组合，并将账号登录固定到其要求的协议。 */
export function listPiSourceChoices(definition: PiProviderDefinition): PiSourceChoice[] {
    return definition.allowedAuthTypes.flatMap(authType => {
        const apis = authType === 'oauth' ? [definition.oauth?.api] : definition.allowedApis;
        return apis
            .filter((api): api is PiWireApi => !!api && definition.allowedApis.includes(api))
            .map(api => ({ provider: definition.key, api, authType }));
    });
}

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
 * 将共享密钥输入值转存至原目标缓存，再恢复新目标对应的密钥。
 * OAuth、非活动来源和无效目标的活动密钥为空，防止凭证跨端点流转。
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

/** 规范化请求覆盖所属的目标标识；无效地址单独编码，不能被误认为有效默认地址。 */
export function resolvePiRequestTargetIdentity(
    definition: PiProviderDefinition | undefined,
    provider: string,
    api: string,
    auth_type: string,
    endpoint: string
): string {
    const requested_endpoint =
        endpoint.trim() === '' && definition
            ? getPiProviderApiBaseUrl(definition, api as PiWireApi)
            : endpoint.trim();
    let endpoint_identity: string;
    try {
        endpoint_identity = normalizePiApiBaseEndpoint(api as PiWireApi, requested_endpoint);
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

/** 目标相同时保留请求覆盖，目标变化时清空自定义请求头及正文增删字段。 */
export function transitionPiRequestOverrides(
    previous_target: string,
    next_target: string,
    overrides: PiRequestOverrides
): PiRequestOverrides {
    return previous_target === next_target
        ? { ...overrides }
        : { customHeaders: '', customIncludeBody: '', customExcludeBody: '' };
}

/** 核对确认前捕获的界面代次、服务商和方案，避免异步操作作用于用户新选中的连接。 */
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

/** 将协议和认证选项校正到服务商支持的组合，OAuth 优先使用其专属协议。 */
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

/** 仅在允许自定义地址的 API Key 来源保留端点，其他来源清空。 */
export function resolvePiEndpointSelection(
    definition: PiProviderDefinition,
    auth_type: PiAuthType,
    endpoint: string
): string {
    return definition.allowCustomEndpoint && auth_type === 'api_key' ? endpoint : '';
}

/** 判断当前端点是否可继承固定目录的模型能力，避免将官方元数据套用到自定义服务。 */
export function isPiEndpointCatalogCompatible(
    definition: PiProviderDefinition,
    endpoint: string,
    api: PiWireApi = definition.defaultApi
): boolean {
    return isPiDefaultProviderEndpoint(definition, endpoint, api);
}

/** 按端点兼容性筛选目录元数据，再解析界面应展示和启用的模型能力。 */
export function resolvePiSourceCapabilities(
    definition: PiProviderDefinition,
    api: PiWireApi,
    endpoint: string,
    catalog_model?: Model<Api>
): Readonly<PiApiCapabilities> | undefined {
    const effective_catalog_model = isPiEndpointCatalogCompatible(definition, endpoint, api)
        ? catalog_model
        : undefined;
    return resolvePiCapabilities(definition, api, {
        model: effective_catalog_model,
        catalogHit: effective_catalog_model !== undefined,
    });
}

/** 按完整模型标识查找目录项，不对未知名称推断能力。 */
export function findPiCatalogModel(
    models: readonly Model<Api>[],
    model_id: string
): Model<Api> | undefined {
    return models.find(model => model.id === model_id);
}

/** 仅在配置为数值 0 时采用有效目录窗口；其他无效输入统一返回未解析状态。 */
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

/** 按与运行时相同的端点及目录规则计算界面的有效上下文窗口。 */
export function resolvePiSourceContextWindow(
    definition: PiProviderDefinition,
    api: PiWireApi,
    endpoint: string,
    configured_context_window: unknown,
    catalog_model?: Model<Api>
): number {
    return resolvePiContextWindow(
        configured_context_window,
        isPiEndpointCatalogCompatible(definition, endpoint, api)
            ? catalog_model?.contextWindow
            : undefined
    );
}

export const PI_INVALID_CONTEXT_WINDOW_INPUT = '__invalid_context_window__';

/** 区分空输入、有效正整数和无效输入，避免浏览器输入异常被当作使用目录默认值。 */
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

/** 汇总窗口与回复 token 的整数和大小关系错误，供表单同时展示问题。 */
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
