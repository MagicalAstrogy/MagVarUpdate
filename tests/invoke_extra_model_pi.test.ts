jest.mock('@/function/update/pi/prompt_capture', () => ({
    captureGeneratePrompt: jest.fn(),
    captureGenerateRawPrompt: jest.fn(),
}));

jest.mock('@/function/update/pi/runtime', () => ({
    assertPiRuntimeConfiguration: jest.fn(),
    isNonRetryablePiRuntimeError: jest.fn().mockReturnValue(false),
    PiRuntimeError: class PiRuntimeError extends Error {
        readonly name = 'PiRuntimeError';

        constructor(
            readonly code: string,
            message: string,
            readonly retryable = false
        ) {
            super(message);
        }
    },
    runPiRequest: jest.fn(),
}));

jest.mock('@/function/update/pi/controller_registry', () => ({
    beginPiRequestAttempt: jest.fn(() => ({
        signal: new AbortController().signal,
        release: jest.fn(),
    })),
    isPiRequestAbortedError: jest.fn().mockReturnValue(false),
    stopExtraModelRequestById: jest.fn(),
}));

import {
    generateExtraModel,
    invokeExtraModelWithStrategy,
} from '@/function/update/invoke_extra_model';
import {
    captureGeneratePrompt,
    captureGenerateRawPrompt,
    type PromptCaptureResult,
} from '@/function/update/pi/prompt_capture';
import {
    beginPiRequestAttempt,
    isPiRequestAbortedError,
    stopExtraModelRequestById,
} from '@/function/update/pi/controller_registry';
import {
    assertPiRuntimeConfiguration,
    isNonRetryablePiRuntimeError,
    runPiRequest,
    type PiRuntimePreflight,
} from '@/function/update/pi/runtime';
import { i18n } from '@/i18n';
import { useDataStore } from '@/store';
import YAML from 'yaml';

const VALID_UPDATE = "<UpdateVariable>\n_.set('x', 1);\n</UpdateVariable>";
const CAPTURED_MESSAGES: SillyTavern.SendingMessage[] = [
    { role: 'system', content: 'captured system' },
    { role: 'user', content: 'captured user' },
];
const PREFLIGHT = Object.freeze({ marker: 'preflight' }) as unknown as PiRuntimePreflight;

const mockCaptureGeneratePrompt = jest.mocked(captureGeneratePrompt);
const mockCaptureGenerateRawPrompt = jest.mocked(captureGenerateRawPrompt);
const mockAssertPiRuntimeConfiguration = jest.mocked(assertPiRuntimeConfiguration);
const mockIsNonRetryablePiRuntimeError = jest.mocked(isNonRetryablePiRuntimeError);
const mockRunPiRequest = jest.mocked(runPiRequest);
const mockBeginPiRequestAttempt = jest.mocked(beginPiRequestAttempt);
const mockIsPiRequestAbortedError = jest.mocked(isPiRequestAbortedError);
const mockStopExtraModelRequestById = jest.mocked(stopExtraModelRequestById);

function captureResult(config: GenerateConfig): PromptCaptureResult {
    const generation_id = config.generation_id || 'capture-generated-id';
    return {
        generationId: generation_id,
        marker: `marker:${generation_id}`,
        markerMatched: true,
        captured: true,
        stopSucceeded: true,
        messages: structuredClone(CAPTURED_MESSAGES),
    };
}

function configurePiSource() {
    const store = useDataStore();
    Object.assign(store.settings.额外模型解析配置, {
        模型来源: '更多' as const,
        应答格式: '聊天消息' as const,
        请求方式: '依次请求，失败后重试' as const,
        请求次数: 3,
        破限方案: '使用内置破限' as const,
    });
    Object.assign(store.settings.额外模型解析配置.pi, {
        provider: 'openai',
        api: 'openai-responses',
        authType: 'api_key' as const,
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-5-mini',
        contextWindow: 128_000,
    });
    store.settings.额外模型解析配置.密钥 = 'test-key';
    store.settings.额外模型解析配置.最大回复token数 = 4096;
    store.settings.通知.额外模型解析中 = false;
    return store;
}

