import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import { onMessageReceived } from '@/function/update/on_message_received';
import { handleVariablesInMessage } from '@/function/update_variables';
import { i18n } from '@/i18n';
import { useDataStore } from '@/store';

jest.mock('@/function/is_extra_model_supported', () => ({
    isExtraModelSupported: jest.fn(),
}));
jest.mock('@/function/update/invoke_extra_model', () => ({
    invokeExtraModelWithStrategy: jest.fn(),
}));
jest.mock('@/function/update_variables', () => ({
    handleVariablesInMessage: jest.fn(),
}));

const mockIsExtraModelSupported = jest.mocked(isExtraModelSupported);
const mockInvokeExtraModelWithStrategy = jest.mocked(invokeExtraModelWithStrategy);
const mockHandleVariablesInMessage = jest.mocked(handleVariablesInMessage);

describe('onMessageReceived Pi source gate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete globalThis.__MVU_PI_MULTIPROVIDER_ENABLED__;

        const store = useDataStore();
        store.settings.更新方式 = '额外模型解析';
        store.settings.额外模型解析配置.应答格式 = '工具调用';
        store.settings.额外模型解析配置.启用自动请求 = true;
        store.versions.tavernhelper = '4.8.3';

        Object.assign((globalThis as any).SillyTavern, {
            name2: 'Assistant',
            chat: [{}, {}],
        });
        (globalThis as any).SillyTavern.ToolManager.isToolCallingSupported.mockReturnValue(false);
        (globalThis as any).getChatMessages.mockReturnValue([
            { message: 'A sufficiently long reply', name: 'Assistant' },
        ]);
        (globalThis as any).toastr = { error: jest.fn() };

        mockIsExtraModelSupported.mockResolvedValue(true);
        mockInvokeExtraModelWithStrategy.mockResolvedValue(null);
        mockHandleVariablesInMessage.mockResolvedValue(undefined);
    });

    test('continues to Pi when Tavern Helper and ToolManager tool calling are unsupported', async () => {
        useDataStore().settings.额外模型解析配置.模型来源 = '更多';

        await onMessageReceived(1);

        expect(mockIsExtraModelSupported).toHaveBeenCalledTimes(1);
        expect(mockInvokeExtraModelWithStrategy).toHaveBeenCalledTimes(1);
        expect((globalThis as any).toastr.error).not.toHaveBeenCalled();
    });

    test('falls back to ordinary variable handling when the Pi release switch is off', async () => {
        globalThis.__MVU_PI_MULTIPROVIDER_ENABLED__ = false;
        useDataStore().settings.额外模型解析配置.模型来源 = '更多';

        await onMessageReceived(1);

        expect(mockIsExtraModelSupported).not.toHaveBeenCalled();
        expect(mockInvokeExtraModelWithStrategy).not.toHaveBeenCalled();
        expect(mockHandleVariablesInMessage).toHaveBeenCalledWith(1);
    });

    test.each(['与插头相同', '自定义'] as const)(
        'keeps the existing unsupported fallback for %s',
        async model_source => {
            useDataStore().settings.额外模型解析配置.模型来源 = model_source;

            await onMessageReceived(1);

            expect(mockInvokeExtraModelWithStrategy).not.toHaveBeenCalled();
            expect(mockHandleVariablesInMessage).toHaveBeenCalledWith(1);
        }
    );

    test.each([
        ['工具调用', 'runtime.pi.toolRequestRejected'],
        ['格式化输出', 'runtime.pi.structuredOutputRequestRejected'],
        ['格式化输出(v4兼容)', 'runtime.pi.jsonObjectRequestRejected'],
    ] as const)(
        'shows one safe toastr error when a Pi endpoint rejects %s',
        async (response_format, message_key) => {
            const store = useDataStore();
            store.settings.额外模型解析配置.模型来源 = '更多';
            store.settings.额外模型解析配置.应答格式 = response_format;
            const provider_secret = 'sk-provider-secret';
            const provider_error = Object.assign(
                new Error(`upstream echoed Authorization: Bearer ${provider_secret}`),
                {
                    name: 'PiRuntimeError',
                    code: 'provider',
                    retryable: true,
                }
            );
            mockInvokeExtraModelWithStrategy.mockRejectedValueOnce(provider_error);

            await expect(onMessageReceived(1)).rejects.toBe(provider_error);

            const toastr_error = (globalThis as any).toastr.error as jest.Mock;
            expect(toastr_error).toHaveBeenCalledTimes(1);
            expect(toastr_error).toHaveBeenCalledWith(
                i18n.global.t(message_key),
                i18n.global.t('runtime.extraModel.updateFailedTitle')
            );
            const observable_toast = JSON.stringify(toastr_error.mock.calls);
            expect(observable_toast).not.toContain(provider_secret);
            expect(observable_toast).not.toContain('Bearer');
            expect(mockHandleVariablesInMessage).not.toHaveBeenCalled();
        }
    );

    test('reports errors against the source and response format captured for the request', async () => {
        const store = useDataStore();
        store.settings.额外模型解析配置.模型来源 = '更多';
        store.settings.额外模型解析配置.应答格式 = '格式化输出';
        const provider_error = Object.assign(new Error('provider failure'), {
            name: 'PiRuntimeError',
            code: 'provider',
            retryable: true,
        });
        mockInvokeExtraModelWithStrategy.mockImplementationOnce(async () => {
            store.settings.额外模型解析配置.模型来源 = '自定义';
            store.settings.额外模型解析配置.应答格式 = '聊天消息';
            throw provider_error;
        });

        await expect(onMessageReceived(1)).rejects.toBe(provider_error);

        expect((globalThis as any).toastr.error).toHaveBeenCalledWith(
            i18n.global.t('runtime.pi.structuredOutputRequestRejected'),
            i18n.global.t('runtime.extraModel.updateFailedTitle')
        );
    });

    test.each([
        [
            '聊天消息',
            'proxy_unavailable',
            'SillyTavern proxy route returned a secret diagnostic',
            'runtime.pi.proxyUnavailable',
        ],
        [
            '工具调用',
            'network',
            'TypeError: Failed to fetch Authorization: Bearer network-secret',
            'runtime.pi.browserNetworkError',
        ],
        [
            '格式化输出',
            'network',
            'CORS blocked Authorization: Bearer network-secret',
            'runtime.pi.browserNetworkError',
        ],
        [
            '工具调用',
            'unsupported_capability',
            'Selected model does not support tool calling; Bearer capability-secret',
            'runtime.pi.toolCallingUnsupported',
        ],
        [
            '格式化输出(v4兼容)',
            'unsupported_capability',
            'Structured JSON output is unsupported; Bearer capability-secret',
            'runtime.pi.structuredOutputUnsupported',
        ],
    ] as const)(
        'keeps the specific %s/%s Pi error instead of using an endpoint rejection hint',
        async (response_format, code, upstream_message, message_key) => {
            const store = useDataStore();
            store.settings.额外模型解析配置.模型来源 = '更多';
            store.settings.额外模型解析配置.应答格式 = response_format;
            const error = Object.assign(new Error(upstream_message), {
                name: 'PiRuntimeError',
                code,
                retryable: code === 'network',
            });
            mockInvokeExtraModelWithStrategy.mockRejectedValueOnce(error);

            await expect(onMessageReceived(1)).rejects.toBe(error);

            const toastr_error = (globalThis as any).toastr.error as jest.Mock;
            expect(toastr_error).toHaveBeenCalledTimes(1);
            expect(toastr_error).toHaveBeenCalledWith(
                i18n.global.t(message_key),
                i18n.global.t('runtime.extraModel.updateFailedTitle')
            );
            const observable_toast = JSON.stringify(toastr_error.mock.calls);
            expect(observable_toast).not.toContain('secret');
            expect(observable_toast).not.toContain('Bearer');
            expect(observable_toast).not.toContain(i18n.global.t('runtime.pi.toolRequestRejected'));
            expect(observable_toast).not.toContain(
                i18n.global.t('runtime.pi.structuredOutputRequestRejected')
            );
            expect(observable_toast).not.toContain(
                i18n.global.t('runtime.pi.jsonObjectRequestRejected')
            );
            expect(mockHandleVariablesInMessage).not.toHaveBeenCalled();
        }
    );

    test('does not turn a non-Pi request failure into a More-source toastr message', async () => {
        useDataStore().settings.额外模型解析配置.模型来源 = '自定义';
        useDataStore().settings.额外模型解析配置.应答格式 = '聊天消息';
        const error = new Error('legacy failure');
        mockInvokeExtraModelWithStrategy.mockRejectedValueOnce(error);

        await expect(onMessageReceived(1)).rejects.toBe(error);

        expect((globalThis as any).toastr.error).not.toHaveBeenCalled();
    });
});
