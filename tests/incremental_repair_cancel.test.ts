import { runIncrementalExtraModelRepair } from '@/function/update/incremental_repair';
import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import { useDataStore } from '@/store';

jest.mock('@/function/is_extra_model_supported', () => ({
    isExtraModelSupported: async () => true,
}));
jest.mock('@/function/update/invoke_extra_model', () => ({
    invokeExtraModelWithStrategy: jest.fn(),
}));

describe('incremental repair input cancellation', () => {
    beforeEach(() => {
        const data = { stat_data: { hp: 72 }, schema: {} };
        const g = globalThis as any;
        g.toastr = { error: jest.fn(), warning: jest.fn(), info: jest.fn() };
        useDataStore().settings.更新方式 = '额外模型解析';
        useDataStore().settings.额外模型解析配置.应答格式 = '聊天消息';
        g.getLastMessageId = jest.fn(() => 1);
        g.getChatMessages = jest.fn(() => [{ role: 'assistant', message: 'story' }]);
        g.getVariables = jest.fn(() => data);
        g.SillyTavern.chat = [{ variables: [data] }, { swipe_id: 0 }];
        g.SillyTavern.getCurrentChatId = jest.fn(() => 'test');
        g.SillyTavern.POPUP_TYPE = { INPUT: 3 };
        g.SillyTavern.callGenericPopup = jest.fn();
        jest.mocked(invokeExtraModelWithStrategy).mockReset().mockResolvedValue(null);
    });

    test.each([false, null, undefined, 0])(
        'does not request a model after cancellation %p',
        async result => {
            (SillyTavern.callGenericPopup as jest.Mock).mockResolvedValue(result);
            await runIncrementalExtraModelRepair();
            expect(SillyTavern.callGenericPopup).toHaveBeenCalledTimes(1);
            expect(invokeExtraModelWithStrategy).not.toHaveBeenCalled();
        }
    );

    test('empty confirmed input still requests automatic audit', async () => {
        (SillyTavern.callGenericPopup as jest.Mock).mockResolvedValue('');
        await runIncrementalExtraModelRepair();
        expect(invokeExtraModelWithStrategy).toHaveBeenCalledTimes(1);
    });
});
