import {
    GoogleGenAI,
    type GenerateContentConfig,
    type GenerateContentParameters,
    type ThinkingConfig,
} from '@google/genai';
import {
    buildBaseOptions,
    calculateCost,
    clampThinkingLevel,
    convertGoogleMessages,
    convertGoogleTools,
    createAssistantMessageEventStream,
    isGoogleThinkingPart,
    mapGoogleStopReason,
    resolveGoogleFunctionCallingMode,
    resolveGoogleThinkingLevel,
    retainGoogleThoughtSignature,
    retryGoogleRequest,
    supportsGoogleStrictToolSampling,
    type Api,
    type AssistantMessage,
    type AssistantMessageEventStream,
    type Context,
    type FetchFunction,
    type GoogleApiThinkingLevel,
    type Model,
    type ProviderHeaders,
    type ProviderStreams,
    type ResolvedGoogleThinkingLevel,
    type SimpleStreamOptions,
    type StreamOptions,
    type TextContent,
    type ThinkingBudgets,
    type ThinkingContent,
    type ToolCall,
} from './pi_gateway';

/**
 * The pinned Google SDK does not expose a supported per-client fetch option on GoogleGenAI.
 * Its browser implementation does, however, keep the HTTP entry point on this instance-local
 * object. Keeping the narrow structural assumption here makes SDK upgrades fail closed before a
 * credential-bearing request is sent, without mutating global fetch or an SDK prototype.
 */
type InjectableGoogleClient = {
    apiClient?: {
        apiCall?: (url: string, init: RequestInit) => Promise<Response>;
    };
};

const GOOGLE_TRANSPORT_PROBE_KEY = 'mvu-google-transport-compatibility-check';

export class GoogleProxyAdapterCompatibilityError extends Error {
    readonly code = 'google_proxy_adapter_incompatible';
    readonly retryable = false;

    constructor() {
        super(
            'The installed Google Generative AI SDK no longer exposes the audited per-client HTTP transport required by the SillyTavern proxy.'
        );
        this.name = 'GoogleProxyAdapterCompatibilityError';
    }
}

export interface GoogleProxyOptions extends StreamOptions {
    toolChoice?: 'auto' | 'none' | 'any';
    thinking?: {
        enabled: boolean;
        /** -1 asks Google to choose a dynamic budget; 0 disables budget-based thinking. */
        budgetTokens?: number;
        level?: GoogleApiThinkingLevel;
    };
}

/** Install one fetch implementation on one client instance. Never mutates globals/prototypes. */
export function installGoogleClientFetch(client: unknown, fetch_impl: FetchFunction): void {
    const api_client = (client as InjectableGoogleClient | null)?.apiClient;
    if (!api_client || typeof api_client.apiCall !== 'function') {
        throw new GoogleProxyAdapterCompatibilityError();
    }

    const injected = (url: string, init: RequestInit) => fetch_impl(url, init);
    try {
        api_client.apiCall = injected;
    } catch {
        throw new GoogleProxyAdapterCompatibilityError();
    }
    if (api_client.apiCall !== injected) {
        throw new GoogleProxyAdapterCompatibilityError();
    }
}

/**
 * Verify the pinned SDK seam before Pi's Models.lazyStream boundary can turn a setup failure into
 * an opaque assistant error. GoogleGenAI construction is local and performs no network request.
 */
export function assertGoogleProxyAdapterCompatible(): void {
    const client = new GoogleGenAI({ apiKey: GOOGLE_TRANSPORT_PROBE_KEY });
    installGoogleClientFetch(client, async () => {
        throw new GoogleProxyAdapterCompatibilityError();
    });
}

function shouldUseInjectedFetch(
    fetch_impl: FetchFunction | undefined
): fetch_impl is FetchFunction {
    return fetch_impl !== undefined && fetch_impl !== globalThis.fetch;
}

function providerHeadersToRecord(
    headers: ProviderHeaders | undefined
): Record<string, string> | undefined {
    if (!headers) {
        return undefined;
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        if (value !== null) {
            result[key] = value;
        }
    }
    return Object.keys(result).length === 0 ? undefined : result;
}

