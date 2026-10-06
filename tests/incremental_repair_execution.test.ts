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

    test.each([
        '<Think>unfinished',
        '<JSONPatch>[{"op":"replace","path":"/hp","value":999}]',
        '<UpdateVariable><JSONPatch>[{"value":"unfinished',
        '"unfinished',
        '/*unfinished',
    ])(
        'appends outside unfinished original boundaries and restores them on undo: %s',
        async tail => {
            const original = "_.set('hp', 75);\n" + tail;
            SillyTavern.chat[1].mes = original;
            SillyTavern.chat[1].swipes![0] = original;
            const originalMessage = klona(SillyTavern.chat[1]);
            const reply =
                '<UpdateVariable><JSONPatch>[{"op":"delta","path":"/hp","value":5}]</JSONPatch></UpdateVariable>';
            jest.mocked(invokeExtraModelWithStrategy).mockImplementation(async options =>
                options!.validate_result!(reply)
            );

            await runIncrementalExtraModelRepair();

            expect(toastr.error).not.toHaveBeenCalled();
            expect(SillyTavern.chat[1].mes.startsWith(original)).toBe(true);
            expect(
                SillyTavern.chat[1].mes.endsWith(
                    '<JSONPatch>[{"op":"delta","path":"/hp","value":5}]</JSONPatch>'
                )
            ).toBe(true);
            expect(SillyTavern.chat[1].variables![0].stat_data.hp).toBe(80);
            const undo = (toastr.success as jest.Mock).mock.calls[0][2].onclick;
            await undo();
            expect(SillyTavern.chat[1]).toEqual(originalMessage);
            expect(SillyTavern.chatMetadata.variables.stat_data.hp).toBe(75);
        }
    );

    test('writes only replayed metadata and restores the latest pre-repair snapshots on undo', async () => {
        const previous = SillyTavern.chat[0].variables![0] as MvuData;
        previous.schema.strictSet = false;
        previous.initialized_lorebooks = { existing: [] };
        const current = SillyTavern.chat[1].variables![0] as MvuData;
        current.stat_data.current_floor_only = 'worldbook value';
        current.initialized_lorebooks = { existing: [], new_book: ['worldbook value'] };
        SillyTavern.chatMetadata.variables = klona(current);

        let originalMessage: (typeof SillyTavern.chat)[number] | undefined;
        let originalChatVariables: MvuData | undefined;
        (SillyTavern.callGenericPopup as jest.Mock)
            .mockReset()
            .mockResolvedValueOnce('')
            .mockImplementationOnce(async () => {
                // 等待确认期间刷新的元数据用于并发比较和撤销，但不能覆盖重放结果。
                current.schema.strictSet = true;
                current.display_data = { hp: 'message display refresh' };
                current.delta_data = { hp: 'message delta refresh' };
                const chat = SillyTavern.chatMetadata.variables as MvuData;
                chat.schema.strictSet = true;
                chat.display_data = { hp: 'chat display refresh' };
                chat.delta_data = { hp: 'chat delta refresh' };
                chat.initialized_lorebooks.chat_only = [];
                originalMessage = klona(SillyTavern.chat[1]);
                originalChatVariables = klona(chat);
                return 1;
            });
        jest.mocked(invokeExtraModelWithStrategy).mockImplementation(async options =>
            options!.validate_result!("_.set('hp', 80);")
        );

        await runIncrementalExtraModelRepair();

        expect(toastr.error).not.toHaveBeenCalled();
        const applied = SillyTavern.chat[1].variables![0] as MvuData;
        expect(applied.stat_data).toEqual({ hp: 80 });
        expect(applied.initialized_lorebooks).toEqual({ existing: [] });
        expect(applied.schema.strictSet).toBe(false);
        expect(applied.schema.properties).not.toHaveProperty('current_floor_only');
        expect(applied.display_data?.hp).toContain('75->80');
        expect(applied.delta_data?.hp).toContain('75->80');
        expect(SillyTavern.chatMetadata.variables).toEqual(applied);
        expect(previous.stat_data).toEqual({ hp: 72 });
        expect(previous.initialized_lorebooks).toEqual({ existing: [] });

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
