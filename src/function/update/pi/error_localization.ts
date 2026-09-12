import { tr, type MessageKey, type TranslationParams } from '@/i18n';

const PI_ERROR_LOCALIZED = Symbol('mvu.pi.error.localized');

/** 各 Pi 层错误的最小公共形状，避免本地化模块依赖所有具体错误类。 */
type PiErrorLike = Error & {
    code?: unknown;
    /** 原始酒馆消息的位置，供错误提示定位上下文。 */
    sourceIndex?: unknown;
    /** 标记已处理的错误，防止重复翻译覆盖原有错误信息。 */
    [PI_ERROR_LOCALIZED]?: true;
};

/** 错误对应的翻译键及插值参数，交由当前界面语言统一渲染。 */
type LocalizedPiError = {
    key: MessageKey;
    params?: TranslationParams;
};

const MODEL_RESOLUTION_KEYS = {
    invalid_config: 'runtime.pi.invalidConfig',
    unknown_provider: 'runtime.pi.unknownProvider',
    unsupported_api: 'runtime.pi.unsupportedApi',
    unsupported_auth: 'runtime.pi.unsupportedAuth',
    missing_api_key: 'runtime.pi.missingApiKey',
    invalid_endpoint: 'runtime.pi.invalidEndpoint',
    custom_endpoint_not_allowed: 'runtime.pi.customEndpointNotAllowed',
    oauth_endpoint_not_allowed: 'runtime.pi.oauthEndpointNotAllowed',
    oauth_api_mismatch: 'runtime.pi.oauthApiMismatch',
    missing_model: 'runtime.pi.missingModel',
    invalid_context_window: 'runtime.pi.invalidContextWindow',
    missing_context_window: 'runtime.pi.missingContextWindow',
    invalid_max_tokens: 'runtime.pi.invalidMaxTokens',
    max_tokens_exceed_context: 'runtime.pi.maxTokensExceedContext',
} as const satisfies Record<string, MessageKey>;

const OAUTH_KEYS = {
    missing_credential: 'runtime.pi.missingOAuthCredential',
    cancelled: 'runtime.pi.oauth.cancelled',
    browser_unavailable: 'runtime.pi.oauth.browserUnavailable',
    unsupported_provider: 'runtime.pi.oauth.unsupportedProvider',
    invalid_callback: 'runtime.pi.oauth.invalidCallback',
    state_mismatch: 'runtime.pi.oauth.stateMismatch',
    authorization_failed: 'runtime.pi.oauth.authorizationFailed',
    browser_network: 'runtime.pi.oauth.browserNetwork',
    token_http: 'runtime.pi.oauth.tokenHttp',
    token_response: 'runtime.pi.oauth.tokenResponse',
    account_id: 'runtime.pi.oauth.accountId',
    attempt_expired: 'runtime.pi.oauth.attemptExpired',
    attempt_used: 'runtime.pi.oauth.attemptUsed',
    credential_store: 'runtime.pi.oauth.credentialStore',
} as const satisfies Record<string, MessageKey>;

/** 收窄为 Error 对象，供错误码和本地化标记读取使用。 */
function isError(value: unknown): value is PiErrorLike {
    return value instanceof Error;
}

/** 读取字符串错误码，未知类型返回空值以进入通用错误分支。 */
function codeOf(error: PiErrorLike): string {
    return typeof error.code === 'string' ? error.code : '';
}

/** 读取可用于提示词定位的整数下标，缺失时使用问号占位。 */
function sourceIndexOf(error: PiErrorLike): number | string {
    return typeof error.sourceIndex === 'number' && Number.isInteger(error.sourceIndex)
        ? error.sourceIndex
        : '?';
}

/** 判断内部错误描述是否匹配任一已知类别，用于选择固定的翻译文案。 */
function contains(message: string, ...patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(message));
}