function sanitizeSurrogates(text: string): string {
    return text.replace(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
        ''
    );
}

function formatGoogleError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const limit = 4000;
    return message.length <= limit
        ? message
        : `${message.slice(0, limit)}... [truncated ${message.length - limit} chars]`;
}

function createOutput(model: Model<'google-generative-ai'>): AssistantMessage {
    return {
        role: 'assistant',
        content: [],
        api: 'google-generative-ai' as Api,
        provider: model.provider,
        model: model.id,
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'pending',
        timestamp: Date.now(),
    };
}

function createClient(
    model: Model<'google-generative-ai'>,
    api_key: string,
    options_headers: ProviderHeaders | undefined,
    fetch_impl: FetchFunction
): GoogleGenAI {
    const http_options: {
        baseUrl?: string;
        apiVersion?: string;
        headers?: Record<string, string>;
    } = {};
    if (model.baseUrl) {
        http_options.baseUrl = model.baseUrl;
        // Pi model base URLs already include their API version path.
        http_options.apiVersion = '';
    }
    const headers = providerHeadersToRecord({
        'User-Agent': 'pi (browser)',
        ...model.headers,
        ...options_headers,
    });
    if (headers) {
        http_options.headers = headers;
    }

    const client = new GoogleGenAI({
        apiKey: api_key,
        httpOptions: Object.keys(http_options).length === 0 ? undefined : http_options,
    });
    installGoogleClientFetch(client, fetch_impl);
    return client;
}

function buildParams(
    model: Model<'google-generative-ai'>,
    context: Context,
    options: GoogleProxyOptions = {}
): GenerateContentParameters {
    const contents = convertGoogleMessages(model, context);
    const generation_config: GenerateContentConfig = {};
    if (options.temperature !== undefined) {
        generation_config.temperature = options.temperature;
    }
    if (options.maxTokens !== undefined) {
        generation_config.maxOutputTokens = options.maxTokens;
    }

    const supports_strict_mode = supportsGoogleStrictToolSampling(model.id);
    const function_calling_mode = context.tools?.length
        ? resolveGoogleFunctionCallingMode(context.tools, options.toolChoice, supports_strict_mode)
        : undefined;
    const config: GenerateContentConfig = {
        ...(Object.keys(generation_config).length === 0 ? {} : generation_config),
        ...(context.systemPrompt
            ? { systemInstruction: sanitizeSurrogates(context.systemPrompt) }
            : {}),
        ...(context.tools?.length
            ? { tools: convertGoogleTools(context.tools, false, supports_strict_mode) }
            : {}),
        ...(function_calling_mode === undefined
            ? {}
            : { toolConfig: { functionCallingConfig: { mode: function_calling_mode } } }),
    };

    if (options.thinking?.enabled && model.reasoning) {
        const thinking_config: ThinkingConfig = { includeThoughts: true };
        if (options.thinking.level !== undefined) {
            thinking_config.thinkingLevel = options.thinking
                .level as ThinkingConfig['thinkingLevel'];
        } else if (options.thinking.budgetTokens !== undefined) {
            thinking_config.thinkingBudget = options.thinking.budgetTokens;
        }
        config.thinkingConfig = thinking_config;
    } else if (model.reasoning && options.thinking && !options.thinking.enabled) {
        config.thinkingConfig = getDisabledThinkingConfig(model);
    }

    if (options.signal) {
        if (options.signal.aborted) {
            throw new Error('Request aborted');
        }
        config.abortSignal = options.signal;
    }

    return {
        model: model.id,
        contents,
        config,
    };
}

let tool_call_counter = 0;

