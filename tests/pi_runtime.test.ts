jest.mock('@/function/update/pi/pi_gateway', () => {
    const api = (name: string) => ({
        name,
        stream: jest.fn(),
        streamSimple: jest.fn(),
    });
    const model = (
        id: string,
        wireApi: string,
        provider: string,
        contextWindow: number,
        maxTokens: number,
        input: readonly string[] = ['text'],
        compat?: Record<string, unknown>
    ) => ({
        id,
        name: id,
        api: wireApi,
        provider,
        baseUrl:
            provider === 'openai'
                ? 'https://api.openai.com/v1'
                : provider === 'anthropic'
                  ? 'https://api.anthropic.com'
                  : provider === 'google'
                    ? 'https://generativelanguage.googleapis.com/v1beta'
                    : 'https://chatgpt.com/backend-api',
        reasoning: false,
        input,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens,
        ...(compat === undefined ? {} : { compat }),
    });

    return {
        createModels: jest.fn(),
        createProvider: jest.fn(input => input),
        OPENAI_MODELS: {
            'gpt-known': model('gpt-known', 'openai-responses', 'openai', 128_000, 8192, [
                'text',
                'image',
            ]),
        },
        OPENAI_CODEX_MODELS: {
            'codex-known': model(
                'codex-known',
                'openai-codex-responses',
                'openai-codex',
                200_000,
                32_000
            ),
        },
        ANTHROPIC_MODELS: {
            'claude-known': model(
                'claude-known',
                'anthropic-messages',
                'anthropic',
                200_000,
                8192,
                ['text', 'image'],
                { supportsTemperature: false }
            ),
            'claude-legacy': model(
                'claude-legacy',
                'anthropic-messages',
                'anthropic',
                200_000,
                8192,
                ['text', 'image']
            ),
        },
        GOOGLE_MODELS: {
            'gemini-known': model(
                'gemini-known',
                'google-generative-ai',
                'google',
                1_000_000,
                65_536,
                ['text', 'image']
            ),
        },
        openAIResponsesApi: jest.fn(() => api('openai-responses')),
        openAICompletionsApi: jest.fn(() => api('openai-completions')),
        openAICodexResponsesApi: jest.fn(() => api('openai-codex-responses')),
        anthropicMessagesApi: jest.fn(() => api('anthropic-messages')),
        googleGenerativeAIApi: jest.fn(() => api('google-generative-ai')),
    };
});

import {
    beginPiRequestAttempt,
    clearPiRequestControllers,
    getActivePiRequestIds,
    PiRequestAbortedError,
    stopExtraModelRequestById,
} from '@/function/update/pi/controller_registry';
import {
    capturePrompt,
    getPendingPromptCaptureDiagnostics,
} from '@/function/update/pi/prompt_capture';
import type {
    AssistantMessage,
    AssistantMessageEvent,
    Credential,
    CredentialStore,
} from '@/function/update/pi/pi_gateway';
import { createModels, createProvider } from '@/function/update/pi/pi_gateway';
import {
    assertPiRuntimeConfiguration,
    isNonRetryablePiRuntimeError,
    PiRuntimeError,
    runPiRequest,
} from '@/function/update/pi/runtime';

function makeCredentialStore(credential?: Credential): CredentialStore {
    return {
        read: jest.fn(async () => credential),
        list: jest.fn(async () => []),
        modify: jest.fn(async (_provider, update) => update(credential)),
        delete: jest.fn(async () => undefined),
    };
}

function makeSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const { pi: _pi, ...settingOverrides } = overrides;
    const piOverrides =
        typeof overrides.pi === 'object' && overrides.pi !== null
            ? (overrides.pi as Record<string, unknown>)
            : {};
    return {
        应答格式: '聊天消息',
        密钥: 'test-api-key',
        最大回复token数: 1024,
        温度: 0.7,
        top_p: 0.8,
        top_k: 0,
        频率惩罚: 0.1,
        存在惩罚: -0.1,
        pi: {
            provider: 'openai',
            api: 'openai-responses',
            authType: 'api_key',
            endpoint: '',
            model: 'gpt-known',
            contextWindow: 0,
            customHeaders: '',
            customIncludeBody: '',
            customExcludeBody: '',
            ...piOverrides,
        },
        ...settingOverrides,
    };
}

