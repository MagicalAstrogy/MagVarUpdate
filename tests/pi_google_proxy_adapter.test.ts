import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';

jest.mock('@/function/update/pi/pi_gateway', () => {
    class TestAssistantMessageEventStream {
        private readonly queue: unknown[] = [];
        private readonly waiting: Array<(value: IteratorResult<unknown>) => void> = [];
        private done = false;
        private readonly final_result: Promise<unknown>;
        private resolve_final!: (value: unknown) => void;

        constructor() {
            this.final_result = new Promise(resolve => {
                this.resolve_final = resolve;
            });
        }

        push(event: unknown): void {
            if (this.done) {
                return;
            }
            const type = (event as { type?: string }).type;
            if (type === 'done') {
                this.done = true;
                this.resolve_final((event as { message: unknown }).message);
            } else if (type === 'error') {
                this.done = true;
                this.resolve_final((event as { error: unknown }).error);
            }
            const waiter = this.waiting.shift();
            if (waiter) {
                waiter({ value: event, done: false });
            } else {
                this.queue.push(event);
            }
        }

        end(): void {
            this.done = true;
            while (this.waiting.length > 0) {
                this.waiting.shift()?.({ value: undefined, done: true });
            }
        }

        async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
            for (;;) {
                if (this.queue.length > 0) {
                    yield this.queue.shift();
                } else if (this.done) {
                    return;
                } else {
                    const next = await new Promise<IteratorResult<unknown>>(resolve =>
                        this.waiting.push(resolve)
                    );
                    if (next.done) {
                        return;
                    }
                    yield next.value;
                }
            }
        }

        result(): Promise<unknown> {
            return this.final_result;
        }
    }

    return {
        buildBaseOptions: jest.fn(
            (
                model: { maxTokens: number },
                _context: unknown,
                options: Record<string, unknown> | undefined,
                apiKey: string
            ) => ({
                ...options,
                apiKey,
                maxTokens: options?.maxTokens ?? model.maxTokens,
            })
        ),
        calculateCost: jest.fn(
            (
                model: {
                    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
                },
                usage: {
                    input: number;
                    output: number;
                    cacheRead: number;
                    cacheWrite: number;
                    cost: {
                        input: number;
                        output: number;
                        cacheRead: number;
                        cacheWrite: number;
                        total: number;
                    };
                }
            ) => {
                usage.cost.input = (model.cost.input * usage.input) / 1_000_000;
                usage.cost.output = (model.cost.output * usage.output) / 1_000_000;
                usage.cost.cacheRead = (model.cost.cacheRead * usage.cacheRead) / 1_000_000;
                usage.cost.cacheWrite = (model.cost.cacheWrite * usage.cacheWrite) / 1_000_000;
                usage.cost.total =
                    usage.cost.input +
                    usage.cost.output +
                    usage.cost.cacheRead +
                    usage.cost.cacheWrite;
                return usage.cost;
            }
        ),
        clampThinkingLevel: jest.fn((_model: unknown, level: string) =>
            level === 'xhigh' || level === 'max' ? 'high' : level
        ),
        convertGoogleMessages: jest.fn(() => [
            {
                role: 'user',
                parts: [
                    { text: 'hello' },
                    { inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } },
                ],
            },
        ]),
        convertGoogleTools: jest.fn(() => [
            {
                functionDeclarations: [
                    {
                        name: 'mvu_update',
                        description: 'Update variables',
                        parametersJsonSchema: {
                            type: 'object',
                            properties: { value: { type: 'string' } },
                        },
                    },
                ],
            },
        ]),
        createAssistantMessageEventStream: jest.fn(() => new TestAssistantMessageEventStream()),
        isGoogleThinkingPart: jest.fn((part: { thought?: boolean }) => part.thought === true),
        mapGoogleStopReason: jest.fn((reason: string) => {
            if (reason === 'STOP') {
                return 'stop';
            }
            if (reason === 'MAX_TOKENS') {
                return 'length';
            }
            return 'error';
        }),
        resolveGoogleFunctionCallingMode: jest.fn((_tools: unknown, choice: string | undefined) =>
            choice === 'any' ? 'ANY' : choice === 'none' ? 'NONE' : 'AUTO'
        ),
        resolveGoogleThinkingLevel: jest.fn((_model: unknown, level: string) => level),
        retainGoogleThoughtSignature: jest.fn(
            (existing: string | undefined, incoming: string | undefined) =>
                incoming && incoming.length > 0 ? incoming : existing
        ),
        retryGoogleRequest: jest.fn((request: () => Promise<unknown>) => request()),
        supportsGoogleStrictToolSampling: jest.fn(() => true),
    };
});

