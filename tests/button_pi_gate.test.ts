import { buttons } from '@/button';
import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { onMessageReceived } from '@/function/update/on_message_received';
import { useDataStore } from '@/store';

jest.mock('@/function/is_extra_model_supported', () => ({
    isExtraModelSupported: jest.fn(),
}));
jest.mock('@/function/update/on_message_received', () => ({
    onMessageReceived: jest.fn(),
}));

const mockIsExtraModelSupported = jest.mocked(isExtraModelSupported);
const mockOnMessageReceived = jest.mocked(onMessageReceived);
const retryExtraModel = buttons.find(button => button.name === '重试额外模型解析')!.function;

describe('retry extra model button Pi source gate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete globalThis.__MVU_PI_MULTIPROVIDER_ENABLED__;

        const store = useDataStore();
        store.settings.更新方式 = '额外模型解析';
        store.settings.额外模型解析配置.应答格式 = '工具调用';
        store.versions.tavernhelper = '4.8.3';

        (globalThis as any).SillyTavern.ToolManager.isToolCallingSupported.mockReturnValue(false);
        (globalThis as any).getLastMessageId.mockReturnValue(1);
        (globalThis as any).getChatMessages.mockReturnValue([
            { message: 'A sufficiently long reply', name: 'Assistant' },
        ]);
        (globalThis as any).toastr = { info: jest.fn() };

        mockIsExtraModelSupported.mockResolvedValue(true);
        mockOnMessageReceived.mockResolvedValue(undefined);
    });

    test('retries through Pi without Tavern Helper or ToolManager tool calling support', async () => {
        useDataStore().settings.额外模型解析配置.模型来源 = '更多';

        await retryExtraModel();

        expect(mockIsExtraModelSupported).toHaveBeenCalledTimes(1);
        expect(mockOnMessageReceived).toHaveBeenCalledWith(1, { force: true });
    });

    test('does not enter Pi when the release kill switch is off', async () => {
        globalThis.__MVU_PI_MULTIPROVIDER_ENABLED__ = false;
        useDataStore().settings.额外模型解析配置.模型来源 = '更多';

        await retryExtraModel();

        expect(mockIsExtraModelSupported).not.toHaveBeenCalled();
        expect(mockOnMessageReceived).not.toHaveBeenCalled();
        expect((globalThis as any).toastr.info).toHaveBeenCalled();
    });

    test.each(['与插头相同', '自定义'] as const)(
        'keeps the existing unsupported message for %s',
        async model_source => {
            useDataStore().settings.额外模型解析配置.模型来源 = model_source;

            await retryExtraModel();

            expect(mockIsExtraModelSupported).not.toHaveBeenCalled();
            expect(mockOnMessageReceived).not.toHaveBeenCalled();
            expect((globalThis as any).toastr.info).toHaveBeenCalled();
        }
    );
});
