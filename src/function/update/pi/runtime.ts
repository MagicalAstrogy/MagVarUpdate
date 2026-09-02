import type { MvuSettings } from '@/store';
import { installPiAbortSignalPolyfills } from './abort_signal';
import {
    parsePiCustomExcludeBody,
    parsePiCustomHeaders,
    parsePiCustomIncludeBody,
} from './config_parser';
import { PiContextAdapterError, toPiContext, type ToPiContextOptions } from './context_adapter';
import { PiRequestAbortedError, registerPiRequestController } from './controller_registry';
import { getPiCredentialStore } from './credential_store';
import {
    PiModelResolutionError,
    resolvePiModelFromExtraModelSettings,
    type ResolvedPiModel,
} from './model_resolver';
import { getBrowserOAuthAuth } from './oauth';
import { createPiPayloadTransform, transformPiPayload, type PiJsonSchema } from './payload';
import {
    createModels,
    createProvider,
    type Api,
    type ApiStreamOptions,
    type AssistantMessageEvent,
    type AuthContext,
    type CredentialStore,
    type FetchFunction,
    type ProviderAuth,
    type ProviderHeaders,
    type Tool,
} from './pi_gateway';
import {
    createPiApiImplementations,
    resolvePiCapabilities,
    type PiApiCapabilities,
    type PiWireApi,
} from './provider_registry';
import { fromPiAssistantMessage, PiResultAdapterError, toPiToolDefinition } from './result_adapter';
import { assertPiTokenBudget } from './token_preflight';
import { resolvePiToolChoice, type MvuToolChoice } from './tool_choice';

installPiAbortSignalPolyfills();

export const PI_RUNTIME_RESPONSE_FORMATS = [
    '聊天消息',
    '工具调用',
    '格式化输出',
    '格式化输出(v4兼容)',
] as const;

export type PiRuntimeResponseFormat = (typeof PI_RUNTIME_RESPONSE_FORMATS)[number];
export type PiExtraModelSettings = MvuSettings['额外模型解析配置'];

export type PiRuntimeErrorCode =
    | 'invalid_configuration'
    | 'invalid_prompt'
    | 'missing_oauth_credential'
    | 'request_already_active'
    | 'unsupported_capability'
    | 'unsupported_image_input'
    | 'token_budget'
    | 'network'
    | 'provider'
    | 'protocol';

export class PiRuntimeError extends Error {
    constructor(
        readonly code: PiRuntimeErrorCode,
        message: string,
        readonly retryable = false
    ) {
        super(message);
        this.name = 'PiRuntimeError';
    }
}

/** Stable retry boundary used by the serial/concurrent extra-model strategies. */
export function isNonRetryablePiRuntimeError(error: unknown): boolean {
    return (
        (error instanceof PiRuntimeError && !error.retryable) ||
        error instanceof PiModelResolutionError ||
        error instanceof PiContextAdapterError
    );
}

export type PiRuntimeSampling = Readonly<{
    topP?: number;
    topK?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
}>;

export interface AssertPiRuntimeConfigurationInput {
    /** The whole persisted `额外模型解析配置` object. */
    settings: unknown;
    /** Defaults to `settings.应答格式`. */
    responseFormat?: unknown;
    /** Required by `格式化输出`; ignored by non-structured response modes. */
    jsonSchema?: PiJsonSchema;
    /** Required by `工具调用`; the MVU ToolDefinition constants can be passed directly. */
    tools?: readonly ToolDefinition[];
    /** Defaults to `required` in tool mode. */
    toolChoice?: MvuToolChoice;
    credentialStore?: CredentialStore;
    fetch?: FetchFunction;
    signal?: AbortSignal;
}

/**
 * Immutable request configuration resolved before a retry strategy starts.
 * It deliberately contains no prompt/messages, so callers can reuse it for every attempt.
 */
