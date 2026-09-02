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
} from '@/function/update/pi/controller_registry';
import { getPendingPromptCaptureDiagnostics } from '@/function/update/pi/prompt_capture';
import {
    assertPiRuntimeConfiguration,
    runPiRequest,
    type PiRuntimePreflight,
} from '@/function/update/pi/runtime';
import { useDataStore } from '@/store';

const PREFLIGHT = Object.freeze({ marker: 'preflight' }) as unknown as PiRuntimePreflight;

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

describe('Pi cancellation during prompt capture completion', () => {
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
    });

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