import {
    assertGoogleProxyAdapterCompatible,
    createGoogleProxyAwareApi,
    GoogleProxyAdapterCompatibilityError,
    installGoogleClientFetch,
    type GoogleProxyOptions,
} from '@/function/update/pi/google_proxy_adapter';
import {
    createSillyTavernProxyFetch,
    resetSillyTavernProxyStatusForTests,
} from '@/function/update/pi/sillytavern_proxy';
import type {
    AssistantMessage,
    AssistantMessageEvent,
    AssistantMessageEventStream,
    Context,
    FetchFunction,
    Model,
    ProviderStreams,
} from '@/function/update/pi/pi_gateway';

class FallbackHeaders {
    private readonly values = new Map<string, string>();

    constructor(init?: HeadersInit) {
        if (!init) {
            return;
        }
        if (Symbol.iterator in Object(init)) {
            for (const [key, value] of init as Iterable<[string, string]>) {
                this.append(key, value);
            }
        } else {
            for (const [key, value] of Object.entries(init)) {
                this.append(key, value);
            }
        }
    }

    append(key: string, value: string): void {
        const normalized = key.toLowerCase();
        const previous = this.values.get(normalized);
        this.values.set(
            normalized,
            previous === undefined ? String(value) : `${previous}, ${value}`
        );
    }

    set(key: string, value: string): void {
        this.values.set(key.toLowerCase(), String(value));
    }

    get(key: string): string | null {
        return this.values.get(key.toLowerCase()) ?? null;
    }

    has(key: string): boolean {
        return this.values.has(key.toLowerCase());
    }

    delete(key: string): void {
        this.values.delete(key.toLowerCase());
    }

    entries(): IterableIterator<[string, string]> {
        return this.values.entries();
    }

    [Symbol.iterator](): IterableIterator<[string, string]> {
        return this.entries();
    }
}

class FallbackResponse {
    readonly body = null;
    readonly headers: Headers;
    readonly status: number;
    readonly statusText: string;
    readonly ok: boolean;
    private readonly value: string;

    constructor(body: BodyInit | null = null, init: ResponseInit = {}) {
        this.value = typeof body === 'string' ? body : '';
        this.status = init.status ?? 200;
        this.statusText = init.statusText ?? '';
        this.ok = this.status >= 200 && this.status < 300;
        this.headers = new Headers(init.headers);
    }

    async text(): Promise<string> {
        return this.value;
    }

    async json(): Promise<unknown> {
        return JSON.parse(this.value);
    }
}

const MODEL: Model<'google-generative-ai'> = {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    api: 'google-generative-ai',
    provider: 'opencode',
    baseUrl: 'https://opencode.ai/zen/v1',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 65_536,
};

const CONTEXT: Context = {
    systemPrompt: 'system',
    messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
    tools: [
        {
            name: 'mvu_update',
            description: 'Update variables',
            parameters: {
                type: 'object',
                properties: { value: { type: 'string' } },
            },
        },
    ],
};