function usage() {
    return {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
}

function assistant(
    content: AssistantMessage['content'],
    stopReason: AssistantMessage['stopReason'] = 'stop',
    errorMessage?: string
): AssistantMessage {
    return {
        role: 'assistant',
        content,
        api: 'openai-responses',
        provider: 'openai',
        model: 'gpt-known',
        usage: usage(),
        stopReason,
        errorMessage,
        timestamp: 1,
    };
}

function fakeStream(message: AssistantMessage, events?: AssistantMessageEvent[]) {
    const streamEvents =
        events ??
        (message.stopReason === 'error' || message.stopReason === 'aborted'
            ? [{ type: 'error', reason: message.stopReason, error: message }]
            : [{ type: 'done', reason: message.stopReason, message }]);
    return {
        async *[Symbol.asyncIterator]() {
            for (const event of streamEvents) {
                yield event;
            }
        },
        result: jest.fn(async () => message),
    };
}

const TOOL = {
    type: 'function',
    function: {
        name: 'mvu_update',
        description: 'Update variables',
        parameters: {
            type: 'object',
            additionalProperties: false,
            properties: { value: { type: 'string' } },
            required: ['value'],
        },
    },
} satisfies ToolDefinition;

const JSON_SCHEMA = {
    name: 'mvu_result',
    strict: true,
    value: {
        type: 'object',
        properties: { result: { type: 'string' } },
        required: ['result'],
    },
};

describe('pi runtime preflight', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearPiRequestControllers();
    });

    afterEach(() => clearPiRequestControllers());

    test('resolves and snapshots API-key request configuration without messages', async () => {
        const credentialStore = makeCredentialStore();
        const preflight = await assertPiRuntimeConfiguration({
            settings: makeSettings({
                pi: {
                    provider: 'openai',
                    api: 'openai-responses',
                    authType: 'api_key',
                    endpoint: '',
                    model: 'gpt-known',
                    contextWindow: 0,
                    customHeaders: 'X-MVU: runtime-test',
                    customIncludeBody: 'metadata:\n  source: mvu',
                    customExcludeBody: '- store',
                },
            }),
            credentialStore,
        });

        expect(preflight).toMatchObject({
            responseFormat: '聊天消息',
            headers: { 'X-MVU': 'runtime-test' },
            customIncludeBody: { metadata: { source: 'mvu' } },
            customExcludeBody: ['store'],
            temperature: 0.7,
        });
        expect(preflight.sampling).toEqual({ topP: 0.8 });
        expect(preflight.resolution.model).toMatchObject({
            provider: 'openai',
            api: 'openai-responses',
            maxTokens: 1024,
        });
        expect(credentialStore.read).not.toHaveBeenCalled();
        expect(Object.isFrozen(preflight)).toBe(true);
    });

    test('validates Google custom body against its SDK config envelope', async () => {
        const credentialStore = makeCredentialStore();
        const preflight = await assertPiRuntimeConfiguration({
            settings: makeSettings({
                pi: {
                    provider: 'google',
                    api: 'google-generative-ai',
                    authType: 'api_key',
                    model: 'gemini-known',
                    customIncludeBody:
                        'config:\n  safetySettings:\n    - category: HARM_CATEGORY_HATE_SPEECH\n      threshold: OFF',
                    customExcludeBody: '- config.stopSequences',
                },
            }),
            credentialStore,
        });

        expect(preflight.customIncludeBody).toEqual({
            config: {
                safetySettings: [{ category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' }],
            },
        });
        expect(preflight.customExcludeBody).toEqual(['config.stopSequences']);

        await expect(
            assertPiRuntimeConfiguration({
                settings: makeSettings({
                    pi: {
                        provider: 'google',
                        api: 'google-generative-ai',
                        authType: 'api_key',
                        model: 'gemini-known',
                        customIncludeBody: 'safetySettings: []',
                    },
                }),
                credentialStore,
            })
        ).rejects.toMatchObject({ code: 'invalid_configuration' });
    });

    test('requires an OAuth credential before dispatch', async () => {
        const credentialStore = makeCredentialStore();
        const promise = assertPiRuntimeConfiguration({
            settings: makeSettings({
                密钥: '',
                pi: {
                    provider: 'openai-codex',
                    api: 'openai-codex-responses',
                    authType: 'oauth',
                    endpoint: '',
                    model: 'codex-known',
                    contextWindow: 0,
                    customHeaders: '',
                    customIncludeBody: '',
                    customExcludeBody: '',
                },
            }),
            credentialStore,
        });

        await expect(promise).rejects.toMatchObject({
            name: 'PiRuntimeError',
            code: 'missing_oauth_credential',
            retryable: false,
        });
        expect(credentialStore.read).toHaveBeenCalledWith('openai-codex', {
            signal: undefined,
        });
    });

    test('rejects unsupported structured output before credentials or streaming', async () => {
        const credentialStore = makeCredentialStore();
        const promise = assertPiRuntimeConfiguration({
            settings: makeSettings({
                应答格式: '格式化输出',
                pi: {
                    provider: 'anthropic',
                    api: 'anthropic-messages',
                    authType: 'api_key',
                    endpoint: '',
                    model: 'claude-known',
                    contextWindow: 0,
                    customHeaders: '',
                    customIncludeBody: '',
                    customExcludeBody: '',
                },
            }),
            jsonSchema: JSON_SCHEMA,
            credentialStore,
        });

        await expect(promise).rejects.toMatchObject({
            code: 'unsupported_capability',
            retryable: false,
        });
        expect(createModels).not.toHaveBeenCalled();
        expect(credentialStore.read).not.toHaveBeenCalled();
    });

    test('fails closed for native capabilities on uncatalogued model ids', async () => {
        const promise = assertPiRuntimeConfiguration({
            settings: makeSettings({
                应答格式: '格式化输出',
                pi: {
                    provider: 'openai',
                    api: 'openai-responses',
                    authType: 'api_key',
                    endpoint: 'http://127.0.0.1:8080/v1',
                    model: 'uncatalogued-model',
                    contextWindow: 16_384,
                    customHeaders: '',
                    customIncludeBody: '',
                    customExcludeBody: '',
                },
            }),
            jsonSchema: JSON_SCHEMA,
            credentialStore: makeCredentialStore(),
        });

        await expect(promise).rejects.toMatchObject({
            code: 'unsupported_capability',
            retryable: false,
        });
        expect(createModels).not.toHaveBeenCalled();
    });

    test('filters sampling fields and temperature using API/model metadata', async () => {
        const preflight = await assertPiRuntimeConfiguration({
            settings: makeSettings({
                top_k: 32,
                pi: {
                    provider: 'anthropic',
                    api: 'anthropic-messages',
                    authType: 'api_key',
                    endpoint: '',
                    model: 'claude-known',
                    contextWindow: 0,
                    customHeaders: '',
                    customIncludeBody: '',
                    customExcludeBody: '',
                },
            }),
            credentialStore: makeCredentialStore(),
        });

        expect(preflight.temperature).toBeUndefined();
        expect(preflight.sampling).toEqual({});
    });

    test('validates only sampling fields that the selected model will send', async () => {
        const disabled = await assertPiRuntimeConfiguration({
            settings: makeSettings({
                温度: 'retained-invalid-temperature',
                top_p: 'retained-invalid-top-p',
                top_k: 1.5,
                pi: {
                    provider: 'anthropic',
                    api: 'anthropic-messages',
                    authType: 'api_key',
                    endpoint: '',
                    model: 'claude-known',
                    contextWindow: 0,
                    customHeaders: '',
                    customIncludeBody: '',
                    customExcludeBody: '',
                },
            }),
            credentialStore: makeCredentialStore(),
        });

        expect(disabled.temperature).toBeUndefined();
        expect(disabled.sampling).toEqual({});

        await expect(
            assertPiRuntimeConfiguration({
                settings: makeSettings({
                    温度: 1.5,
                    pi: {
                        provider: 'anthropic',
                        api: 'anthropic-messages',
                        authType: 'api_key',
                        endpoint: '',
                        model: 'claude-legacy',
                        contextWindow: 0,
                        customHeaders: '',
                        customIncludeBody: '',
                        customExcludeBody: '',
                    },
                }),
                credentialStore: makeCredentialStore(),
            })
        ).rejects.toMatchObject({ code: 'invalid_configuration' });
    });

    test('prepares constrained MVU tools and API-specific required choice', async () => {
        const preflight = await assertPiRuntimeConfiguration({
            settings: makeSettings({ 应答格式: '工具调用' }),
            tools: [TOOL],
            credentialStore: makeCredentialStore(),
        });

        expect(preflight.tools).toEqual([
            expect.objectContaining({
                name: 'mvu_update',
                constrainedSampling: { type: 'json_schema', strict: 'prefer' },
            }),
        ]);
        expect(preflight.toolChoice).toBe('required');
    });
});