describe('invoke extra model through Pi', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (globalThis as any).SillyTavern.extensionSettings = {};
        (globalThis as any).SillyTavern.getChatCompletionModel = jest
            .fn()
            .mockReturnValue('st-model');
        (globalThis as any).generate = jest.fn().mockResolvedValue(VALID_UPDATE);
        (globalThis as any).generateRaw = jest.fn().mockResolvedValue(VALID_UPDATE);
        (globalThis as any).getPreset = jest.fn().mockReturnValue({ prompts: [] });
        (globalThis as any).getPresetNames = jest.fn().mockReturnValue(['pi-preset']);

        mockAssertPiRuntimeConfiguration.mockResolvedValue(PREFLIGHT);
        mockIsNonRetryablePiRuntimeError.mockReturnValue(false);
        mockRunPiRequest.mockResolvedValue(VALID_UPDATE);
        mockIsPiRequestAbortedError.mockReturnValue(false);
        mockStopExtraModelRequestById.mockReturnValue(true);
        const capture: typeof captureGeneratePrompt = async (config, options) => {
            const prompt = captureResult(config);
            return { ...prompt, result: await options?.onCaptured(prompt) };
        };
        mockCaptureGeneratePrompt.mockImplementation(capture);
        mockCaptureGenerateRawPrompt.mockImplementation(capture);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete (globalThis as any).generate;
        delete (globalThis as any).generateRaw;
        delete (globalThis as any).getPreset;
        delete (globalThis as any).getPresetNames;
        delete (globalThis as any).SillyTavern.getChatCompletionModel;
    });

    test('keeps retries bound to the original Pi configuration after panel edits', async () => {
        const store = configurePiSource();
        store.versions.tavernhelper = '4.9.3';
        const settings = store.settings.额外模型解析配置;
        settings.请求次数 = 2;
        settings.max_chat_history = 12;
        mockRunPiRequest.mockImplementationOnce(async () => {
            // Editing the next request must not change this batch's capture/response contract.
            settings.模型来源 = '自定义';
            settings.应答格式 = '格式化输出';
            settings.破限方案 = '使用当前预设';
            settings.max_chat_history = 30;
            settings.pi.model = 'gemini-other';
            throw new Error('transient provider failure');
        });
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(invokeExtraModelWithStrategy()).resolves.toBe(VALID_UPDATE);

        expect(mockAssertPiRuntimeConfiguration).toHaveBeenCalledTimes(1);
        expect(mockAssertPiRuntimeConfiguration.mock.calls[0][0].settings).toMatchObject({
            模型来源: '更多',
            应答格式: '聊天消息',
            max_chat_history: 12,
            pi: { model: 'gpt-5-mini' },
        });
        expect(mockCaptureGeneratePrompt).not.toHaveBeenCalled();
        expect(mockCaptureGenerateRawPrompt).toHaveBeenCalledTimes(2);
        expect(mockBeginPiRequestAttempt).toHaveBeenCalledTimes(2);
        for (const [config] of mockCaptureGenerateRawPrompt.mock.calls) {
            expect(config.max_chat_history).toBe(12);
            expect(config.generation_id).toEqual(expect.any(String));
            expect(JSON.stringify(config)).not.toContain('formatted-output mode');
        }
        expect(mockRunPiRequest).toHaveBeenCalledTimes(2);
        expect((globalThis as any).generate).not.toHaveBeenCalled();
        expect((globalThis as any).generateRaw).not.toHaveBeenCalled();
    });

    test('holds the batch lock while concurrent requests are still pending', async () => {
        const store = configurePiSource();
        store.settings.额外模型解析配置.请求方式 = '同时请求多次';
        store.settings.额外模型解析配置.请求次数 = 2;
        let finish!: (result: string) => void;
        let started!: () => void;
        const ready = new Promise<void>(resolve => {
            started = resolve;
        });
        const response = new Promise<string>(resolve => {
            finish = resolve;
        });
        mockRunPiRequest.mockImplementation(() => {
            started();
            return response;
        });
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const first = invokeExtraModelWithStrategy();
        await ready;

        try {
            await expect(invokeExtraModelWithStrategy()).resolves.toBeNull();
            expect(mockAssertPiRuntimeConfiguration).toHaveBeenCalledTimes(1);
            expect(store.runtimes.is_during_extra_analysis).toBe(true);
        } finally {
            finish(VALID_UPDATE);
            await first;
        }
        expect(store.runtimes.is_during_extra_analysis).toBe(false);
    });

    test.each([
        ['使用当前预设', 'generate'],
        ['使用其他预设', 'generateRaw'],
        ['使用内置破限', 'generateRaw'],
    ] as const)(
        'routes %s prompt construction through Pi after %s capture',
        async (route, runner) => {
            const store = configurePiSource();
            store.settings.额外模型解析配置.破限方案 = route;
            store.settings.额外模型解析配置.其他预设名称 = 'pi-preset';

            await expect(generateExtraModel()).resolves.toBe(VALID_UPDATE);

            const expected_capture =
                runner === 'generate' ? mockCaptureGeneratePrompt : mockCaptureGenerateRawPrompt;
            const unexpected_capture =
                runner === 'generate' ? mockCaptureGenerateRawPrompt : mockCaptureGeneratePrompt;
            expect(expected_capture).toHaveBeenCalledTimes(1);
            expect(unexpected_capture).not.toHaveBeenCalled();
            expect((globalThis as any).generate).not.toHaveBeenCalled();
            expect((globalThis as any).generateRaw).not.toHaveBeenCalled();
            expect(mockRunPiRequest).toHaveBeenCalledTimes(1);
            expect(mockBeginPiRequestAttempt).toHaveBeenCalledWith(
                mockRunPiRequest.mock.calls[0][0].generationId
            );
            expect(mockBeginPiRequestAttempt.mock.results[0].value.release).toHaveBeenCalledTimes(
                1
            );
            expect(mockRunPiRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    preflight: PREFLIGHT,
                    messages: CAPTURED_MESSAGES,
                    generationId: expect.any(String),
                })
            );

            const capture_config = expected_capture.mock.calls[0][0];
            const runtime_input = mockRunPiRequest.mock.calls[0][0];
            expect(runtime_input.generationId).toBe(
                capture_config.generation_id || 'capture-generated-id'
            );
        }
    );

    test.each(['与插头相同', '自定义'] as const)(
        'keeps the %s source on the existing TavernHelper path',
        async source => {
            const store = useDataStore();
            store.versions.tavernhelper = '4.8.13';
            store.settings.额外模型解析配置.模型来源 = source;
            store.settings.额外模型解析配置.破限方案 = '使用内置破限';

            await expect(generateExtraModel()).resolves.toBe(VALID_UPDATE);

            expect((globalThis as any).generateRaw).toHaveBeenCalledTimes(1);
            expect(mockAssertPiRuntimeConfiguration).not.toHaveBeenCalled();
            expect(mockCaptureGeneratePrompt).not.toHaveBeenCalled();
            expect(mockCaptureGenerateRawPrompt).not.toHaveBeenCalled();
            expect(mockRunPiRequest).not.toHaveBeenCalled();
        }
    );

    test('keeps the legacy diagnostic response body for a malformed non-Pi result', async () => {
        const store = useDataStore();
        store.versions.tavernhelper = '4.8.13';
        store.settings.额外模型解析配置.模型来源 = '自定义';
        store.settings.额外模型解析配置.破限方案 = '使用内置破限';
        const legacy_response = 'legacy malformed response diagnostic';
        (globalThis as any).generateRaw.mockResolvedValue(legacy_response);
        const previous_yaml = (globalThis as any).YAML;
        (globalThis as any).YAML = YAML;

        try {
            await expect(generateExtraModel()).rejects.toThrow(legacy_response);
        } finally {
            if (previous_yaml === undefined) {
                delete (globalThis as any).YAML;
            } else {
                (globalThis as any).YAML = previous_yaml;
            }
        }

        expect(mockAssertPiRuntimeConfiguration).not.toHaveBeenCalled();
        expect(mockRunPiRequest).not.toHaveBeenCalled();
    });

    test('runs static Pi preflight once before retries and propagates its failure', async () => {
        const store = configurePiSource();
        store.settings.额外模型解析配置.请求次数 = 4;
        const error = new Error('unsupported Pi configuration');
        mockAssertPiRuntimeConfiguration.mockRejectedValueOnce(error);

        await expect(invokeExtraModelWithStrategy()).rejects.toBe(error);

        expect(mockAssertPiRuntimeConfiguration).toHaveBeenCalledTimes(1);
        expect(mockCaptureGeneratePrompt).not.toHaveBeenCalled();
        expect(mockCaptureGenerateRawPrompt).not.toHaveBeenCalled();
        expect(mockRunPiRequest).not.toHaveBeenCalled();
    });

    test('assigns a distinct generation id to every serial Pi attempt', async () => {
        const store = configurePiSource();
        store.settings.额外模型解析配置.请求次数 = 2;
        const first_error = new Error('retryable provider failure');
        mockRunPiRequest.mockRejectedValueOnce(first_error).mockResolvedValueOnce(VALID_UPDATE);
        const console_error = jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(invokeExtraModelWithStrategy()).resolves.toBe(VALID_UPDATE);

        expect(mockAssertPiRuntimeConfiguration).toHaveBeenCalledTimes(1);
        expect(mockCaptureGenerateRawPrompt).toHaveBeenCalledTimes(2);
        expect(mockRunPiRequest).toHaveBeenCalledTimes(2);
        const capture_ids = mockCaptureGenerateRawPrompt.mock.calls.map(
            ([config]) => config.generation_id
        );
        const runtime_ids = mockRunPiRequest.mock.calls.map(([input]) => input.generationId);
        expect(capture_ids).toEqual([expect.any(String), expect.any(String)]);
        expect(new Set(capture_ids).size).toBe(2);
        expect(runtime_ids).toEqual(capture_ids);

        console_error.mockRestore();
    });

    test('sanitizes a Pi provider error before logging and retrying it', async () => {
        const store = configurePiSource();
        store.settings.额外模型解析配置.请求次数 = 2;
        const original_locale = i18n.global.locale.value;
        i18n.global.locale.value = 'en';
        const provider_error = Object.assign(
            new Error('upstream response echoed Authorization: Bearer integration-secret'),
            {
                name: 'PiRuntimeError',
                code: 'provider',
                retryable: true,
            }
        );
        mockRunPiRequest.mockRejectedValueOnce(provider_error).mockResolvedValueOnce(VALID_UPDATE);
        const console_error = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            await expect(invokeExtraModelWithStrategy()).resolves.toBe(VALID_UPDATE);

            expect(mockRunPiRequest).toHaveBeenCalledTimes(2);
            expect(console_error).toHaveBeenCalledWith(provider_error);
            expect(provider_error.message).toBe(
                'The provider request under More failed. Check the provider settings, credentials, and network, then retry.'
            );
            expect(`${provider_error.message}\n${provider_error.stack}`).not.toContain(
                'integration-secret'
            );
        } finally {
            i18n.global.locale.value = original_locale;
            console_error.mockRestore();
        }
    });

    test('propagates the last sanitized Pi provider error after all retries fail', async () => {
        const store = configurePiSource();
        store.settings.额外模型解析配置.请求次数 = 2;
        const first_error = Object.assign(new Error('first provider failure'), {
            name: 'PiRuntimeError',
            code: 'provider',
            retryable: true,
        });
        const last_error = Object.assign(
            new Error('last failure echoed Authorization: Bearer final-secret'),
            {
                name: 'PiRuntimeError',
                code: 'provider',
                retryable: true,
            }
        );
        mockRunPiRequest.mockRejectedValueOnce(first_error).mockRejectedValueOnce(last_error);
        const console_error = jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(invokeExtraModelWithStrategy()).rejects.toBe(last_error);

        expect(mockRunPiRequest).toHaveBeenCalledTimes(2);
        expect(last_error.message).toBe(i18n.global.t('runtime.pi.requestFailed'));
        expect(`${last_error.message}\n${last_error.stack}`).not.toContain('final-secret');
        console_error.mockRestore();
    });

    test('propagates a sanitized Pi provider error after all concurrent attempts fail', async () => {
        const store = configurePiSource();
        store.settings.额外模型解析配置.请求方式 = '同时请求多次';
        store.settings.额外模型解析配置.请求次数 = 2;
        const provider_error = Object.assign(new Error('provider rejected request'), {
            name: 'PiRuntimeError',
            code: 'provider',
            retryable: true,
        });
        mockRunPiRequest.mockRejectedValue(provider_error);
        const console_error = jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(invokeExtraModelWithStrategy()).rejects.toBe(provider_error);

        expect(mockRunPiRequest).toHaveBeenCalledTimes(2);
        expect(provider_error.message).toBe(i18n.global.t('runtime.pi.requestFailed'));
        console_error.mockRestore();
    });

    test('treats a mixed concurrent failure as cancellation when one attempt was aborted', async () => {
        const store = configurePiSource();
        store.settings.额外模型解析配置.请求方式 = '同时请求多次';
        store.settings.额外模型解析配置.请求次数 = 2;
        const provider_error = Object.assign(new Error('provider rejected request'), {
            name: 'PiRuntimeError',
            code: 'provider',
            retryable: true,
        });
        const abort_error = new Error('Pi request aborted');
        mockRunPiRequest.mockRejectedValueOnce(provider_error).mockRejectedValueOnce(abort_error);
        mockIsPiRequestAbortedError.mockImplementation(error => error === abort_error);
        const console_error = jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(invokeExtraModelWithStrategy()).resolves.toBeNull();

        expect(mockRunPiRequest).toHaveBeenCalledTimes(2);
        console_error.mockRestore();
    });

    test.each([
        ['missing update tag', 'provider echoed Authorization: Bearer sk-live-missing-tag-token'],
        [
            'invalid update command',
            '<UpdateVariable>refresh_token=sk-live-invalid-command-token</UpdateVariable>',
        ],
    ])('does not expose a successful Pi response with %s', async (_case, response) => {
        const store = configurePiSource();
        store.settings.额外模型解析配置.请求次数 = 1;
        mockRunPiRequest.mockResolvedValue(response);
        mockIsNonRetryablePiRuntimeError.mockImplementation(
            error =>
                error instanceof Error &&
                error.name === 'PiRuntimeError' &&
                (error as Error & { code?: unknown }).code === 'protocol'
        );
        const console_error = jest.spyOn(console, 'error').mockImplementation(() => {});

        const error = await invokeExtraModelWithStrategy().catch(cause => cause);

        expect(error).toMatchObject({
            name: 'PiRuntimeError',
            code: 'protocol',
            retryable: false,
        });
        expect(error.message).toBe(i18n.global.t('runtime.pi.protocolError'));
        expect(mockRunPiRequest).toHaveBeenCalledTimes(1);
        expect(console_error).toHaveBeenCalledTimes(1);

        const observable_error_text = [
            String(error),
            error instanceof Error ? error.stack : '',
            ...console_error.mock.calls.flatMap(call =>
                call.map(value =>
                    value instanceof Error ? `${value.message}\n${value.stack}` : String(value)
                )
            ),
        ].join('\n');
        expect(observable_error_text).not.toContain(response);
        expect(observable_error_text).not.toContain('Bearer');
        expect(observable_error_text).not.toContain('sk-live');
        expect(observable_error_text).not.toContain('refresh_token');

        console_error.mockRestore();
    });

    test('stops every concurrent Pi generation after a winner resolves', async () => {
        const store = configurePiSource();
        store.settings.额外模型解析配置.请求方式 = '同时请求多次';
        store.settings.额外模型解析配置.请求次数 = 3;
        type PiResult = Awaited<ReturnType<typeof runPiRequest>>;
        const requests = new Map<
            string,
            {
                resolve: (value: PiResult) => void;
                reject: (reason?: unknown) => void;
            }
        >();
        mockRunPiRequest.mockImplementation(
            input =>
                new Promise<PiResult>((resolve, reject) => {
                    requests.set(input.generationId, { resolve, reject });
                    if (requests.size === 3) {
                        requests.values().next().value!.resolve(VALID_UPDATE);
                    }
                })
        );
        mockStopExtraModelRequestById.mockImplementation(generation_id => {
            requests.get(generation_id)?.reject(new Error(`stopped:${generation_id}`));
            return true;
        });
        const console_error = jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(invokeExtraModelWithStrategy()).resolves.toBe(VALID_UPDATE);

        expect(mockCaptureGenerateRawPrompt).toHaveBeenCalledTimes(3);
        expect(mockRunPiRequest).toHaveBeenCalledTimes(3);
        const runtime_ids = mockRunPiRequest.mock.calls.map(([input]) => input.generationId);
        expect(new Set(runtime_ids).size).toBe(3);
        expect(mockStopExtraModelRequestById.mock.calls).toEqual(
            runtime_ids.map(generation_id => [generation_id])
        );
        expect(console_error).toHaveBeenCalledTimes(2);
    });

    test('propagates a non-retryable Pi runtime error without another attempt', async () => {
        const store = configurePiSource();
        store.settings.额外模型解析配置.请求次数 = 4;
        const deterministic_error = new Error('captured prompt exceeds Pi context window');
        mockRunPiRequest.mockRejectedValue(deterministic_error);
        mockIsNonRetryablePiRuntimeError.mockImplementation(error => error === deterministic_error);
        const console_error = jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(invokeExtraModelWithStrategy()).rejects.toBe(deterministic_error);

        expect(mockAssertPiRuntimeConfiguration).toHaveBeenCalledTimes(1);
        expect(mockCaptureGenerateRawPrompt).toHaveBeenCalledTimes(1);
        expect(mockRunPiRequest).toHaveBeenCalledTimes(1);
        expect(console_error).toHaveBeenCalledTimes(1);
    });

    test('does not retry a manually aborted Pi request', async () => {
        const store = configurePiSource();
        store.settings.额外模型解析配置.请求次数 = 4;
        const abort_error = new Error('Pi request aborted');
        mockRunPiRequest.mockRejectedValue(abort_error);
        mockIsPiRequestAbortedError.mockImplementation(error => error === abort_error);
        const console_error = jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(invokeExtraModelWithStrategy()).resolves.toBeNull();

        expect(mockAssertPiRuntimeConfiguration).toHaveBeenCalledTimes(1);
        expect(mockCaptureGenerateRawPrompt).toHaveBeenCalledTimes(1);
        expect(mockRunPiRequest).toHaveBeenCalledTimes(1);

        console_error.mockRestore();
    });

    test('fails closed when Pi structured output cannot be parsed', async () => {
        const store = configurePiSource();
        store.settings.额外模型解析配置.应答格式 = '格式化输出';
        // This would be accepted by the legacy fallback, so rejection proves the Pi path is strict.
        mockRunPiRequest.mockResolvedValue(VALID_UPDATE);
        const console_error = jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(generateExtraModel()).rejects.toThrow();

        expect(mockCaptureGenerateRawPrompt).toHaveBeenCalledTimes(1);
        expect(mockRunPiRequest).toHaveBeenCalledTimes(1);
        expect(console_error).toHaveBeenCalled();
    });

    test('does not modify the global ST custom body for More source', async () => {
        const store = configurePiSource();
        store.versions.tavernhelper = '4.8.12';
        store.settings.额外模型解析配置.应答格式 = '格式化输出(v4兼容)';
        (globalThis as any).SillyTavern.chatCompletionSettings.custom_include_body =
            'sentinel: true';
        mockRunPiRequest.mockResolvedValue(
            JSON.stringify({
                analysis: 'ok',
                json_patch: [{ op: 'replace', path: '/x', value: 1 }],
            })
        );

        await expect(generateExtraModel()).resolves.toContain('<JSONPatch>');

        expect((globalThis as any).SillyTavern.chatCompletionSettings.custom_include_body).toBe(
            'sentinel: true'
        );
        expect((globalThis as any).builtin.saveSettings).not.toHaveBeenCalled();
        expect((globalThis as any).generate).not.toHaveBeenCalled();
        expect((globalThis as any).generateRaw).not.toHaveBeenCalled();
    });
});
