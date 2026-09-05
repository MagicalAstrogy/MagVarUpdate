/**
 * requestReply integration coverage for the browser Pi boundary.
 *
 * pi-ai is ESM-only while the repository Jest suite is CommonJS.  Keep the
 * provider transport seam deterministic here, but use the production
 * requestReply, prompt-capture, model resolver, OAuth bridge, credential store,
 * context adapter, token preflight, result adapter, and controller registry.
 */
jest.mock('@/function/update/pi/pi_gateway', () => {
    const model = (
        id: string,
        api: string,
        provider: string,
        baseUrl: string,
        contextWindow: number,
        maxTokens: number
    ) => ({
        id,
        name: id,
        api,
        provider,
        baseUrl,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens,
    });

    const api = (name: string) => ({ name, stream: jest.fn(), streamSimple: jest.fn() });

    function appendPath(baseUrl: string, path: string): string {
        return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
    }

    function requestPath(wireApi: string): string {
        switch (wireApi) {
            case 'openai-responses':
                return 'responses';
            case 'openai-completions':
                return 'chat/completions';
            case 'anthropic-messages':
                return 'v1/messages';
            case 'openai-codex-responses':
                return 'responses';
            case 'google-generative-ai':
                return 'models:streamGenerateContent';
            default:
                throw new Error(`Unexpected wire API: ${wireApi}`);
        }
    }

    function makeAssistantMessage(modelValue: any, text: string) {
        return {
            role: 'assistant',
            content: [{ type: 'text', text }],
            api: modelValue.api,
            provider: modelValue.provider,
            model: modelValue.id,
            usage: {
                input: 1,
                output: 1,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 2,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: 'stop',
            timestamp: Date.now(),
        };
    }

    return {
        OPENAI_MODELS: {
            'gpt-catalog': model(
                'gpt-catalog',
                'openai-responses',
                'openai',
                'https://api.openai.com/v1',
                128_000,
                8192
            ),
        },
        OPENAI_CODEX_MODELS: {
            'codex-catalog': model(
                'codex-catalog',
                'openai-codex-responses',
                'openai-codex',
                'https://chatgpt.com/backend-api',
                200_000,
                32_000
            ),
        },
        ANTHROPIC_MODELS: {
            'claude-catalog': model(
                'claude-catalog',
                'anthropic-messages',
                'anthropic',
                'https://api.anthropic.com',
                200_000,
                8192
            ),
        },
        GOOGLE_MODELS: {},
        openAIResponsesApi: jest.fn(() => api('openai-responses')),
        openAICompletionsApi: jest.fn(() => api('openai-completions')),
        openAICodexResponsesApi: jest.fn(() => api('openai-codex-responses')),
        anthropicMessagesApi: jest.fn(() => api('anthropic-messages')),
        googleGenerativeAIApi: jest.fn(() => api('google-generative-ai')),
        createProvider: jest.fn((input: any) => input),
        createModels: jest.fn((options: any) => {
            let provider: any;
            return {
                setProvider(nextProvider: any) {
                    provider = nextProvider;
                },
                stream(modelValue: any, context: any, streamOptions: any) {
                    const completed = (async () => {
                        const signal: AbortSignal = streamOptions.signal;
                        signal.throwIfAborted();

                        let apiKey: string | undefined = streamOptions.apiKey;
                        let oauth = false;
                        if (!apiKey && provider.auth.oauth) {
                            let credential = await options.credentials.read(provider.id, {
                                signal,
                            });
                            if (credential?.type === 'oauth') {
                                oauth = true;
                                if (Date.now() + 5 * 60 * 1000 >= credential.expires) {
                                    credential = await options.credentials.modify(
                                        provider.id,
                                        async (current: any) => {
                                            if (current?.type !== 'oauth') {
                                                return undefined;
                                            }
                                            if (Date.now() + 5 * 60 * 1000 < current.expires) {
                                                return undefined;
                                            }
                                            return provider.auth.oauth.refresh(current, signal);
                                        },
                                        { signal }
                                    );
                                }
                                if (credential?.type === 'oauth') {
                                    apiKey = (await provider.auth.oauth.toAuth(credential)).apiKey;
                                }
                            }
                        }
                        if (!apiKey) {
                            throw new Error(`Missing mock transport credential for ${provider.id}`);
                        }

                        const basePayload =
                            modelValue.api === 'openai-responses'
                                ? {
                                      model: modelValue.id,
                                      input: context.messages,
                                      system: context.systemPrompt,
                                      stream: true,
                                      max_output_tokens: streamOptions.maxTokens,
                                  }
                                : {
                                      model: modelValue.id,
                                      messages: context.messages,
                                      system: context.systemPrompt,
                                      stream: true,
                                      max_tokens: streamOptions.maxTokens,
                                  };
                        const payload =
                            (await streamOptions.onPayload?.(basePayload, modelValue)) ??
                            basePayload;
                        const headers = new Headers(streamOptions.headers);
                        headers.set('Content-Type', 'application/json');
                        if (modelValue.api === 'anthropic-messages' && !oauth) {
                            headers.set('x-api-key', apiKey);
                        } else {
                            headers.set('Authorization', `Bearer ${apiKey}`);
                        }

                        const fetchImpl = streamOptions.fetch ?? globalThis.fetch;
                        const response = await fetchImpl(
                            appendPath(modelValue.baseUrl, requestPath(modelValue.api)),
                            {
                                method: 'POST',
                                headers,
                                body: JSON.stringify({
                                    ...payload,
                                    __mvuEffectiveContextWindow: modelValue.contextWindow,
                                    __mvuEffectiveMaxTokens: modelValue.maxTokens,
                                }),
                                signal,
                            }
                        );
                        if (!response.ok) {
                            throw new Error(`Mock provider HTTP ${response.status}`);
                        }
                        const body = await response.json();
                        return makeAssistantMessage(modelValue, body.text);
                    })();

                    return {
                        async *[Symbol.asyncIterator]() {
                            const message = await completed;
                            yield { type: 'done', reason: 'stop', message };
                        },
                        result: jest.fn(() => completed),
                    };
                },
            };
        }),
    };
});

import { generateExtraModel } from '@/function/update/invoke_extra_model';
import {
    clearPiRequestControllers,
    getActivePiRequestIds,
} from '@/function/update/pi/controller_registry';
import {
    decodePromptCaptureMarker,
    getPendingPromptCaptureDiagnostics,
    PI_PROMPT_CAPTURE_API_URL,
} from '@/function/update/pi/prompt_capture';
import { useDataStore } from '@/store';

const VALID_UPDATE = "<UpdateVariable>\n_.set('boundary', 1);\n</UpdateVariable>";
const CAPTURED_MESSAGES: SillyTavern.SendingMessage[] = [
    { role: 'system', content: 'captured system boundary' },
    { role: 'user', content: 'captured user boundary' },
];
const ST_BACKEND_URL = 'https://sillytavern.test/api/backends/chat-completions/generate';

type FetchRecord = {
    url: URL;
    init: RequestInit;
    body: Record<string, any>;
};

type RouteCase = {
    route: '使用当前预设' | '使用其他预设' | '使用内置破限';
    runner: 'generate' | 'generateRaw';
    provider: 'openai' | 'anthropic';
    api: 'openai-responses' | 'anthropic-messages' | 'openai-completions';
    endpoint: string;
    expectedPath: string;
    model: string;
    contextWindow: number;
    expectedContextWindow: number;
    maxTokens: number;
};

function configurePi(config: RouteCase): ReturnType<typeof useDataStore> {
    const store = useDataStore();
    Object.assign(store.settings.额外模型解析配置, {
        模型来源: '更多' as const,
        应答格式: '聊天消息' as const,
        请求方式: '依次请求，失败后重试' as const,
        请求次数: 1,
        破限方案: config.route,
        其他预设名称: 'boundary-preset',
        密钥: 'boundary-api-key',
        最大回复token数: config.maxTokens,
        max_chat_history: 8,
    });
    Object.assign(store.settings.额外模型解析配置.pi, {
        provider: config.provider,
        api: config.api,
        authType: 'api_key' as const,
        endpoint: config.endpoint,
        model: config.model,
        contextWindow: config.contextWindow,
        customHeaders: 'X-MVU-Boundary: enabled',
        customIncludeBody: 'metadata:\n  source: boundary-test',
        customExcludeBody: '',
    });
    store.settings.通知.额外模型解析中 = false;
    return store;
}

function parseRequestBody(init?: RequestInit): Record<string, any> {
    return typeof init?.body === 'string' ? JSON.parse(init.body) : {};
}

function jsonResponse(value: unknown, status = 200): Response {
    const text = JSON.stringify(value);
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: jest.fn(async () => structuredClone(value)),
        text: jest.fn(async () => text),
    } as unknown as Response;
}

