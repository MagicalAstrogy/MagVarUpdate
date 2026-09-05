jest.mock('@/function/update/pi/runtime', () => ({
    assertPiRuntimeConfiguration: jest.fn(),
    isNonRetryablePiRuntimeError: jest.fn().mockReturnValue(false),
    runPiRequest: jest.fn(),
}));

import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import {
    clearPiRequestControllers,
    getActivePiRequestIds,
    PiRequestAbortedError,
    stopExtraModelRequestById,
    withPiRequestController,
} from '@/function/update/pi/controller_registry';
import { getPendingPromptCaptureDiagnostics } from '@/function/update/pi/prompt_capture';
import {
    assertPiRuntimeConfiguration,
    runPiRequest,
    type PiRuntimePreflight,
} from '@/function/update/pi/runtime';
import { useDataStore } from '@/store';

const PREFLIGHT = Object.freeze({ marker: 'preflight' }) as unknown as PiRuntimePreflight;
const VALID_UPDATE = "<UpdateVariable>\n_.set('score', 1);\n</UpdateVariable>";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function installGenerationLifecycle() {
    const controllers = new Map<string, AbortController>();
    (globalThis as any).stopGenerationById = jest.fn((id: string) => {
        const controller = controllers.get(id);
        if (!controller) return false;
        controller.abort(new DOMException('Generation stopped', 'AbortError'));
        controllers.delete(id);
        void (globalThis as any).eventEmit(tavern_events.GENERATION_STOPPED, id);
        return true;
    });
    (globalThis as any).generateRaw = jest.fn(async (config: GenerateRawConfig) => {
        expect(config.should_silence).toBe(false);
        const id = config.generation_id!;
        const controller = new AbortController();
        controllers.set(id, controller);
        try {
            await (globalThis as any).eventEmit(tavern_events.CHAT_COMPLETION_SETTINGS_READY, {
                model: config.custom_api?.model,
                messages: [{ role: 'user', content: 'captured prompt' }],
            });
            // Slash's fixed capture fetch must still receive an aborted signal.
            expect(controller.signal.aborted).toBe(true);
            throw controller.signal.reason;
        } finally {
            controllers.delete(id);
        }
    });
    return controllers;
}

function configurePiSource(): void {
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
}

describe('Pi generation lifecycle and cancellation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearPiRequestControllers();
        configurePiSource();
        jest.mocked(assertPiRuntimeConfiguration).mockResolvedValue(PREFLIGHT);
    });

    afterEach(() => {
        clearPiRequestControllers();
        delete (globalThis as any).generateRaw;
        jest.restoreAllMocks();
        expect(getPendingPromptCaptureDiagnostics()).toEqual([]);
        expect(getActivePiRequestIds()).toEqual([]);
    });

    test('keeps generation active through the provider response and ignores its own cleanup stop', async () => {
        const controllers = installGenerationLifecycle();
        const started = deferred<void>();
        const response = deferred<string>();
        let provider_signal!: AbortSignal;
        jest.mocked(runPiRequest).mockImplementation(input =>
            withPiRequestController(input.generationId, signal => {
                provider_signal = signal;
                started.resolve();
                return response.promise;
            })
        );

        const request = invokeExtraModelWithStrategy();
        await started.promise;
        expect(controllers.size).toBe(1);
        expect((globalThis as any).stopGenerationById).not.toHaveBeenCalled();
        expect(getPendingPromptCaptureDiagnostics()).toEqual([
            expect.objectContaining({ captured: true, stopSucceeded: false }),
        ]);

        response.resolve(VALID_UPDATE);
        await expect(request).resolves.toBe(VALID_UPDATE);
        expect(controllers.size).toBe(0);
        expect(provider_signal.aborted).toBe(false);
        expect((globalThis as any).generateRaw).toHaveBeenCalledTimes(1);
    });

    test.each(['依次请求，失败后重试', '同时请求多次'] as const)(
        'the native Stop button aborts %s providers without retrying',
        async strategy => {
            const store = useDataStore();
            store.settings.额外模型解析配置.请求方式 = strategy;
            store.settings.额外模型解析配置.请求次数 = 3;
            const count = strategy === '同时请求多次' ? 3 : 1;
            const controllers = installGenerationLifecycle();
            const started = deferred<void>();
            const signals: AbortSignal[] = [];
            jest.spyOn(console, 'error').mockImplementation(() => {});
            jest.mocked(runPiRequest).mockImplementation(input =>
                withPiRequestController(
                    input.generationId,
                    signal =>
                        new Promise<string>((_resolve, reject) => {
                            signals.push(signal);
                            signal.addEventListener('abort', () => reject(signal.reason), {
                                once: true,
                            });
                            if (signals.length === count) started.resolve();
                        })
                )
            );

            const request = invokeExtraModelWithStrategy();
            await started.promise;
            expect(controllers.size).toBe(count);
            await (globalThis as any).eventEmit(
                tavern_events.GENERATION_STOPPED,
                'another-request'
            );
            expect(signals.every(signal => !signal.aborted)).toBe(true);

            // The Tavern Helper Stop handler aborts every non-silent generation and emits its id.
            for (const id of [...controllers.keys()]) stopGenerationById(id);

            await expect(request).resolves.toBeNull();
            expect(signals.every(signal => signal.aborted)).toBe(true);
            expect(controllers.size).toBe(0);
            expect((globalThis as any).generateRaw).toHaveBeenCalledTimes(count);
            expect(runPiRequest).toHaveBeenCalledTimes(count);
        }
    );

    test('does not retry or start the provider when a late settings event observes Slash already stopped', async () => {
        const stop_generation = jest.fn().mockReturnValueOnce(true).mockReturnValue(false);
        (globalThis as any).stopGenerationById = stop_generation;
        const fixed_failure = new Error(
            'fixed invalid-endpoint failure authorization=provider-secret'
        );
        let generation_id = '';

        (globalThis as any).generateRaw = jest.fn(async (config: GenerateRawConfig) => {
            generation_id = config.generation_id ?? '';
            expect(generation_id).not.toBe('');

            // This is the user/Promise.any stop. It stops Slash and tombstones the
            // attempt before the delayed settings-ready callback runs.
            expect(stopExtraModelRequestById(generation_id)).toBe(true);

            await (globalThis as any).eventEmit(tavern_events.CHAT_COMPLETION_SETTINGS_READY, {
                model: config.custom_api?.model ?? '',
                messages: [{ role: 'user', content: 'captured after stop' }],
            });
            throw fixed_failure;
        });
        const console_error = jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(invokeExtraModelWithStrategy()).resolves.toBeNull();

        expect((globalThis as any).generateRaw).toHaveBeenCalledTimes(1);
        expect(assertPiRuntimeConfiguration).toHaveBeenCalledTimes(1);
        expect(runPiRequest).not.toHaveBeenCalled();
        expect(stop_generation).toHaveBeenCalledTimes(2);
        expect(stop_generation.mock.calls).toEqual([[generation_id], [generation_id]]);
        expect(getPendingPromptCaptureDiagnostics()).toEqual([]);
        expect(getActivePiRequestIds()).toEqual([]);
        expect(console_error).toHaveBeenCalledTimes(1);
        const logged_error = console_error.mock.calls[0][0];
        expect(logged_error).toBeInstanceOf(PiRequestAbortedError);
        expect(logged_error).toMatchObject({ generationId: generation_id });
        expect(String(logged_error)).not.toContain('provider-secret');
    });
});
