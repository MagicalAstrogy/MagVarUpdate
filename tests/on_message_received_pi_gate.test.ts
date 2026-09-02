import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import { onMessageReceived } from '@/function/update/on_message_received';
import { handleVariablesInMessage } from '@/function/update_variables';
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
});