export interface PiRuntimePreflight {
    readonly resolution: ResolvedPiModel;
    readonly responseFormat: PiRuntimeResponseFormat;
    readonly capabilities: Readonly<PiApiCapabilities>;
    readonly headers?: Readonly<ProviderHeaders>;
    readonly customIncludeBody?: Readonly<Record<string, unknown>>;
    readonly customExcludeBody?: readonly string[];
    readonly temperature?: number;
    readonly sampling: PiRuntimeSampling;
    readonly tools?: readonly Tool[];
    readonly toolChoice?: unknown;
    readonly jsonSchema?: PiJsonSchema;
    readonly credentialStore: CredentialStore;
    readonly fetch?: FetchFunction;
}

export type PiRuntimeProgressCallback = (event: AssistantMessageEvent) => void | Promise<void>;

export interface RunPiRequestInput {
    /** Supply this when configuration was validated once outside the retry loop. */
    preflight?: PiRuntimePreflight;
    /** Required only when `preflight` is omitted. */
    settings?: unknown;
    responseFormat?: unknown;
    jsonSchema?: PiJsonSchema;
    tools?: readonly ToolDefinition[];
    toolChoice?: MvuToolChoice;
    credentialStore?: CredentialStore;
    fetch?: FetchFunction;
    messages: readonly SillyTavern.SendingMessage[];
    generationId: string;
    signal?: AbortSignal;
    onProgress?: PiRuntimeProgressCallback;
    contextOptions?: ToPiContextOptions;
}

type ExtraModelSettingsRecord = Record<string, unknown> & {
    pi?: unknown;
};