function streamWithInjectedFetch(
    model: Model<'google-generative-ai'>,
    context: Context,
    options: GoogleProxyOptions,
    fetch_impl: FetchFunction
): AssistantMessageEventStream {
    const output = createOutput(model);
    const stream = createAssistantMessageEventStream();
    const api_key = options.apiKey;

    // Construct and verify the instance-local injection point synchronously. This cannot perform
    // network I/O, and preserves the compatibility error instead of converting it to provider data.
    const client = api_key ? createClient(model, api_key, options.headers, fetch_impl) : undefined;

    void (async () => {
        try {
            if (!api_key || !client) {
                throw new Error(`No API key for provider: ${model.provider}`);
            }

            let params = buildParams(model, context, options);
            const next_params = await options.onPayload?.(params, model);
            if (next_params !== undefined) {
                params = next_params as GenerateContentParameters;
            }
            const google_stream = await retryGoogleRequest(
                () => client.models.generateContentStream(params),
                options
            );

            stream.push({ type: 'start', partial: output });
            let current_block: TextContent | ThinkingContent | null = null;
            const blocks = output.content;
            const block_index = () => blocks.length - 1;

            for await (const chunk of google_stream) {
                output.responseId ||= chunk.responseId;
                const candidate = chunk.candidates?.[0];
                if (candidate?.content?.parts) {
                    for (const part of candidate.content.parts) {
                        if (part.text !== undefined) {
                            const is_thinking = isGoogleThinkingPart(part);
                            if (
                                !current_block ||
                                (is_thinking && current_block.type !== 'thinking') ||
                                (!is_thinking && current_block.type !== 'text')
                            ) {
                                if (current_block) {
                                    if (current_block.type === 'text') {
                                        stream.push({
                                            type: 'text_end',
                                            contentIndex: block_index(),
                                            content: current_block.text,
                                            partial: output,
                                        });
                                    } else {
                                        stream.push({
                                            type: 'thinking_end',
                                            contentIndex: block_index(),
                                            content: current_block.thinking,
                                            partial: output,
                                        });
                                    }
                                }
                                if (is_thinking) {
                                    current_block = {
                                        type: 'thinking',
                                        thinking: '',
                                        thinkingSignature: undefined,
                                    };
                                    output.content.push(current_block);
                                    stream.push({
                                        type: 'thinking_start',
                                        contentIndex: block_index(),
                                        partial: output,
                                    });
                                } else {
                                    current_block = { type: 'text', text: '' };
                                    output.content.push(current_block);
                                    stream.push({
                                        type: 'text_start',
                                        contentIndex: block_index(),
                                        partial: output,
                                    });
                                }
                            }

                            if (current_block.type === 'thinking') {
                                current_block.thinking += part.text;
                                current_block.thinkingSignature = retainGoogleThoughtSignature(
                                    current_block.thinkingSignature,
                                    part.thoughtSignature
                                );
                                stream.push({
                                    type: 'thinking_delta',
                                    contentIndex: block_index(),
                                    delta: part.text,
                                    partial: output,
                                });
                            } else {
                                current_block.text += part.text;
                                current_block.textSignature = retainGoogleThoughtSignature(
                                    current_block.textSignature,
                                    part.thoughtSignature
                                );
                                stream.push({
                                    type: 'text_delta',
                                    contentIndex: block_index(),
                                    delta: part.text,
                                    partial: output,
                                });
                            }
                        }

                        if (part.functionCall) {
                            if (current_block) {
                                if (current_block.type === 'text') {
                                    stream.push({
                                        type: 'text_end',
                                        contentIndex: block_index(),
                                        content: current_block.text,
                                        partial: output,
                                    });
                                } else {
                                    stream.push({
                                        type: 'thinking_end',
                                        contentIndex: block_index(),
                                        content: current_block.thinking,
                                        partial: output,
                                    });
                                }
                                current_block = null;
                            }

                            const provided_id = part.functionCall.id;
                            const needs_new_id =
                                !provided_id ||
                                output.content.some(
                                    block => block.type === 'toolCall' && block.id === provided_id
                                );
                            const tool_call_id = needs_new_id
                                ? `${part.functionCall.name}_${Date.now()}_${++tool_call_counter}`
                                : provided_id;
                            const tool_call: ToolCall = {
                                type: 'toolCall',
                                id: tool_call_id,
                                name: part.functionCall.name || '',
                                arguments:
                                    (part.functionCall.args as Record<string, unknown>) ?? {},
                                ...(part.thoughtSignature
                                    ? { thoughtSignature: part.thoughtSignature }
                                    : {}),
                            };
                            output.content.push(tool_call);
                            stream.push({
                                type: 'toolcall_start',
                                contentIndex: block_index(),
                                partial: output,
                            });
                            stream.push({
                                type: 'toolcall_delta',
                                contentIndex: block_index(),
                                delta: JSON.stringify(tool_call.arguments),
                                partial: output,
                            });
                            stream.push({
                                type: 'toolcall_end',
                                contentIndex: block_index(),
                                toolCall: tool_call,
                                partial: output,
                            });
                        }
                    }
                }

                if (candidate?.finishReason) {
                    output.rawStopReason = candidate.finishReason;
                    output.stopReason = mapGoogleStopReason(candidate.finishReason);
                    if (
                        output.stopReason === 'stop' &&
                        output.content.some(block => block.type === 'toolCall')
                    ) {
                        output.stopReason = 'toolUse';
                    }
                }

                if (chunk.usageMetadata) {
                    output.usage = {
                        input:
                            (chunk.usageMetadata.promptTokenCount || 0) -
                            (chunk.usageMetadata.cachedContentTokenCount || 0),
                        output:
                            (chunk.usageMetadata.candidatesTokenCount || 0) +
                            (chunk.usageMetadata.thoughtsTokenCount || 0),
                        cacheRead: chunk.usageMetadata.cachedContentTokenCount || 0,
                        cacheWrite: 0,
                        reasoning: chunk.usageMetadata.thoughtsTokenCount || 0,
                        totalTokens: chunk.usageMetadata.totalTokenCount || 0,
                        cost: {
                            input: 0,
                            output: 0,
                            cacheRead: 0,
                            cacheWrite: 0,
                            total: 0,
                        },
                    };
                    calculateCost(model, output.usage);
                }
            }

            if (current_block) {
                if (current_block.type === 'text') {
                    stream.push({
                        type: 'text_end',
                        contentIndex: block_index(),
                        content: current_block.text,
                        partial: output,
                    });
                } else {
                    stream.push({
                        type: 'thinking_end',
                        contentIndex: block_index(),
                        content: current_block.thinking,
                        partial: output,
                    });
                }
            }

            if (options.signal?.aborted) {
                throw new Error('Request was aborted');
            }
            if (output.stopReason === 'pending') {
                throw new Error('Google stream ended without a finish reason');
            }
            if (output.stopReason === 'aborted' || output.stopReason === 'error') {
                throw new Error(
                    output.rawStopReason
                        ? `Provider stopped with: ${output.rawStopReason}`
                        : 'An unknown error occurred'
                );
            }

            stream.push({ type: 'done', reason: output.stopReason, message: output });
            stream.end();
        } catch (error) {
            for (const block of output.content) {
                if ('index' in block) {
                    delete (block as { index?: number }).index;
                }
            }
            output.stopReason = options.signal?.aborted ? 'aborted' : 'error';
            output.errorMessage = formatGoogleError(error);
            stream.push({ type: 'error', reason: output.stopReason, error: output });
            stream.end();
        }
    })();

    return stream;
}

