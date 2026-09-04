import { tr, type MessageKey, type TranslationParams } from '@/i18n';

const PI_ERROR_LOCALIZED = Symbol('mvu.pi.error.localized');

type PiErrorLike = Error & {
    code?: unknown;
    sourceIndex?: unknown;
    [PI_ERROR_LOCALIZED]?: true;
};

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

function isError(value: unknown): value is PiErrorLike {
    return value instanceof Error;
}

function codeOf(error: PiErrorLike): string {
    return typeof error.code === 'string' ? error.code : '';
}

function sourceIndexOf(error: PiErrorLike): number | string {
    return typeof error.sourceIndex === 'number' && Number.isInteger(error.sourceIndex)
        ? error.sourceIndex
        : '?';
}

function contains(message: string, ...patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(message));
}

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

function isLocalizedPiError(error: PiErrorLike): boolean {
    return error[PI_ERROR_LOCALIZED] === true;
}

/**
 * Localize a known Pi error in place so `instanceof`, `code`, `retryable`, and cancellation
 * metadata keep their original semantics. Unknown/non-Pi failures are returned unchanged.
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

/**
 * UI-safe Pi error text. Unlike a generic `getErrorMessage`, this never returns upstream text.
 */
export function getLocalizedPiErrorMessage(error: unknown): string {
    const localized = localizePiError(error);
    return isError(localized) && isLocalizedPiError(localized)
        ? localized.message
        : tr('runtime.pi.requestFailed');
}

/**
 * Build the UI message for a failed More-source request without exposing provider response text.
 * A provider-level failure cannot prove why an endpoint rejected the request, so capability modes
 * use an actionable "did not accept" hint instead of claiming unsupported capability as fact.
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