function installCaptureRunners(fetchRecords: FetchRecord[]) {
    const captureControllers = new Map<string, AbortController>();
    const stop = (globalThis as any).stopGenerationById as jest.Mock;
    stop.mockImplementation((generationId: string) => {
        const controller = captureControllers.get(generationId);
        if (!controller || controller.signal.aborted) {
            return false;
        }
        controller.abort(new DOMException('Fixed capture stopped', 'AbortError'));
        return true;
    });

    const runCapture = async (config: GenerateRawConfig) => {
        const generationId = config.generation_id ?? '';
        const controller = new AbortController();
        captureControllers.set(generationId, controller);
        await (globalThis as any).eventEmit(tavern_events.CHAT_COMPLETION_SETTINGS_READY, {
            model: config.custom_api?.model ?? '',
            messages: structuredClone(CAPTURED_MESSAGES),
        });

        return globalThis.fetch(ST_BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config),
            signal: controller.signal,
        });
    };
    (globalThis as any).generate = jest.fn(runCapture);
    (globalThis as any).generateRaw = jest.fn(runCapture);

    return { captureControllers, stop, fetchRecords };
}

function installMockNetwork(): FetchRecord[] {
    const records: FetchRecord[] = [];
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.toString());
        const body = parseRequestBody(init);
        records.push({ url, init, body });

        if (url.toString() === ST_BACKEND_URL) {
            expect(init.signal).toBeInstanceOf(AbortSignal);
            expect(init.signal!.aborted).toBe(true);
            throw init.signal!.reason;
        }
        if (url.hostname === 'platform.claude.com' && url.pathname === '/v1/oauth/token') {
            return jsonResponse({
                access_token: 'sk-ant-oat-boundary-refreshed',
                refresh_token: 'boundary-refresh-rotated',
                expires_in: 3600,
            });
        }
        if (
            url.hostname === 'api.openai.com' ||
            url.hostname.endsWith('.provider.test') ||
            url.hostname === 'api.anthropic.com'
        ) {
            return jsonResponse({ text: VALID_UPDATE });
        }
        throw new Error(`Unexpected network target: ${url.origin}${url.pathname}`);
    }) as typeof fetch;
    return records;
}

