import { runIncrementalExtraModelRepair } from '@/function/update/incremental_repair';
import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import { useDataStore } from '@/store';
import { type MvuData, variable_events } from '@/variable_def';
import { klona } from 'klona';

jest.mock('@/function/is_extra_model_supported', () => ({
    isExtraModelSupported: async () => true,
}));
jest.mock('@/function/update/invoke_extra_model', () => ({
    invokeExtraModelWithStrategy: jest.fn(),
}));

/** 通过真实试执行、整楼重放及提交验证解析语义一致，模型请求与宿主 UI 使用模拟实现。 */
describe('incremental repair executor integration', () => {
    const originalText = "story\n<UpdateVariable>_.set('hp', 75);</UpdateVariable>";
    const data = (hp: number): MvuData => ({
        stat_data: { hp },
        schema: { type: 'object', properties: {}, extensible: true },
        initialized_lorebooks: {},
    });
    beforeEach(() => {
        jest.clearAllMocks();
        const g = globalThis as any;
        g.toastr = { error: jest.fn(), warning: jest.fn(), info: jest.fn(), success: jest.fn() };
        useDataStore().settings.更新方式 = '额外模型解析';
        useDataStore().settings.额外模型解析配置.应答格式 = '聊天消息';
        useDataStore().settings.兼容性.更新到聊天变量 = true;
        g.SillyTavern.chat = [
            { swipe_id: 0, variables: [data(72)] },
            { swipe_id: 0, mes: originalText, swipes: [originalText], variables: [data(75)] },
        ];
        g.SillyTavern.chatMetadata = { variables: data(75) };
        g.SillyTavern.getCurrentChatId = jest.fn(() => 'trial');
        g.getLastMessageId = jest.fn(() => 1);
        g.getChatMessages = jest.fn(() => [
            { role: 'assistant', message: SillyTavern.chat[1].mes },
        ]);
        g.getVariables = jest.fn(({ type }: { type: string }) =>
            type === 'chat' ? SillyTavern.chatMetadata.variables : SillyTavern.chat[1].variables![0]
        );
        g.SillyTavern.POPUP_TYPE = { INPUT: 3, CONFIRM: 2 };
        g.SillyTavern.callGenericPopup = jest.fn().mockResolvedValueOnce('').mockResolvedValue(1);
        g.SillyTavern.saveChat = jest.fn().mockResolvedValue(undefined);
        g.setChatMessages = jest.fn().mockResolvedValue(undefined);
        jest.mocked(invokeExtraModelWithStrategy).mockReset();
    });

    test.each([
        "_.add('hp', 5);",
        '<JSONPatch>[{"op":"delta","path":"/hp","value":5}]</JSONPatch>',
        '<JSONPatch>[{"op":"unknown","path":"/hp"},{"op":"replace","path":"/hp","value":80}]</JSONPatch>',
        '<JSONPatch>invalid</JSONPatch>' + "_.set('hp', 80);",
        '<JSONPatch>[]</JSONPatch><JSONPatch>[{"op":"replace","path":"/hp","value":80}]</JSONPatch>',
    ])('commits and undoes an update accepted by the normal executor: %s', async reply => {
        const originalMessage = klona(SillyTavern.chat[1]);
        const originalChatVariables = klona(SillyTavern.chatMetadata.variables);
        jest.mocked(invokeExtraModelWithStrategy).mockImplementation(async options => {
            const accepted = await options!.validate_result!(reply);
            expect(accepted).toBe(reply);
            expect(SillyTavern.chat[1]).toEqual(originalMessage);
            return accepted;
        });

        await runIncrementalExtraModelRepair();

        expect(toastr.error).not.toHaveBeenCalled();
        expect(SillyTavern.callGenericPopup).toHaveBeenCalledTimes(2);
        expect(SillyTavern.chat[1].variables![0].stat_data.hp).toBe(80);
        expect(SillyTavern.chatMetadata.variables.stat_data.hp).toBe(80);
        expect(SillyTavern.chat[1].mes).toContain(reply);
        expect(SillyTavern.chat[1].swipes![0]).toBe(SillyTavern.chat[1].mes);
        expect(toastr.success).toHaveBeenCalledTimes(1);

        const undo = (toastr.success as jest.Mock).mock.calls[0][2].onclick;
        await undo();
        expect(SillyTavern.chat[1]).toEqual(originalMessage);
        expect(SillyTavern.chatMetadata.variables).toEqual(originalChatVariables);
    });

    test('retains acceptance when the original floor reports an unrelated replay error', async () => {
        SillyTavern.chat[1].mes += "\n_.set('missing', 1);";
        eventOn(
            variable_events.COMMAND_PARSED + '_for_zod',
            (_data, _commands, content, onError) => {
                if (content.startsWith('story')) onError?.('original floor warning');
            }
        );
        jest.mocked(invokeExtraModelWithStrategy).mockImplementation(async options =>
            options!.validate_result!("_.set('hp', 80);")
        );
        jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await runIncrementalExtraModelRepair();
            expect(SillyTavern.chat[1].variables![0].stat_data.hp).toBe(80);
            expect(SillyTavern.chatMetadata.variables.stat_data.hp).toBe(80);
            expect(toastr.error).not.toHaveBeenCalled();
            expect(toastr.success).toHaveBeenCalledTimes(1);
            expect(SillyTavern.saveChat).toHaveBeenCalledTimes(1);
        } finally {
            jest.restoreAllMocks();
        }
    });
});