/** 将上下文转换错误映射为本地化消息，必要时附带原始消息下标。 */
function contextError(error: PiErrorLike, code = codeOf(error)): LocalizedPiError {
    const index = sourceIndexOf(error);
    switch (code) {
        case 'empty-content':
            return { key: 'runtime.pi.contextEmptyContent', params: { index } };
        case 'invalid-image':
            return { key: 'runtime.pi.contextInvalidImage' };
        case 'invalid-tool-call':
            return { key: 'runtime.pi.invalidToolCall' };
        case 'late-system':
            return { key: 'runtime.pi.contextLateSystem', params: { index } };
        case 'system-role-unsupported':
            return { key: 'runtime.pi.contextSystemRoleUnsupported', params: { index } };
        case 'system-placement':
            return { key: 'runtime.pi.contextSystemPlacement', params: { index } };
        case 'system-payload-mismatch':
            return { key: 'runtime.pi.contextSystemPayloadMismatch' };
        case 'missing-tool-call':
            return { key: 'runtime.pi.contextMissingToolCall', params: { index } };
        case 'missing-user-for-system':
            return { key: 'runtime.pi.contextMissingUserForSystem', params: { index } };
        case 'unsupported-content':
            if (contains(error.message, /remote image|远程图片/i)) {
                return { key: 'runtime.pi.remoteImageUnsupported' };
            }
            if (contains(error.message, /video|视频/i)) {
                return { key: 'runtime.pi.videoUnsupported' };
            }
            return { key: 'runtime.pi.contextUnsupportedContent', params: { index } };
        default:
            return { key: 'runtime.pi.contextUnsupportedContent', params: { index } };
    }
}

/** 从运行时包装后的提示词错误中恢复内容类别和可用的定位信息。 */
function runtimeInvalidPrompt(error: PiErrorLike): LocalizedPiError {
    const indexMatch = /(?:message|第)\s*(\d+)/i.exec(error.message);
    const sourceIndex = indexMatch ? Number(indexMatch[1]) : '?';
    const message = error.message;
    if (contains(message, /remote image|远程图片/i)) {
        return { key: 'runtime.pi.remoteImageUnsupported' };
    }
    if (contains(message, /video|视频/i)) {
        return { key: 'runtime.pi.videoUnsupported' };
    }
    if (contains(message, /base64|mime|图片/i)) {
        return { key: 'runtime.pi.contextInvalidImage' };
    }
    if (contains(message, /empty|为空/i)) {
        return { key: 'runtime.pi.contextEmptyContent', params: { index: sourceIndex } };
    }
    if (contains(message, /late[ -]?system|对话开始后.*system/i)) {
        return { key: 'runtime.pi.contextLateSystem', params: { index: sourceIndex } };
    }
    if (contains(message, /missing user|没有可附着.*user/i)) {
        return {
            key: 'runtime.pi.contextMissingUserForSystem',
            params: { index: sourceIndex },
        };
    }
    if (contains(message, /tool_call_id|missing tool|找不到对应.*工具|工具.*缺少/i)) {
        return { key: 'runtime.pi.contextMissingToolCall', params: { index: sourceIndex } };
    }
    if (contains(message, /tool|工具/i)) {
        return { key: 'runtime.pi.invalidToolCall' };
    }
    return { key: 'runtime.pi.contextUnsupportedContent', params: { index: sourceIndex } };
}

/** 细分采样、请求覆盖和工具配置错误，选择对应的可操作提示。 */
function runtimeInvalidConfiguration(error: PiErrorLike): LocalizedPiError {
    const message = error.message;
    if (contains(message, /Anthropic sampling/i)) {
        return { key: 'runtime.pi.anthropicSamplingConflict' };
    }
    if (contains(message, /customheaders/i)) {
        return { key: 'runtime.pi.customHeadersInvalid' };
    }
    if (contains(message, /customincludebody/i)) {
        return contains(message, /valid yaml|valid json/i)
            ? { key: 'runtime.pi.customConfigParseFailed' }
            : { key: 'runtime.pi.customIncludeBodyInvalid' };
    }
    if (contains(message, /customexcludebody/i)) {
        return contains(message, /valid yaml|valid json/i)
            ? { key: 'runtime.pi.customConfigParseFailed' }
            : { key: 'runtime.pi.customExcludeBodyInvalid' };
    }
    if (contains(message, /protected field|authentication header/i)) {
        return { key: 'runtime.pi.customPayloadProtectedField' };
    }
    if (contains(message, /payload must be an object/i)) {
        return { key: 'runtime.pi.payloadInvalid' };
    }
    if (contains(message, /structured output.*json schema/i)) {
        return { key: 'runtime.pi.structuredOutputSchemaMissing' };
    }
    if (contains(message, /named tool choice/i)) {
        return { key: 'runtime.pi.namedToolChoiceUnsupported' };
    }
    if (contains(message, /tool definition|工具定义|schema.*根节点/i)) {
        return { key: 'runtime.pi.invalidToolDefinition' };
    }
    return { key: 'runtime.pi.invalidConfig' };
}