describe('pi runtime execution', () => {
    const setProvider = jest.fn();
    const stream = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        clearPiRequestControllers();
        jest.mocked(createModels).mockReturnValue({ setProvider, stream } as never);
    });

    afterEach(() => clearPiRequestControllers());

    test('creates a browser-safe provider, streams progress, and maps request payload fields', async () => {
        const final = assistant([{ type: 'text', text: 'done' }]);
        const events: AssistantMessageEvent[] = [
            { type: 'start', partial: assistant([], 'pending') },
            { type: 'text_delta', contentIndex: 0, delta: 'done', partial: final },
            { type: 'done', reason: 'stop', message: final },
        ];
        stream.mockReturnValue(fakeStream(final, events));
        const credentialStore = makeCredentialStore();
        const preflight = await assertPiRuntimeConfiguration({
            settings: makeSettings({
                pi: {
                    provider: 'openai',
                    api: 'openai-responses',
                    authType: 'api_key',
                    endpoint: '',
                    model: 'gpt-known',
                    contextWindow: 0,
                    customHeaders: 'X-MVU: runtime-test',
                    customIncludeBody: 'metadata:\n  source: mvu',
                    customExcludeBody: '- store',
                },
            }),
            credentialStore,
        });
        const messages: SillyTavern.SendingMessage[] = [
            { role: 'system', content: 'system rule' },
            { role: 'user', content: 'hello' },
        ];
        const snapshot = structuredClone(messages);
        const onProgress = jest.fn();

        await expect(
            runPiRequest({
                preflight,
                messages,
                generationId: 'runtime-success',
                onProgress,
            })
        ).resolves.toBe('done');

        expect(messages).toEqual(snapshot);
        expect(onProgress).toHaveBeenCalledTimes(3);
        expect(createModels).toHaveBeenCalledWith({
            credentials: credentialStore,
            authContext: {
                env: expect.any(Function),
                fileExists: expect.any(Function),
            },
        });
        expect(createProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'openai',
                models: [preflight.resolution.model],
                auth: { apiKey: expect.objectContaining({ resolve: expect.any(Function) }) },
                api: expect.objectContaining({
                    'openai-responses': expect.any(Object),
                    'openai-completions': expect.any(Object),
                }),
            })
        );

        const [, context, options] = stream.mock.calls[0];
        expect(context).toEqual({
            systemPrompt: 'system rule',
            messages: [{ role: 'user', content: 'hello', timestamp: expect.any(Number) }],
        });
        expect(options).toMatchObject({
            apiKey: 'test-api-key',
            headers: { 'X-MVU': 'runtime-test' },
            temperature: 0.7,
            maxTokens: 1024,
            signal: expect.any(AbortSignal),
        });
        expect(options.onPayload({ model: 'gpt-known', store: true, input: [] })).toEqual({
            model: 'gpt-known',
            input: [],
            top_p: 0.8,
            metadata: { source: 'mvu' },
        });
        expect(getActivePiRequestIds()).toEqual([]);
    });

    test('never starts the provider when stop lands after capture resolves but before runtime registration', async () => {
        const generationId = 'capture-runtime-gap';
        const attempt = beginPiRequestAttempt(generationId);
        const capture = await capturePrompt(
            async (config: GenerateConfig) => {
                await (globalThis as any).eventEmit(tavern_events.CHAT_COMPLETION_SETTINGS_READY, {
                    model: config.custom_api?.model ?? '',
                    messages: [{ role: 'user', content: 'captured prompt' }],
                });
                throw new Error('fixed prompt-capture fetch failure');
            },
            { generation_id: generationId }
        );
        expect(capture.generationId).toBe(generationId);
        expect(getPendingPromptCaptureDiagnostics()).toEqual([]);

        expect(stopExtraModelRequestById(generationId, 'concurrent winner selected')).toBe(true);
        expect(attempt.signal.aborted).toBe(true);

        try {
            await expect(
                runPiRequest({
                    preflight: await assertPiRuntimeConfiguration({
                        settings: makeSettings(),
                        credentialStore: makeCredentialStore(),
                    }),
                    messages: capture.messages,
                    generationId,
                })
            ).rejects.toBeInstanceOf(PiRequestAbortedError);
        } finally {
            attempt.release();
        }

        expect(createModels).not.toHaveBeenCalled();
        expect(stream).not.toHaveBeenCalled();
        expect(getActivePiRequestIds()).toEqual([]);
    });

    test('never starts the provider when teardown lands while prompt capture owns the attempt', async () => {
        const generationId = 'capture-teardown-gap';
        const attempt = beginPiRequestAttempt(generationId);
        const capture = await capturePrompt(
            async (config: GenerateConfig) => {
                await (globalThis as any).eventEmit(tavern_events.CHAT_COMPLETION_SETTINGS_READY, {
                    model: config.custom_api?.model ?? '',
                    messages: [{ role: 'user', content: 'captured before teardown' }],
                });
                throw new Error('fixed prompt-capture fetch failure');
            },
            { generation_id: generationId }
        );

        clearPiRequestControllers();
        expect(attempt.signal.aborted).toBe(true);
        expect(getActivePiRequestIds()).toEqual([generationId]);

        try {
            await expect(
                runPiRequest({
                    preflight: await assertPiRuntimeConfiguration({
                        settings: makeSettings(),
                        credentialStore: makeCredentialStore(),
                    }),
                    messages: capture.messages,
                    generationId,
                })
            ).rejects.toBeInstanceOf(PiRequestAbortedError);
        } finally {
            attempt.release();
        }

        expect(createModels).not.toHaveBeenCalled();
        expect(stream).not.toHaveBeenCalled();
        expect(getActivePiRequestIds()).toEqual([]);
    });

    test('uses native structured output without converting it to a tool', async () => {
        const final = assistant([{ type: 'text', text: '{"result":"ok"}' }]);
        stream.mockReturnValue(fakeStream(final));
        const preflight = await assertPiRuntimeConfiguration({
            settings: makeSettings({ 应答格式: '格式化输出' }),
            jsonSchema: JSON_SCHEMA,
            credentialStore: makeCredentialStore(),
        });

        await runPiRequest({
            preflight,
            messages: [{ role: 'user', content: 'return json' }],
            generationId: 'runtime-structured',
        });

        const [, context, options] = stream.mock.calls[0];
        expect(context.tools).toBeUndefined();
        expect(options.toolChoice).toBeUndefined();
        expect(options.onPayload({ input: [] })).toMatchObject({
            text: {
                format: {
                    type: 'json_schema',
                    name: 'mvu_result',
                    schema: JSON_SCHEMA.value,
                    strict: true,
                },
            },
        });
    });

    test('wires browser OAuth and the shared credential store into pi Models', async () => {
        const final = assistant([{ type: 'text', text: 'oauth response' }]);
        stream.mockReturnValue(fakeStream(final));
        const credentialStore = makeCredentialStore({
            type: 'oauth',
            access: 'header.payload.signature',
            refresh: 'refresh-token',
            expires: Date.now() + 60 * 60 * 1000,
        });
        const preflight = await assertPiRuntimeConfiguration({
            settings: makeSettings({
                密钥: '',
                pi: {
                    provider: 'openai-codex',
                    api: 'openai-codex-responses',
                    authType: 'oauth',
                    endpoint: '',
                    model: 'codex-known',
                    contextWindow: 0,
                    customHeaders: '',
                    customIncludeBody: '',
                    customExcludeBody: '',
                },
            }),
            credentialStore,
        });

        await expect(
            runPiRequest({
                preflight,
                messages: [{ role: 'user', content: 'hello' }],
                generationId: 'runtime-oauth',
            })
        ).resolves.toBe('oauth response');

        expect(credentialStore.read).toHaveBeenCalledWith('openai-codex', {
            signal: undefined,
        });
        expect(createModels).toHaveBeenCalledWith(
            expect.objectContaining({ credentials: credentialStore })
        );
        expect(createProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'openai-codex',
                auth: {
                    oauth: expect.objectContaining({
                        login: expect.any(Function),
                        refresh: expect.any(Function),
                        toAuth: expect.any(Function),
                    }),
                },
            })
        );
        const streamOptions = stream.mock.calls[0][2];
        expect(streamOptions.apiKey).toBeUndefined();
        expect(preflight.temperature).toBeUndefined();
        expect(streamOptions.temperature).toBeUndefined();
        expect(streamOptions.onPayload({ model: 'codex-known', input: [] })).not.toHaveProperty(
            'temperature'
        );
    });

    test('normalizes a Pi tool-call result back to the existing MVU shape', async () => {
        const final = assistant(
            [
                { type: 'text', text: 'updated' },
                {
                    type: 'toolCall',
                    id: 'call-1',
                    name: 'mvu_update',
                    arguments: { value: 'ok' },
                },
            ],
            'toolUse'
        );
        stream.mockReturnValue(fakeStream(final));
        const preflight = await assertPiRuntimeConfiguration({
            settings: makeSettings({ 应答格式: '工具调用' }),
            tools: [TOOL],
            credentialStore: makeCredentialStore(),
        });

        await expect(
            runPiRequest({
                preflight,
                messages: [{ role: 'user', content: 'update' }],
                generationId: 'runtime-tool',
            })
        ).resolves.toEqual({
            content: 'updated',
            tool_calls: [
                {
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'mvu_update', arguments: '{"value":"ok"}' },
                },
            ],
        });
        expect(stream.mock.calls[0][1].tools[0]).toMatchObject({
            name: 'mvu_update',
            constrainedSampling: { type: 'json_schema', strict: 'prefer' },
        });
        expect(stream.mock.calls[0][2].toolChoice).toBe('required');
    });

    test('rejects unsupported images and token overflow as stable non-retryable errors', async () => {
        const dynamicPreflight = await assertPiRuntimeConfiguration({
            settings: makeSettings({
                最大回复token数: 20,
                pi: {
                    provider: 'openai',
                    api: 'openai-responses',
                    authType: 'api_key',
                    endpoint: 'http://127.0.0.1:8080/v1',
                    model: 'dynamic-text-only',
                    contextWindow: 100,
                    customHeaders: '',
                    customIncludeBody: '',
                    customExcludeBody: '',
                },
            }),
            credentialStore: makeCredentialStore(),
        });
        const imagePromise = runPiRequest({
            preflight: dynamicPreflight,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image_url',
                            image_url: {
                                url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfG8AAAAASUVORK5CYII=',
                                detail: 'auto',
                            },
                        },
                    ],
                },
            ],
            generationId: 'runtime-image',
        });
        const imageError = await imagePromise.catch(error => error);
        expect(imageError).toMatchObject({
            name: 'PiRuntimeError',
            code: 'unsupported_image_input',
            retryable: false,
        });
        expect(isNonRetryablePiRuntimeError(imageError)).toBe(true);

        const tokenPromise = runPiRequest({
            preflight: dynamicPreflight,
            messages: [{ role: 'user', content: 'x'.repeat(1000) }],
            generationId: 'runtime-token',
        });
        const tokenError = await tokenPromise.catch(error => error);
        expect(tokenError).toMatchObject({ code: 'token_budget', retryable: false });
        expect(isNonRetryablePiRuntimeError(tokenError)).toBe(true);
        expect(stream).not.toHaveBeenCalled();
        expect(getActivePiRequestIds()).toEqual([]);
    });

    test('normalizes browser network failures as retryable without leaking provider details', async () => {
        stream.mockReturnValue(
            fakeStream(assistant([], 'error', 'TypeError: Failed to fetch authorization=secret'))
        );
        const preflight = await assertPiRuntimeConfiguration({
            settings: makeSettings(),
            credentialStore: makeCredentialStore(),
        });

        const error = await runPiRequest({
            preflight,
            messages: [{ role: 'user', content: 'hello' }],
            generationId: 'runtime-network',
        }).catch(cause => cause);

        expect(error).toBeInstanceOf(PiRuntimeError);
        expect(error).toMatchObject({ code: 'network', retryable: true });
        expect(error.message).toContain('CORS');
        expect(error.message).not.toContain('secret');
        expect(isNonRetryablePiRuntimeError(error)).toBe(false);
        expect(getActivePiRequestIds()).toEqual([]);
    });

    test('sanitizes ordinary provider failures before throwing or notifying abort listeners', async () => {
        const secret = 'sk-live-provider-secret-token';
        let abortReason: unknown;
        stream.mockImplementation((_model, _context, options) => {
            options.signal.addEventListener(
                'abort',
                () => {
                    abortReason = options.signal.reason;
                },
                { once: true }
            );
            return fakeStream(
                assistant([], 'error', `Unauthorized: Bearer ${secret}; api_key=${secret}`)
            );
        });
        const preflight = await assertPiRuntimeConfiguration({
            settings: makeSettings(),
            credentialStore: makeCredentialStore(),
        });
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        const onProgress = jest.fn();

        const error = await runPiRequest({
            preflight,
            messages: [{ role: 'user', content: 'hello' }],
            generationId: 'runtime-provider-error',
            onProgress,
        }).catch(cause => cause);

        expect(error).toBeInstanceOf(PiRuntimeError);
        expect(error).toMatchObject({ code: 'provider', retryable: true });
        expect(String(error)).not.toContain(secret);
        expect(error).not.toHaveProperty('cause');
        expect(abortReason).toBe(error);
        expect(String(abortReason)).not.toContain(secret);
        expect(onProgress).not.toHaveBeenCalled();
        expect(JSON.stringify(onProgress.mock.calls)).not.toContain(secret);
        expect(JSON.stringify(onProgress.mock.calls)).not.toContain('Bearer');
        expect(JSON.stringify(onProgress.mock.calls)).not.toContain('sk-live');
        expect(consoleError).not.toHaveBeenCalled();
        expect(getActivePiRequestIds()).toEqual([]);

        consoleError.mockRestore();
    });

    test('sanitizes unknown SDK failures without changing explicit runtime errors', async () => {
        const secret = 'oauth-refresh-secret';
        stream.mockImplementationOnce(() => {
            throw new Error(`SDK rejected refresh_token=${secret}`);
        });
        const preflight = await assertPiRuntimeConfiguration({
            settings: makeSettings(),
            credentialStore: makeCredentialStore(),
        });

        const sdkError = await runPiRequest({
            preflight,
            messages: [{ role: 'user', content: 'hello' }],
            generationId: 'runtime-sdk-error',
        }).catch(cause => cause);

        expect(sdkError).toMatchObject({ code: 'provider', retryable: true });
        expect(String(sdkError)).not.toContain(secret);

        const explicitError = new PiRuntimeError(
            'unsupported_capability',
            'A deterministic local capability error'
        );
        stream.mockImplementationOnce(() => {
            throw explicitError;
        });
        await expect(
            runPiRequest({
                preflight,
                messages: [{ role: 'user', content: 'hello' }],
                generationId: 'runtime-explicit-error',
            })
        ).rejects.toBe(explicitError);
    });

    test('converts every aborted terminal state to PiRequestAbortedError and releases the id', async () => {
        const upstreamAbortSecret = 'Bearer sk-live-abort-secret';
        stream.mockReturnValue(fakeStream(assistant([], 'aborted', upstreamAbortSecret)));
        const preflight = await assertPiRuntimeConfiguration({
            settings: makeSettings(),
            credentialStore: makeCredentialStore(),
        });

        const providerAbort = await runPiRequest({
            preflight,
            messages: [{ role: 'user', content: 'hello' }],
            generationId: 'runtime-abort',
        }).catch(cause => cause);
        expect(providerAbort).toBeInstanceOf(PiRequestAbortedError);
        expect(String(providerAbort)).not.toContain(upstreamAbortSecret);
        expect(getActivePiRequestIds()).toEqual([]);

        const controller = new AbortController();
        controller.abort(new Error('cancelled before preflight'));
        await expect(
            runPiRequest({
                settings: makeSettings(),
                credentialStore: makeCredentialStore(),
                messages: [{ role: 'user', content: 'hello' }],
                generationId: 'runtime-preflight-abort',
                signal: controller.signal,
            })
        ).rejects.toBeInstanceOf(PiRequestAbortedError);
        expect(createModels).toHaveBeenCalledTimes(1);
    });
});