function isGemma4Model(model: Model<'google-generative-ai'>): boolean {
    return /gemma-?4/.test(model.id.toLowerCase());
}

function isGemini3ProModel(model: Model<'google-generative-ai'>): boolean {
    return /gemini-3(?:\.\d+)?-pro/.test(model.id.toLowerCase());
}

function isGemini3FlashModel(model: Model<'google-generative-ai'>): boolean {
    const id = model.id.toLowerCase();
    return (
        /gemini-3(?:\.\d+)?-flash/.test(id) ||
        id === 'gemini-flash-latest' ||
        id === 'gemini-flash-lite-latest'
    );
}

function getDisabledThinkingConfig(model: Model<'google-generative-ai'>): ThinkingConfig {
    if (isGemini3ProModel(model)) {
        return { thinkingLevel: 'LOW' as ThinkingConfig['thinkingLevel'] };
    }
    if (isGemini3FlashModel(model) || isGemma4Model(model)) {
        return { thinkingLevel: 'MINIMAL' as ThinkingConfig['thinkingLevel'] };
    }
    return { thinkingBudget: 0 };
}

function getThinkingLevel(
    effort: ResolvedGoogleThinkingLevel,
    model: Model<'google-generative-ai'>
): GoogleApiThinkingLevel {
    if (isGemini3ProModel(model)) {
        return effort === 'minimal' || effort === 'low' ? 'LOW' : 'HIGH';
    }
    if (isGemma4Model(model)) {
        return effort === 'minimal' || effort === 'low' ? 'MINIMAL' : 'HIGH';
    }
    switch (effort) {
        case 'minimal':
            return 'MINIMAL';
        case 'low':
            return 'LOW';
        case 'medium':
            return 'MEDIUM';
        case 'high':
            return 'HIGH';
    }
}