/** 区分工具调用、结构化输出等能力限制，避免所有预检失败共用模糊提示。 */
function runtimeUnsupportedCapability(error: PiErrorLike): LocalizedPiError {
    if (contains(error.message, /named tool/i)) {
        return { key: 'runtime.pi.namedToolChoiceUnsupported' };
    }
    if (contains(error.message, /tool/i)) {
        return { key: 'runtime.pi.toolCallingUnsupported' };
    }
    if (contains(error.message, /structured|json/i)) {
        return { key: 'runtime.pi.structuredOutputUnsupported' };
    }
    return { key: 'runtime.pi.invalidConfig' };
}

/** 从本地预算错误中提取输入、输出和预留 token 数，形成可解释的超限提示。 */
function tokenBudgetError(error: PiErrorLike): LocalizedPiError {
    const details =
        /estimated\s+(\d+)\s+input tokens,\s*limit\s+(\d+)\s+after reserving\s+(\d+)\s+reply tokens\s+and\s+(\d+)\s+safety tokens/i.exec(
            error.message
        );
    if (!details) {
        return { key: 'runtime.pi.invalidConfig' };
    }
    const [, estimatedInput, maxInput, maxTokens, reserve] = details.map(Number);
    return {
        key: 'runtime.pi.tokenBudgetExceeded',
        params: {
            estimatedInput,
            maxTokens,
            reserve,
            contextWindow: maxInput + maxTokens + reserve,
        },
    };
}

/** 将延迟应答、截断、空结果和无效工具调用归类为明确的协议错误。 */
function runtimeProtocolError(error: PiErrorLike): LocalizedPiError {
    if (contains(error.message, /deferred/i)) {
        return { key: 'runtime.pi.deferredResponse' };
    }
    if (contains(error.message, /truncated|output limit|length/i)) {
        return { key: 'runtime.pi.lengthTruncated' };
    }
    if (contains(error.message, /invalid tool/i)) {
        return { key: 'runtime.pi.invalidToolCall' };
    }
    if (contains(error.message, /no usable|empty/i)) {
        return { key: 'runtime.pi.emptyResponse' };
    }
    return { key: 'runtime.pi.protocolError' };
}

/** 按运行时错误码分派本地化逻辑，保持网络、配置和协议错误的区别。 */
function runtimeError(error: PiErrorLike): LocalizedPiError {
    switch (codeOf(error)) {
        case 'invalid_configuration':
            return runtimeInvalidConfiguration(error);
        case 'invalid_prompt':
            return runtimeInvalidPrompt(error);
        case 'missing_oauth_credential':
            return { key: 'runtime.pi.missingOAuthCredential' };
        case 'request_already_active':
            return { key: 'runtime.pi.requestAlreadyActive' };
        case 'unsupported_capability':
            return runtimeUnsupportedCapability(error);
        case 'unsupported_image_input':
            return { key: 'runtime.pi.imageInputUnsupported' };
        case 'token_budget':
            return tokenBudgetError(error);
        case 'network':
            return { key: 'runtime.pi.browserNetworkError' };
        case 'proxy_unavailable':
            return { key: 'runtime.pi.proxyUnavailable' };
        case 'provider':
            return { key: 'runtime.pi.requestFailed' };
        case 'protocol':
            return runtimeProtocolError(error);
        default:
            return { key: 'runtime.pi.requestFailed' };
    }
}

