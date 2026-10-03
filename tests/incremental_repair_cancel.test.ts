import { runIncrementalExtraModelRepair } from '@/function/update/incremental_repair';
import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import { useDataStore } from '@/store';
import { variable_events } from '@/variable_def';

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
        expect(invokeExtraModelWithStrategy).toHaveBeenCalledWith(
            expect.objectContaining({
                task: expect.stringContaining('增量变量校正'),
                validate_result: expect.any(Function),
            })
        );
        expect(jest.mocked(invokeExtraModelWithStrategy).mock.calls[0][0]).not.toHaveProperty(
            'task_suffix'
        );
    });

    test.each(['schema', 'display_data', 'delta_data', 'initialized_lorebooks'])(
        'allows derived %s refreshes while the input popup is open',
        async key => {
            (SillyTavern.callGenericPopup as jest.Mock).mockImplementation(async () => {
                const data = getVariables({ type: 'message', message_id: 1 });
                data[key] = { changed: true };
                return '';
            });
            await runIncrementalExtraModelRepair();
            expect(invokeExtraModelWithStrategy).toHaveBeenCalledTimes(1);
            expect(toastr.warning).not.toHaveBeenCalled();
        }
    );

    test('rejects an actual stat_data change while the input popup is open', async () => {
        (SillyTavern.callGenericPopup as jest.Mock).mockImplementation(async () => {
            const data = getVariables({ type: 'message', message_id: 1 });
            data.stat_data.hp = 71;
            return '';
        });
        await runIncrementalExtraModelRepair();
        expect(invokeExtraModelWithStrategy).not.toHaveBeenCalled();
        expect(toastr.warning).toHaveBeenCalled();
    });

    test('rejects a new latest floor while the input popup is open', async () => {
        (SillyTavern.callGenericPopup as jest.Mock).mockImplementation(async () => {
            (getLastMessageId as jest.Mock).mockReturnValue(2);
            return '';
        });
        await runIncrementalExtraModelRepair();
        expect(invokeExtraModelWithStrategy).not.toHaveBeenCalled();
    });

    test('validates each model attempt against the latest complete variable context', async () => {
        (SillyTavern.callGenericPopup as jest.Mock).mockResolvedValue('');
        const patch = '<JSONPatch>[{"op":"replace","path":"/hp","value":80}]</JSONPatch>';
        const trialSchemas: unknown[] = [];
        eventOn(variable_events.VARIABLE_UPDATE_STARTED, variables => {
            trialSchemas.push(variables.schema.strictSet);
        });
        jest.mocked(invokeExtraModelWithStrategy).mockImplementation(async options => {
            const latest = {
                ...getVariables({ type: 'message', message_id: 1 }),
                schema: { strictSet: true },
            };
            (getVariables as jest.Mock).mockReturnValue(latest);
            await expect(options!.validate_result!(patch)).resolves.toContain('<JSONPatch>');
            expect(latest).toEqual({ stat_data: { hp: 72 }, schema: { strictSet: true } });
            return null;
        });

        await runIncrementalExtraModelRepair();

        expect(trialSchemas).toEqual([true]);
    });

    test('does not preview a result if live state changes while trial callbacks are awaited', async () => {
        (SillyTavern.callGenericPopup as jest.Mock).mockResolvedValue('');
        jest.mocked(invokeExtraModelWithStrategy).mockResolvedValue(
            '<JSONPatch>[{"op":"replace","path":"/hp","value":80}]</JSONPatch>'
        );
        let signalStarted!: () => void;
        let finishTrial!: () => void;
        const started = new Promise<void>(resolve => {
            signalStarted = resolve;
        });
        const waiting = new Promise<void>(resolve => {
            finishTrial = resolve;
        });
        eventOn(variable_events.VARIABLE_UPDATE_STARTED, async () => {
            signalStarted();
            await waiting;
        });

        const run = runIncrementalExtraModelRepair();
        await started;
        getVariables({ type: 'message', message_id: 1 }).stat_data.hp = 71;
        finishTrial();
        await run;

        expect(SillyTavern.callGenericPopup).toHaveBeenCalledTimes(1);
        expect(toastr.warning).toHaveBeenCalledWith(
            expect.stringContaining('等待期间'),
            expect.any(String)
        );
        expect(getVariables({ type: 'message', message_id: 1 }).stat_data.hp).toBe(71);
    });
});