function expectFixedCapture(record: FetchRecord, providerNeedles: readonly string[]): void {
    expect(record.url.toString()).toBe(ST_BACKEND_URL);
    expect(record.init.signal).toBeInstanceOf(AbortSignal);
    expect(record.init.signal!.aborted).toBe(true);
    expect(record.body).toEqual(
        expect.objectContaining({
            should_stream: false,
            should_silence: false,
            tools: [],
            tool_choice: 'none',
            custom_api: {
                source: 'custom',
                apiurl: PI_PROMPT_CAPTURE_API_URL,
                key: '',
                model: expect.any(String),
                custom_include_body: {},
                custom_exclude_body: [],
                custom_include_headers: {},
            },
        })
    );
    expect(record.body).not.toHaveProperty('json_schema');
    expect(decodePromptCaptureMarker(record.body.custom_api.model)).toBe(record.body.generation_id);
    const serialized = JSON.stringify(record.body);
    for (const needle of providerNeedles) {
        expect(serialized).not.toContain(needle);
    }
}

describe('requestReply production Pi capture/runtime boundary', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        jest.clearAllMocks();
        clearPiRequestControllers();
        delete globalThis.__MVU_PI_MULTIPROVIDER_ENABLED__;
        (globalThis as any).getPresetNames = jest.fn().mockReturnValue(['boundary-preset']);
        (globalThis as any).getPreset = jest.fn().mockReturnValue({
            prompts: [
                {
                    id: 'boundary-relative',
                    enabled: true,
                    position: { type: 'relative' },
                    role: 'system',
                    content: 'BOUNDARY_PRESET_PROMPT',
                },
            ],
        });
        (globalThis as any).SillyTavern.getChatCompletionModel = jest
            .fn()
            .mockReturnValue('legacy-st-model');
        (globalThis as any).SillyTavern.chat = [{ mes: 'unchanged chat sentinel' }];
        ((globalThis as any).SillyTavern.saveChat as jest.Mock).mockClear();
        ((globalThis as any).setChatMessage as jest.Mock).mockClear();
        ((globalThis as any).setChatMessages as jest.Mock).mockClear();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        delete (globalThis as any).generate;
        delete (globalThis as any).generateRaw;
        delete (globalThis as any).getPreset;
        delete (globalThis as any).getPresetNames;
        delete (globalThis as any).SillyTavern.getChatCompletionModel;
        expect(getPendingPromptCaptureDiagnostics()).toEqual([]);
        expect(getActivePiRequestIds()).toEqual([]);
    });

    test.each([
        {
            route: '使用当前预设',
            runner: 'generate',
            provider: 'openai',
            api: 'openai-responses',
            endpoint: '',
            expectedPath: '/v1/responses',
            model: 'gpt-catalog',
            contextWindow: 64_000,
            expectedContextWindow: 64_000,
            maxTokens: 1024,
        },
        {
            route: '使用其他预设',
            runner: 'generateRaw',
            provider: 'anthropic',
            api: 'anthropic-messages',
            endpoint: 'https://anthropic.provider.test',
            expectedPath: '/v1/messages',
            model: 'claude-boundary-custom',
            contextWindow: 24_000,
            expectedContextWindow: 24_000,
            maxTokens: 768,
        },
        {
            route: '使用内置破限',
            runner: 'generateRaw',
            provider: 'openai',
            api: 'openai-completions',
            endpoint: 'https://chat.provider.test/v1',
            expectedPath: '/v1/chat/completions',
            model: 'chat-boundary-custom',
            contextWindow: 32_000,
            expectedContextWindow: 32_000,
            maxTokens: 512,
        },
    ] satisfies RouteCase[])('$route captures once and dispatches $api safely', async config => {
        const store = configurePi(config);
        const chatSnapshot = structuredClone((globalThis as any).SillyTavern.chat);
        const records = installMockNetwork();
        installCaptureRunners(records);

        await expect(generateExtraModel()).resolves.toBe(VALID_UPDATE);

        const expectedRunner = (globalThis as any)[config.runner] as jest.Mock;
        const otherRunner = (globalThis as any)[
            config.runner === 'generate' ? 'generateRaw' : 'generate'
        ] as jest.Mock;
        expect(expectedRunner).toHaveBeenCalledTimes(1);
        expect(otherRunner).not.toHaveBeenCalled();
        const captureConfig = expectedRunner.mock.calls[0][0] as GenerateRawConfig;
        expect(captureConfig.json_schema).toBeUndefined();
        if (config.route === '使用当前预设') {
            expect(captureConfig.injects).toHaveLength(3);
        } else if (config.route === '使用其他预设') {
            expect(captureConfig.ordered_prompts).toContainEqual({
                role: 'system',
                content: 'BOUNDARY_PRESET_PROMPT',
            });
        } else {
            expect(captureConfig.ordered_prompts).toContain('chat_history');
        }

        expect(records).toHaveLength(2);
        expectFixedCapture(
            records[1],
            ['boundary-api-key', config.endpoint, config.model].filter(Boolean)
        );

        const providerRecord = records[0];
        expect(providerRecord.url.pathname).toBe(config.expectedPath);
        expect(providerRecord.init.signal).toBeInstanceOf(AbortSignal);
        expect(providerRecord.init.signal!.aborted).toBe(false);
        expect(providerRecord.body).toMatchObject({
            model: config.model,
            stream: true,
            __mvuEffectiveContextWindow: config.expectedContextWindow,
            __mvuEffectiveMaxTokens: config.maxTokens,
            metadata: { source: 'boundary-test' },
        });
        expect(JSON.stringify(providerRecord.body.input ?? providerRecord.body.messages)).toContain(
            'captured user boundary'
        );
        expect(JSON.stringify(providerRecord.body)).not.toContain(VALID_UPDATE);
        expect(new Headers(providerRecord.init.headers).get('X-MVU-Boundary')).toBe('enabled');
        if (config.api === 'anthropic-messages') {
            expect(new Headers(providerRecord.init.headers).get('x-api-key')).toBe(
                'boundary-api-key'
            );
        } else {
            expect(new Headers(providerRecord.init.headers).get('Authorization')).toBe(
                'Bearer boundary-api-key'
            );
        }

        expect(store.settings.额外模型解析配置.pi.model).toBe(config.model);
        expect(CAPTURED_MESSAGES).toEqual([
            { role: 'system', content: 'captured system boundary' },
            { role: 'user', content: 'captured user boundary' },
        ]);
        expect((globalThis as any).SillyTavern.chat).toEqual(chatSnapshot);
        expect((globalThis as any).SillyTavern.saveChat).not.toHaveBeenCalled();
        expect((globalThis as any).setChatMessage).not.toHaveBeenCalled();
        expect((globalThis as any).setChatMessages).not.toHaveBeenCalled();
    });

    test('automatically refreshes an expired OAuth credential before the Anthropic request', async () => {
        const config: RouteCase = {
            route: '使用内置破限',
            runner: 'generateRaw',
            provider: 'anthropic',
            api: 'anthropic-messages',
            endpoint: '',
            expectedPath: '/v1/messages',
            model: 'claude-catalog',
            contextWindow: 0,
            expectedContextWindow: 200_000,
            maxTokens: 1024,
        };
        const store = configurePi(config);
        store.settings.额外模型解析配置.密钥 = '';
        store.settings.额外模型解析配置.pi.authType = 'oauth';
        store.settings.额外模型解析配置.pi.credentials.anthropic = {
            type: 'oauth',
            access: 'sk-ant-oat-boundary-expired',
            refresh: 'boundary-refresh-old',
            expires: Date.now() - 1,
        };
        const records = installMockNetwork();
        installCaptureRunners(records);

        await expect(generateExtraModel()).resolves.toBe(VALID_UPDATE);

        expect(records).toHaveLength(3);
        expectFixedCapture(records[2], [
            'sk-ant-oat-boundary-expired',
            'boundary-refresh-old',
            'claude-catalog',
        ]);
        expect(records[0].url.toString()).toBe('https://platform.claude.com/v1/oauth/token');
        expect(records[0].body).toMatchObject({
            grant_type: 'refresh_token',
            refresh_token: 'boundary-refresh-old',
        });
        expect(records[0].init.signal).toBeInstanceOf(AbortSignal);
        expect(records[0].init.signal!.aborted).toBe(false);

        expect(records[1].url.pathname).toBe('/v1/messages');
        expect(records[1].body).toMatchObject({
            __mvuEffectiveContextWindow: 200_000,
            __mvuEffectiveMaxTokens: 1024,
        });
        expect(new Headers(records[1].init.headers).get('Authorization')).toBe(
            'Bearer sk-ant-oat-boundary-refreshed'
        );
        expect(new Headers(records[1].init.headers).has('x-api-key')).toBe(false);
        expect(store.settings.额外模型解析配置.pi.credentials.anthropic).toMatchObject({
            type: 'oauth',
            access: 'sk-ant-oat-boundary-refreshed',
            refresh: 'boundary-refresh-rotated',
        });
    });

    test.each([
        ['provider/API mismatch', { provider: 'openai', api: 'anthropic-messages' }],
        ['unsupported auth', { provider: 'openai', authType: 'oauth' }],
        [
            'unknown model without manual context window',
            { model: 'unknown-no-context', contextWindow: 0 },
        ],
        ['max tokens above context', { contextWindow: 256, maxTokens: 512 }],
    ])('rejects %s before prompt capture or provider fetch', async (_case, overrides) => {
        const config: RouteCase = {
            route: '使用内置破限',
            runner: 'generateRaw',
            provider: 'openai',
            api: 'openai-responses',
            endpoint: 'https://invalid.provider.test/v1',
            expectedPath: '/v1/responses',
            model: 'unknown-valid-context',
            contextWindow: 16_384,
            expectedContextWindow: 16_384,
            maxTokens: 1024,
            ...overrides,
        } as RouteCase;
        const store = configurePi(config);
        Object.assign(store.settings.额外模型解析配置.pi, overrides);
        if ('maxTokens' in overrides) {
            store.settings.额外模型解析配置.最大回复token数 = overrides.maxTokens as number;
        }
        const records = installMockNetwork();
        installCaptureRunners(records);

        await expect(generateExtraModel()).rejects.toBeInstanceOf(Error);

        expect((globalThis as any).generate).not.toHaveBeenCalled();
        expect((globalThis as any).generateRaw).not.toHaveBeenCalled();
        expect(records).toEqual([]);
    });

    test.each(['与插头相同', '自定义'] as const)(
        'keeps legacy source %s away from Pi capture and provider transport',
        async source => {
            const store = useDataStore();
            store.versions.tavernhelper = '4.8.13';
            Object.assign(store.settings.额外模型解析配置, {
                模型来源: source,
                应答格式: '聊天消息',
                请求方式: '依次请求，失败后重试',
                请求次数: 1,
                破限方案: '使用内置破限',
            });
            const records = installMockNetwork();
            (globalThis as any).generate = jest.fn().mockResolvedValue(VALID_UPDATE);
            (globalThis as any).generateRaw = jest.fn().mockResolvedValue(VALID_UPDATE);

            await expect(generateExtraModel()).resolves.toBe(VALID_UPDATE);

            expect((globalThis as any).generateRaw).toHaveBeenCalledTimes(1);
            const legacyConfig = (globalThis as any).generateRaw.mock.calls[0][0];
            expect(legacyConfig.custom_api?.apiurl).not.toBe(PI_PROMPT_CAPTURE_API_URL);
            expect(decodePromptCaptureMarker(legacyConfig.custom_api?.model)).toBeNull();
            expect(records).toEqual([]);
        }
    );
});