function encodeChunks(text: string, widths: readonly number[]): Uint8Array[] {
    const encoded = new TextEncoder().encode(text);
    const chunks: Uint8Array[] = [];
    let offset = 0;
    let index = 0;
    while (offset < encoded.length) {
        const width = widths[index % widths.length] ?? 1;
        chunks.push(encoded.slice(offset, offset + width));
        offset += width;
        index += 1;
    }
    return chunks;
}

function streamingResponse(
    payloads: readonly Record<string, unknown>[],
    widths: readonly number[] = [1, 2, 5, 3, 8]
): Response {
    const bytes = encodeChunks(
        payloads.map(payload => `data: ${JSON.stringify(payload)}\r\n\r\n`).join(''),
        widths
    );
    let index = 0;
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: {
            getReader: () => ({
                read: async () =>
                    index < bytes.length
                        ? { done: false, value: bytes[index++] }
                        : { done: true, value: undefined },
                releaseLock: jest.fn(),
            }),
        },
    } as unknown as Response;
}

function completedTextResponse(text: string): Response {
    return streamingResponse([
        {
            responseId: `response-${text}`,
            candidates: [
                {
                    content: { role: 'model', parts: [{ text }] },
                    finishReason: 'STOP',
                },
            ],
        },
    ]);
}

async function collect(stream: AssistantMessageEventStream): Promise<{
    events: AssistantMessageEvent[];
    result: AssistantMessage;
}> {
    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) {
        events.push(event);
    }
    return { events, result: await stream.result() };
}

function createUpstream(): {
    api: ProviderStreams;
    stream: jest.Mock;
    streamSimple: jest.Mock;
} {
    const delegated = {} as AssistantMessageEventStream;
    const stream = jest.fn(() => delegated);
    const streamSimple = jest.fn(() => delegated);
    return { api: { stream, streamSimple }, stream, streamSimple };
}