/** 将 Pi 结果转换失败映射为固定文案，包括仅有思考内容或缺失工具调用的情况。 */
function resultError(error: PiErrorLike): LocalizedPiError {
    switch (codeOf(error)) {
        case 'aborted':
            return { key: 'runtime.pi.requestAborted' };
        case 'deferred':
            return { key: 'runtime.pi.deferredResponse' };
        case 'empty-response':
            return contains(error.message, /thinking/i)
                ? { key: 'runtime.pi.thinkingOnlyResponse' }
                : { key: 'runtime.pi.emptyResponse' };
        case 'invalid-tool-call':
            return contains(error.message, /tooluse|tool use|以.*工具调用结束/i)
                ? { key: 'runtime.pi.toolUseMissingCall' }
                : { key: 'runtime.pi.invalidToolCall' };
        case 'length':
            return { key: 'runtime.pi.lengthTruncated' };
        case 'network':
            return { key: 'runtime.pi.browserNetworkError' };
        case 'provider-error':
            return { key: 'runtime.pi.requestFailed' };
        default:
            return { key: 'runtime.pi.protocolError' };
    }
}

/** 只识别本模块支持的 Pi 错误类型；未知或非 Pi 错误交由调用方处理。 */
function classifyPiError(error: PiErrorLike): LocalizedPiError | undefined {
    switch (error.name) {
        case 'PiModelResolutionError':
            return {
                key:
                    MODEL_RESOLUTION_KEYS[codeOf(error) as keyof typeof MODEL_RESOLUTION_KEYS] ??
                    'runtime.pi.invalidConfig',
            };
        case 'PiRuntimeError':
            return runtimeError(error);
        case 'PiContextAdapterError':
            return contextError(error);
        case 'PiResultAdapterError':
            return resultError(error);
        case 'PiRequestAbortedError':
            return { key: 'runtime.pi.requestAborted' };
        case 'PiOAuthError':
            return {
                key:
                    OAUTH_KEYS[codeOf(error) as keyof typeof OAUTH_KEYS] ??
                    'runtime.pi.oauth.authorizationFailed',
            };
        case 'PiProxyUnavailableError':
            return { key: 'runtime.pi.proxyUnavailable' };
        default:
            return undefined;
    }
}

/**
 * 原位替换错误消息和堆栈，并标记已本地化。
 * 堆栈也可能包含上游响应或凭证，不能仅替换 message。
 */
function replaceErrorText(error: PiErrorLike, message: string): PiErrorLike {
    Object.defineProperty(error, 'message', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: message,
    });
    // Error stacks embed the message captured at construction time. Replacing only `message`
    // would still leak an upstream response body/API key when the error is logged.
    Object.defineProperty(error, 'stack', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: `${error.name}: ${message}`,
    });
    Object.defineProperty(error, PI_ERROR_LOCALIZED, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: true,
    });
    return error;
}

/** 检查错误是否已经处理，避免重复翻译改变分类依据。 */
function isLocalizedPiError(error: PiErrorLike): boolean {
    return error[PI_ERROR_LOCALIZED] === true;
}

/**
 * 原位本地化已知 Pi 错误，保留 instanceof、错误码、重试和取消语义。
 * 未知或非 Pi 错误保持原值返回。
 */
export function localizePiError(error: unknown): unknown {
    if (!isError(error)) {
        return error;
    }
    if (isLocalizedPiError(error)) {
        return error;
    }
    const localized = classifyPiError(error);
    return localized ? replaceErrorText(error, tr(localized.key, localized.params)) : error;
}

/** 取得可供界面展示的 Pi 错误文案；无法识别时返回通用提示，不暴露上游文本。 */
export function getLocalizedPiErrorMessage(error: unknown): string {
    const localized = localizePiError(error);
    return isError(localized) && isLocalizedPiError(localized)
        ? localized.message
        : tr('runtime.pi.requestFailed');
}

/**
 * 结合本轮应答格式生成安全的失败提示。
 * 服务商拒绝请求只能说明本次请求未被接受，不能据此断言该端点不支持对应能力。
 */
export function getPiRequestFailureToastMessage(error: unknown, responseFormat: string): string {
    const localized = localizePiError(error);
    if (
        isError(localized) &&
        localized.name === 'PiRuntimeError' &&
        codeOf(localized) === 'provider'
    ) {
        switch (responseFormat) {
            case '工具调用':
                return tr('runtime.pi.toolRequestRejected');
            case '格式化输出':
                return tr('runtime.pi.structuredOutputRequestRejected');
            case '格式化输出(v4兼容)':
                return tr('runtime.pi.jsonObjectRequestRejected');
        }
    }
    return getLocalizedPiErrorMessage(localized);
}