const BROWSER_AUTH_CONTEXT: AuthContext = Object.freeze({
    env: async () => undefined,
    fileExists: async () => false,
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireSettings(value: unknown): ExtraModelSettingsRecord {
    if (!isPlainObject(value)) {
        throw new PiRuntimeError(
            'invalid_configuration',
            'More source extra-model settings must be an object'
        );
    }
    return value;
}

function resolveResponseFormat(
    settings: ExtraModelSettingsRecord,
    override: unknown
): PiRuntimeResponseFormat {
    const value = override ?? settings['应答格式'];
    if (
        typeof value !== 'string' ||
        !PI_RUNTIME_RESPONSE_FORMATS.some(candidate => candidate === value)
    ) {
        throw new PiRuntimeError(
            'invalid_configuration',
            'More source response format is missing or unsupported'
        );
    }
    return value as PiRuntimeResponseFormat;
}

function optionalStringField(source: Record<string, unknown>, name: string): string {
    const value = source[name];
    if (value === undefined) {
        return '';
    }
    if (typeof value !== 'string') {
        throw new PiRuntimeError('invalid_configuration', `More source ${name} must be a string`);
    }
    return value;
}

function optionalNumberField(
    source: Record<string, unknown>,
    name: string,
    minimum: number,
    maximum: number,
    integer = false
): number | undefined {
    const value = source[name];
    if (value === undefined) {
        return undefined;
    }
    if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < minimum ||
        value > maximum ||
        (integer && !Number.isInteger(value))
    ) {
        const kind = integer ? 'integer' : 'number';
        throw new PiRuntimeError(
            'invalid_configuration',
            `More source ${name} must be a ${kind} between ${minimum} and ${maximum}`
        );
    }
    return value;
}

function resolveSampling(
    settings: ExtraModelSettingsRecord,
    capabilities: Readonly<PiApiCapabilities>
): {
    temperature?: number;
    sampling: PiRuntimeSampling;
} {
    const temperature = capabilities.temperature
        ? optionalNumberField(
              settings,
              '温度',
              capabilities.temperatureRange[0],
              capabilities.temperatureRange[1]
          )
        : undefined;
    const topP = capabilities.sampling.topP
        ? optionalNumberField(settings, 'top_p', 0, 1)
        : undefined;
    const topK = capabilities.sampling.topK
        ? optionalNumberField(settings, 'top_k', 0, 500, true)
        : undefined;
    const frequencyPenalty = capabilities.sampling.frequencyPenalty
        ? optionalNumberField(settings, '频率惩罚', -2, 2)
        : undefined;
    const presencePenalty = capabilities.sampling.presencePenalty
        ? optionalNumberField(settings, '存在惩罚', -2, 2)
        : undefined;
    return {
        temperature,
        sampling: Object.freeze({
            ...(topP === undefined ? {} : { topP }),
            // zero is the existing "unset" value and is invalid for APIs that send top_k.
            ...(topK === undefined || topK === 0 ? {} : { topK }),
            ...(frequencyPenalty === undefined ? {} : { frequencyPenalty }),
            ...(presencePenalty === undefined ? {} : { presencePenalty }),
        }),
    };
}

function cloneJsonSchema(schema: PiJsonSchema | undefined): PiJsonSchema | undefined {
    return schema === undefined ? undefined : structuredClone(schema);
}

function capabilityFor(resolution: ResolvedPiModel): Readonly<PiApiCapabilities> {
    const capability = resolvePiCapabilities(
        resolution.definition,
        resolution.model.api as PiWireApi,
        {
            model: resolution.model,
            catalogHit: resolution.catalogHit,
        }
    );
    if (!capability) {
        throw new PiRuntimeError(
            'invalid_configuration',
            `More source API '${resolution.model.api}' has no registered runtime capability metadata`
        );
    }
    return capability;
}

function assertResponseCapability(
    responseFormat: PiRuntimeResponseFormat,
    capabilities: Readonly<PiApiCapabilities>,
    api: Api
): void {
    if (responseFormat === '工具调用' && !capabilities.tools) {
        throw new PiRuntimeError(
            'unsupported_capability',
            `More source API '${api}' does not support tool calls`
        );
    }
    const structuredOutputUnsupported =
        responseFormat === '格式化输出' && !capabilities.structuredOutput;
    const jsonObjectOutputUnsupported =
        responseFormat === '格式化输出(v4兼容)' && !capabilities.jsonObjectOutput;
    if (structuredOutputUnsupported || jsonObjectOutputUnsupported) {
        throw new PiRuntimeError(
            'unsupported_capability',
            `More source API '${api}' does not support native structured output`
        );
    }
}

function prepareTools(
    responseFormat: PiRuntimeResponseFormat,
    definitions: readonly ToolDefinition[] | undefined
): readonly Tool[] | undefined {
    if (responseFormat !== '工具调用') {
        return undefined;
    }
    if (!definitions?.length) {
        throw new PiRuntimeError(
            'invalid_configuration',
            'More source tool-call mode requires at least one tool definition'
        );
    }
    return Object.freeze(
        definitions.map(definition =>
            toPiToolDefinition(definition, {
                constrainedSampling: { type: 'json_schema', strict: 'prefer' },
            })
        )
    );
}

function prepareJsonSchema(
    responseFormat: PiRuntimeResponseFormat,
    schema: PiJsonSchema | undefined
): PiJsonSchema | undefined {
    if (responseFormat === '格式化输出' && schema === undefined) {
        throw new PiRuntimeError(
            'invalid_configuration',
            'More source structured output requires a JSON schema'
        );
    }
    return responseFormat === '格式化输出' ? cloneJsonSchema(schema) : undefined;
}

function validatePayloadConfiguration(preflight: {
    resolution: ResolvedPiModel;
    responseFormat: PiRuntimeResponseFormat;
    customIncludeBody?: Readonly<Record<string, unknown>>;
    customExcludeBody?: readonly string[];
    sampling: PiRuntimeSampling;
    jsonSchema?: PiJsonSchema;
}): void {
    try {
        transformPiPayload(
            {},
            {
                api: preflight.resolution.model.api,
                responseFormat: nativeStructuredFormat(preflight.responseFormat),
                jsonSchema: preflight.jsonSchema,
                customIncludeBody:
                    preflight.customIncludeBody === undefined
                        ? undefined
                        : { ...preflight.customIncludeBody },
                customExcludeBody: preflight.customExcludeBody,
                sampling: preflight.sampling,
            }
        );
    } catch (error) {
        throw new PiRuntimeError(
            'invalid_configuration',
            error instanceof Error ? error.message : 'More source payload configuration is invalid'
        );
    }
}

async function assertOAuthCredential(
    resolution: ResolvedPiModel,
    credentialStore: CredentialStore,
    signal?: AbortSignal
): Promise<void> {
    if (resolution.authType !== 'oauth') {
        return;
    }
    signal?.throwIfAborted();
    const credential = await credentialStore.read(resolution.definition.providerId, { signal });
    signal?.throwIfAborted();
    if (!credential || credential.type !== 'oauth') {
        throw new PiRuntimeError(
            'missing_oauth_credential',
            `More source provider '${resolution.definition.providerId}' is not logged in`
        );
    }
}

/**
 * Validate everything that does not depend on a captured prompt. Call this once before entering
 * serial/concurrent retry logic so unsupported combinations are never retried as provider errors.
 */
export async function assertPiRuntimeConfiguration(
    input: AssertPiRuntimeConfigurationInput
): Promise<PiRuntimePreflight> {
    input.signal?.throwIfAborted();
    const settings = requireSettings(input.settings);
    const resolution = resolvePiModelFromExtraModelSettings(settings);
    const responseFormat = resolveResponseFormat(settings, input.responseFormat);
    const capabilities = capabilityFor(resolution);
    if (!capabilities.streaming) {
        throw new PiRuntimeError(
            'unsupported_capability',
            `More source model '${resolution.model.id}' does not support streaming requests`
        );
    }
    assertResponseCapability(responseFormat, capabilities, resolution.model.api);

    const piSettings = settings.pi;
    if (!isPlainObject(piSettings)) {
        throw new PiRuntimeError(
            'invalid_configuration',
            'More source connection settings must be an object'
        );
    }
    let headers: ProviderHeaders | undefined;
    let customIncludeBody: Record<string, unknown> | undefined;
    let customExcludeBody: string[] | undefined;
    try {
        headers = parsePiCustomHeaders(optionalStringField(piSettings, 'customHeaders'));
        customIncludeBody = parsePiCustomIncludeBody(
            optionalStringField(piSettings, 'customIncludeBody')
        );
        customExcludeBody = parsePiCustomExcludeBody(
            optionalStringField(piSettings, 'customExcludeBody')
        );
    } catch (error) {
        throw new PiRuntimeError(
            'invalid_configuration',
            error instanceof Error
                ? error.message
                : 'More source custom request configuration is invalid'
        );
    }
    const { temperature, sampling } = resolveSampling(settings, capabilities);
    let tools: readonly Tool[] | undefined;
    let toolChoice: unknown;
    try {
        tools = prepareTools(responseFormat, input.tools);
        toolChoice =
            responseFormat === '工具调用'
                ? resolvePiToolChoice(resolution.model.api, input.toolChoice ?? 'required')
                : undefined;
    } catch (error) {
        if (error instanceof PiRuntimeError) {
            throw error;
        }
        throw new PiRuntimeError(
            'invalid_configuration',
            error instanceof Error ? error.message : 'More source tool configuration is invalid'
        );
    }
    const jsonSchema = prepareJsonSchema(responseFormat, input.jsonSchema);
    const credentialStore = input.credentialStore ?? getPiCredentialStore();
    await assertOAuthCredential(resolution, credentialStore, input.signal);

    const preflight: PiRuntimePreflight = Object.freeze({
        resolution,
        responseFormat,
        capabilities,
        ...(headers === undefined ? {} : { headers: Object.freeze({ ...headers }) }),
        ...(customIncludeBody === undefined
            ? {}
            : { customIncludeBody: Object.freeze(structuredClone(customIncludeBody)) }),
        ...(customExcludeBody === undefined
            ? {}
            : { customExcludeBody: Object.freeze([...customExcludeBody]) }),
        temperature: capabilities.temperature ? temperature : undefined,
        sampling,
        tools,
        toolChoice,
        jsonSchema,
        credentialStore,
        fetch: input.fetch,
    });
    validatePayloadConfiguration(preflight);
    return preflight;
}

function createRuntimeProvider(preflight: PiRuntimePreflight) {
    const { resolution } = preflight;
    let auth: ProviderAuth;
    if (resolution.authType === 'oauth') {
        auth = {
            oauth: getBrowserOAuthAuth(resolution.definition.providerId, {
                fetch: preflight.fetch,
            }),
        };
    } else {
        auth = {
            apiKey: {
                name: `${resolution.definition.displayName.en} API key`,
                async resolve({ credential, signal }) {
                    signal.throwIfAborted();
                    if (!credential?.key) {
                        return undefined;
                    }
                    return {
                        auth: { apiKey: credential.key },
                        source: 'extra-model settings',
                    };
                },
            },
        };
    }

    return createProvider<Api>({
        id: resolution.definition.providerId,
        name: resolution.definition.displayName.en,
        baseUrl: resolution.model.baseUrl,
        auth,
        models: [resolution.model],
        api: createPiApiImplementations(resolution.definition),
    });
}

function contextHasImages(context: ReturnType<typeof toPiContext>['context']): boolean {
    return context.messages.some(message => {
        if (message.role === 'user') {
            return (
                Array.isArray(message.content) &&
                message.content.some(content => content.type === 'image')
            );
        }
        if (message.role === 'toolResult') {
            return message.content.some(content => content.type === 'image');
        }
        return false;
    });
}

function assertImageCapability(
    preflight: PiRuntimePreflight,
    context: ReturnType<typeof toPiContext>['context']
): void {
    if (!contextHasImages(context)) {
        return;
    }
    if (!preflight.capabilities.imageInput || !preflight.resolution.model.input.includes('image')) {
        throw new PiRuntimeError(
            'unsupported_image_input',
            `More source model '${preflight.resolution.model.id}' does not support image input`
        );
    }
}

function nativeStructuredFormat(
    responseFormat: PiRuntimeResponseFormat
): '格式化输出' | '格式化输出(v4兼容)' | undefined {
    return responseFormat === '格式化输出' || responseFormat === '格式化输出(v4兼容)'
        ? responseFormat
        : undefined;
}

function createStreamOptions(
    preflight: PiRuntimePreflight,
    signal: AbortSignal
): ApiStreamOptions<Api> {
    return {
        signal,
        apiKey: preflight.resolution.apiKey,
        fetch: preflight.fetch,
        headers: preflight.headers === undefined ? undefined : { ...preflight.headers },
        temperature: preflight.capabilities.temperature ? preflight.temperature : undefined,
        maxTokens: preflight.resolution.effectiveMaxTokens,
        ...(preflight.toolChoice === undefined ? {} : { toolChoice: preflight.toolChoice }),
        onPayload: createPiPayloadTransform({
            api: preflight.resolution.model.api,
            responseFormat: nativeStructuredFormat(preflight.responseFormat),
            jsonSchema: preflight.jsonSchema,
            customIncludeBody:
                preflight.customIncludeBody === undefined
                    ? undefined
                    : { ...preflight.customIncludeBody },
            customExcludeBody: preflight.customExcludeBody,
            sampling: preflight.sampling,
        }),
    };
}

function isNetworkFailure(error: unknown): boolean {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    return /failed to fetch|fetch failed|network\s*error|networkerror|load failed|cors/i.test(
        message
    );
}

function normalizeRuntimeFailure(error: unknown): Error {
    if (error instanceof PiRuntimeError) {
        return error;
    }
    if (error instanceof PiResultAdapterError && error.code === 'aborted') {
        // The generation id is supplied by the request-level abort conversion below.
        return error;
    }
    if (
        (error instanceof PiResultAdapterError && error.code === 'network') ||
        isNetworkFailure(error)
    ) {
        return new PiRuntimeError(
            'network',
            'The browser could not complete the More source request. Check the endpoint, network access, and CORS policy.',
            true
        );
    }
    if (error instanceof PiResultAdapterError) {
        switch (error.code) {
            case 'provider-error':
                return new PiRuntimeError('provider', 'More source request failed.', true);
            case 'deferred':
                return new PiRuntimeError(
                    'protocol',
                    'More source provider returned a deferred response, which is not supported.'
                );
            case 'empty-response':
                return new PiRuntimeError(
                    'protocol',
                    'More source provider returned no usable response content.'
                );
            case 'invalid-tool-call':
                return new PiRuntimeError(
                    'protocol',
                    'More source provider returned an invalid tool call.'
                );
            case 'length':
                return new PiRuntimeError(
                    'protocol',
                    'More source provider response was truncated because it reached the output limit.'
                );
            case 'aborted':
                return error;
            case 'network':
                return new PiRuntimeError(
                    'network',
                    'The browser could not complete the More source request. Check the endpoint, network access, and CORS policy.',
                    true
                );
        }
    }
    // SDK/fetch implementations may attach response bodies, headers, or request configuration to
    // arbitrary errors. Do not surface the unknown error or retain it as a cause.
    return new PiRuntimeError('provider', 'More source request failed.', true);
}

function assertGenerationId(generationId: string): void {
    if (!generationId.trim()) {
        throw new PiRuntimeError(
            'invalid_configuration',
            'More source request generationId must not be empty'
        );
    }
}

/**
 * Convert a captured SillyTavern prompt and execute it through the selected pi provider.
 * This function never appends the returned assistant message to either context or ST chat.
 */
export async function runPiRequest(
    input: RunPiRequestInput
): Promise<string | GenerateToolCallResult> {
    assertGenerationId(input.generationId);
    let preflight: PiRuntimePreflight;
    try {
        preflight =
            input.preflight ??
            (await assertPiRuntimeConfiguration({
                settings: input.settings,
                responseFormat: input.responseFormat,
                jsonSchema: input.jsonSchema,
                tools: input.tools,
                toolChoice: input.toolChoice,
                credentialStore: input.credentialStore,
                fetch: input.fetch,
                signal: input.signal,
            }));
    } catch (error) {
        if (input.signal?.aborted) {
            throw new PiRequestAbortedError(input.generationId, input.signal.reason ?? error);
        }
        throw error;
    }

    let registration: ReturnType<typeof registerPiRequestController>;
    try {
        registration = registerPiRequestController(input.generationId, input.signal);
    } catch (error) {
        throw new PiRuntimeError(
            'request_already_active',
            error instanceof Error ? error.message : 'More source request is already active'
        );
    }
    try {
        if (registration.signal.aborted) {
            throw new PiRequestAbortedError(input.generationId, registration.signal.reason);
        }

        let context: ReturnType<typeof toPiContext>['context'];
        try {
            ({ context } = toPiContext(input.messages, input.contextOptions));
        } catch (error) {
            if (error instanceof PiContextAdapterError) {
                throw new PiRuntimeError('invalid_prompt', error.message);
            }
            throw error;
        }
        if (preflight.tools !== undefined) {
            context.tools = [...preflight.tools];
        }
        assertImageCapability(preflight, context);
        try {
            assertPiTokenBudget(
                context,
                preflight.resolution.effectiveContextWindow,
                preflight.resolution.effectiveMaxTokens
            );
        } catch (error) {
            throw new PiRuntimeError(
                'token_budget',
                error instanceof Error ? error.message : 'More source token preflight failed'
            );
        }

        const models = createModels({
            credentials: preflight.credentialStore,
            authContext: BROWSER_AUTH_CONTEXT,
        });
        models.setProvider(createRuntimeProvider(preflight));
        const stream = models.stream(
            preflight.resolution.model,
            context,
            createStreamOptions(preflight, registration.signal)
        );

        for await (const event of stream) {
            // Provider error events can contain raw response bodies, request headers, or echoed
            // credentials. The normalized terminal error below is the public failure boundary.
            if (event.type !== 'error') {
                await input.onProgress?.(event);
            }
        }
        const message = await stream.result();
        if (registration.signal.aborted || message.stopReason === 'aborted') {
            throw new PiRequestAbortedError(
                input.generationId,
                registration.signal.aborted ? registration.signal.reason : undefined
            );
        }
        return fromPiAssistantMessage(message);
    } catch (error) {
        const wasAborted =
            registration.signal.aborted ||
            error instanceof PiRequestAbortedError ||
            (error instanceof PiResultAdapterError && error.code === 'aborted');
        if (wasAborted) {
            throw error instanceof PiRequestAbortedError
                ? error
                : new PiRequestAbortedError(input.generationId, error);
        }
        const normalizedError = normalizeRuntimeFailure(error);
        if (!registration.signal.aborted) {
            // Abort listeners must not observe the raw provider error either.
            registration.controller.abort(normalizedError);
        }
        throw normalizedError;
    } finally {
        registration.release();
    }
}