describe('Google proxy-aware adapter', () => {
    const original_fetch = globalThis.fetch;
    const original_headers = globalThis.Headers;
    const original_response = globalThis.Response;
    const original_text_encoder = globalThis.TextEncoder;
    const original_text_decoder = globalThis.TextDecoder;

    beforeAll(() => {
        if (typeof globalThis.Headers !== 'function') {
            Object.defineProperty(globalThis, 'Headers', {
                configurable: true,
                writable: true,
                value: FallbackHeaders,
            });
        }
        if (typeof globalThis.Response !== 'function') {
            Object.defineProperty(globalThis, 'Response', {
                configurable: true,
                writable: true,
                value: FallbackResponse,
            });
        }
        Object.defineProperty(globalThis, 'TextEncoder', {
            configurable: true,
            writable: true,
            value: NodeTextEncoder,
        });
        Object.defineProperty(globalThis, 'TextDecoder', {
            configurable: true,
            writable: true,
            value: NodeTextDecoder,
        });
    });

    beforeEach(() => {
        jest.clearAllMocks();
        resetSillyTavernProxyStatusForTests();
        Object.defineProperty(globalThis, 'fetch', {
            configurable: true,
            writable: true,
            value: jest.fn(() => Promise.reject(new Error('unexpected global fetch'))),
        });
    });

    afterAll(() => {
        Object.defineProperty(globalThis, 'fetch', {
            configurable: true,
            writable: true,
            value: original_fetch,
        });
        Object.defineProperty(globalThis, 'Headers', {
            configurable: true,
            writable: true,
            value: original_headers,
        });
        Object.defineProperty(globalThis, 'Response', {
            configurable: true,
            writable: true,
            value: original_response,
        });
        Object.defineProperty(globalThis, 'TextEncoder', {
            configurable: true,
            writable: true,
            value: original_text_encoder,
        });
        Object.defineProperty(globalThis, 'TextDecoder', {
            configurable: true,
            writable: true,
            value: original_text_decoder,
        });
    });

    test('delegates direct and global-fetch requests to the upstream adapter', () => {
        const upstream = createUpstream();
        const api = createGoogleProxyAwareApi(upstream.api);

        api.stream(MODEL, CONTEXT);
        api.stream(MODEL, CONTEXT, { fetch: globalThis.fetch });
        api.streamSimple(MODEL, CONTEXT);

        expect(upstream.stream).toHaveBeenCalledTimes(2);
        expect(upstream.streamSimple).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('uses the injected fetch for the final URL and preserves payload and event semantics', async () => {
        const upstream = createUpstream();
        const api = createGoogleProxyAwareApi(upstream.api);
        const fetch_impl = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
            streamingResponse([
                {
                    responseId: 'response-1',
                    candidates: [
                        {
                            content: {
                                role: 'model',
                                parts: [
                                    {
                                        text: '思考',
                                        thought: true,
                                        thoughtSignature: 'dGhvdWdodA==',
                                    },
                                ],
                            },
                        },
                    ],
                },
                {
                    responseId: 'response-ignored',
                    candidates: [
                        {
                            content: {
                                role: 'model',
                                parts: [
                                    { text: '答案', thoughtSignature: 'dGV4dA==' },
                                    {
                                        functionCall: {
                                            id: 'call-1',
                                            name: 'mvu_update',
                                            args: { value: 'ok' },
                                        },
                                        thoughtSignature: 'dG9vbA==',
                                    },
                                ],
                            },
                            finishReason: 'STOP',
                        },
                    ],
                    usageMetadata: {
                        promptTokenCount: 10,
                        candidatesTokenCount: 5,
                        cachedContentTokenCount: 2,
                        thoughtsTokenCount: 3,
                        totalTokenCount: 15,
                    },
                },
            ])
        );
        const on_payload = jest.fn((payload: unknown) => {
            const params = payload as GenerateContentParametersLike;
            return {
                ...params,
                config: {
                    ...params.config,
                    topP: 0.8,
                    responseMimeType: 'application/json',
                    responseJsonSchema: { type: 'object' },
                },
            };
        });

        const stream = api.stream(MODEL, CONTEXT, {
            apiKey: 'secret-key',
            fetch: fetch_impl as unknown as FetchFunction,
            temperature: 0.4,
            maxTokens: 2048,
            toolChoice: 'any',
            thinking: { enabled: true, level: 'HIGH' },
            onPayload: on_payload,
        } as GoogleProxyOptions);
        const { events, result } = await collect(stream);

        expect(upstream.stream).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(fetch_impl).toHaveBeenCalledTimes(1);
        const [url, init] = fetch_impl.mock.calls[0]!;
        const request_init = init!;
        expect(url).toBe(
            'https://opencode.ai/zen/v1/models/gemini-3-flash:streamGenerateContent?alt=sse'
        );
        expect(request_init.method).toBe('POST');
        expect((request_init.headers as Headers).get('x-goog-api-key')).toBe('secret-key');
        expect(JSON.parse(request_init.body as string)).toEqual({
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: 'hello' },
                        { inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } },
                    ],
                },
            ],
            systemInstruction: { role: 'user', parts: [{ text: 'system' }] },
            tools: [
                {
                    functionDeclarations: [
                        {
                            name: 'mvu_update',
                            description: 'Update variables',
                            parametersJsonSchema: {
                                type: 'object',
                                properties: { value: { type: 'string' } },
                            },
                        },
                    ],
                },
            ],
            toolConfig: { functionCallingConfig: { mode: 'ANY' } },
            generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 2048,
                topP: 0.8,
                responseMimeType: 'application/json',
                responseJsonSchema: { type: 'object' },
                thinkingConfig: { includeThoughts: true, thinkingLevel: 'HIGH' },
            },
        });
        expect(on_payload).toHaveBeenCalledTimes(1);
        expect(events.map(event => event.type)).toEqual([
            'start',
            'thinking_start',
            'thinking_delta',
            'thinking_end',
            'text_start',
            'text_delta',
            'text_end',
            'toolcall_start',
            'toolcall_delta',
            'toolcall_end',
            'done',
        ]);
        expect(result).toMatchObject({
            responseId: 'response-1',
            stopReason: 'toolUse',
            content: [
                {
                    type: 'thinking',
                    thinking: '思考',
                    thinkingSignature: 'dGhvdWdodA==',
                },
                { type: 'text', text: '答案', textSignature: 'dGV4dA==' },
                {
                    type: 'toolCall',
                    id: 'call-1',
                    name: 'mvu_update',
                    arguments: { value: 'ok' },
                    thoughtSignature: 'dG9vbA==',
                },
            ],
            usage: {
                input: 8,
                output: 8,
                cacheRead: 2,
                cacheWrite: 0,
                reasoning: 3,
                totalTokens: 15,
            },
        });
        expect(result.usage.cost.total).toBeGreaterThan(0);
    });

    test('encodes the complete Google SSE URL when composed with the SillyTavern proxy', async () => {
        const upstream = createUpstream();
        const api = createGoogleProxyAwareApi(upstream.api);
        const st_fetch = jest
            .fn()
            .mockResolvedValueOnce(new Response('mvu-st-cors-proxy-probe', { status: 200 }))
            .mockResolvedValueOnce(completedTextResponse('proxied'));
        const proxy_fetch = createSillyTavernProxyFetch({
            baseUrl: MODEL.baseUrl,
            fetch: st_fetch as unknown as FetchFunction,
            origin: 'http://st.local:8000',
        });

        const { result } = await collect(
            api.stream(MODEL, CONTEXT, {
                apiKey: 'secret-key',
                fetch: proxy_fetch,
            })
        );
        const target =
            'https://opencode.ai/zen/v1/models/gemini-3-flash:streamGenerateContent?alt=sse';

        expect(result).toMatchObject({ stopReason: 'stop', content: [{ text: 'proxied' }] });
        expect(st_fetch).toHaveBeenCalledTimes(2);
        expect(st_fetch.mock.calls[1]![0]).toBe(`/proxy/${encodeURIComponent(target)}`);
        expect(st_fetch.mock.calls[1]![1]).toMatchObject({
            method: 'POST',
            credentials: 'same-origin',
        });
        expect(upstream.stream).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('keeps two injected clients isolated during concurrent streams', async () => {
        const upstream = createUpstream();
        const api = createGoogleProxyAwareApi(upstream.api);
        const fetch_a = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
            completedTextResponse('A')
        );
        const fetch_b = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
            completedTextResponse('B')
        );

        const stream_a = api.stream(MODEL, CONTEXT, {
            apiKey: 'key-a',
            fetch: fetch_a as unknown as FetchFunction,
        });
        const stream_b = api.stream(MODEL, CONTEXT, {
            apiKey: 'key-b',
            fetch: fetch_b as unknown as FetchFunction,
        });
        const [result_a, result_b] = await Promise.all([collect(stream_a), collect(stream_b)]);

        expect(result_a.result.content).toEqual([{ type: 'text', text: 'A' }]);
        expect(result_b.result.content).toEqual([{ type: 'text', text: 'B' }]);
        expect(fetch_a).toHaveBeenCalledTimes(1);
        expect(fetch_b).toHaveBeenCalledTimes(1);
        expect((fetch_a.mock.calls[0]![1]!.headers as Headers).get('x-goog-api-key')).toBe('key-a');
        expect((fetch_b.mock.calls[0]![1]!.headers as Headers).get('x-goog-api-key')).toBe('key-b');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('propagates AbortSignal through the SDK and reports an aborted event', async () => {
        const upstream = createUpstream();
        const api = createGoogleProxyAwareApi(upstream.api);
        const controller = new AbortController();
        let observe_signal!: (signal: AbortSignal) => void;
        const request_started = new Promise<AbortSignal>(resolve => {
            observe_signal = resolve;
        });
        const fetch_impl = jest.fn(
            async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
                const signal = init?.signal;
                if (!signal) {
                    throw new Error('missing signal');
                }
                observe_signal(signal);
                return new Promise((_resolve, reject) => {
                    signal.addEventListener(
                        'abort',
                        () => reject(new DOMException('Aborted', 'AbortError')),
                        { once: true }
                    );
                });
            }
        );

        const pending = collect(
            api.stream(MODEL, CONTEXT, {
                apiKey: 'secret-key',
                fetch: fetch_impl as FetchFunction,
                signal: controller.signal,
            })
        );
        const forwarded_signal = await request_started;
        controller.abort('stop');
        const { events, result } = await pending;

        expect(forwarded_signal).not.toBe(controller.signal);
        expect(forwarded_signal.aborted).toBe(true);
        expect(events.at(-1)).toMatchObject({ type: 'error', reason: 'aborted' });
        expect(result.stopReason).toBe('aborted');
    });

    test('turns provider and incomplete-stream failures into terminal error events', async () => {
        const upstream = createUpstream();
        const api = createGoogleProxyAwareApi(upstream.api);
        const failed_fetch = jest.fn(
            async (_url: RequestInfo | URL, _init?: RequestInit) =>
                ({
                    ok: false,
                    status: 503,
                    statusText: 'Unavailable',
                    headers: new Headers({ 'content-type': 'application/json' }),
                    json: async () => ({ error: { code: 503, message: 'unavailable' } }),
                    text: async () => 'unavailable',
                }) as Response
        );
        const incomplete_fetch = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
            streamingResponse([{ candidates: [{ content: { parts: [{ text: 'partial' }] } }] }])
        );

        const failed = await collect(
            api.stream(MODEL, CONTEXT, {
                apiKey: 'secret-key',
                fetch: failed_fetch as unknown as FetchFunction,
            })
        );
        const incomplete = await collect(
            api.stream(MODEL, CONTEXT, {
                apiKey: 'secret-key',
                fetch: incomplete_fetch as unknown as FetchFunction,
            })
        );

        expect(failed.events.at(-1)).toMatchObject({ type: 'error', reason: 'error' });
        expect(failed.result.stopReason).toBe('error');
        expect(incomplete.events.at(-1)).toMatchObject({ type: 'error', reason: 'error' });
        expect(incomplete.result).toMatchObject({
            stopReason: 'error',
            errorMessage: 'Google stream ended without a finish reason',
        });
    });

    test('fails closed when the pinned instance transport seam is absent', async () => {
        expect(() => assertGoogleProxyAdapterCompatible()).not.toThrow();
        expect(globalThis.fetch).not.toHaveBeenCalled();

        const fetch_impl = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
            completedTextResponse('unused')
        );
        expect(() => installGoogleClientFetch({}, fetch_impl as unknown as FetchFunction)).toThrow(
            GoogleProxyAdapterCompatibilityError
        );
        try {
            installGoogleClientFetch({}, fetch_impl as unknown as FetchFunction);
        } catch (error) {
            expect(error).toMatchObject({
                code: 'google_proxy_adapter_incompatible',
                retryable: false,
            });
        }
        expect(fetch_impl).not.toHaveBeenCalled();

        const api_call = jest.fn(async (_url: string, _init: RequestInit) =>
            completedTextResponse('ok')
        );
        const client = { apiClient: { apiCall: api_call } };
        installGoogleClientFetch(client, fetch_impl as unknown as FetchFunction);
        await client.apiClient.apiCall('https://example.invalid', {});
        expect(fetch_impl).toHaveBeenCalledWith('https://example.invalid', {});
        expect(api_call).not.toHaveBeenCalled();
    });
});

type GenerateContentParametersLike = {
    model: string;
    contents: unknown;
    config: Record<string, unknown>;
};