function getGoogleBudget(
    model: Model<'google-generative-ai'>,
    level: ResolvedGoogleThinkingLevel,
    custom_budgets?: ThinkingBudgets
): number {
    if (custom_budgets?.[level] !== undefined) {
        return custom_budgets[level];
    }
    if (model.id.includes('2.5-pro')) {
        return { minimal: 128, low: 2048, medium: 8192, high: 32768 }[level];
    }
    if (model.id.includes('2.5-flash-lite')) {
        return { minimal: 512, low: 2048, medium: 8192, high: 24576 }[level];
    }
    if (model.id.includes('2.5-flash')) {
        return { minimal: 128, low: 2048, medium: 8192, high: 24576 }[level];
    }
    return -1;
}

function streamSimpleWithInjectedFetch(
    model: Model<'google-generative-ai'>,
    context: Context,
    options: SimpleStreamOptions,
    fetch_impl: FetchFunction
): AssistantMessageEventStream {
    const api_key = options.apiKey;
    if (!api_key) {
        throw new Error(`No API key for provider: ${model.provider}`);
    }
    const base: GoogleProxyOptions = {
        ...buildBaseOptions(model, context, options, api_key),
        toolChoice: options.toolChoice,
    };
    if (!options.reasoning) {
        return streamWithInjectedFetch(
            model,
            context,
            { ...base, thinking: { enabled: false } },
            fetch_impl
        );
    }

    const clamped_reasoning = clampThinkingLevel(model, options.reasoning);
    const resolved_level = resolveGoogleThinkingLevel(model, clamped_reasoning);
    if (isGemini3ProModel(model) || isGemini3FlashModel(model) || isGemma4Model(model)) {
        return streamWithInjectedFetch(
            model,
            context,
            {
                ...base,
                thinking: { enabled: true, level: getThinkingLevel(resolved_level, model) },
            },
            fetch_impl
        );
    }
    return streamWithInjectedFetch(
        model,
        context,
        {
            ...base,
            thinking: {
                enabled: true,
                budgetTokens: getGoogleBudget(model, resolved_level, options.thinkingBudgets),
            },
        },
        fetch_impl
    );
}

/**
 * Use Pi's upstream Google implementation for ordinary browser requests. Only requests carrying
 * a distinct fetch implementation (the SillyTavern proxy transport) use the local bridge.
 */
export function createGoogleProxyAwareApi(upstream: ProviderStreams): ProviderStreams {
    return {
        stream(model, context, options) {
            if (!shouldUseInjectedFetch(options?.fetch)) {
                return upstream.stream(model, context, options);
            }
            return streamWithInjectedFetch(
                model as Model<'google-generative-ai'>,
                context,
                options as GoogleProxyOptions,
                options.fetch
            );
        },
        streamSimple(model, context, options) {
            if (!shouldUseInjectedFetch(options?.fetch)) {
                return upstream.streamSimple(model, context, options);
            }
            return streamSimpleWithInjectedFetch(
                model as Model<'google-generative-ai'>,
                context,
                options,
                options.fetch
            );
        },
    };
}
