import { nextTick } from 'vue';
import { getPendingWorldinfoRequests } from '@/function/request/worldinfo_request';
import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import { useDataStore } from '@/store';

const REPLY = "<UpdateVariable>\n_.set('x', 1);\n</UpdateVariable>";
const ENTRIES = [{ comment: '[mvu_update]' }];

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => {
        resolve = res;
    });
    return { promise, resolve };
}

// 等待已解除阻塞的登记及生成 promise 链完成，不依赖固定次数的微任务轮询。
const flushRequests = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('extra model concurrent request cancellation', () => {
    beforeEach(async () => {
        const store = useDataStore();
        store.should_enable = true;
        await nextTick();
        store.settings.更新方式 = '额外模型解析';
        store.settings.额外模型解析配置.应答格式 = '聊天消息';
        store.settings.额外模型解析配置.模型来源 = '与插头相同';
        store.settings.额外模型解析配置.请求方式 = '同时请求多次';
        store.settings.额外模型解析配置.请求次数 = 2;
        store.settings.额外模型解析配置.破限方案 = '使用当前预设';
        store.settings.额外模型解析配置.其他预设名称 = 'analysis';
        store.settings.通知.额外模型解析中 = false;
        (globalThis as any).getCurrentCharPrimaryLorebook = jest.fn(() => 'character');
        (globalThis as any).getLorebookEntries = jest.fn().mockResolvedValue(ENTRIES);
        (globalThis as any).getPresetNames = jest.fn(() => ['analysis']);
        (globalThis as any).getPreset = jest.fn(() => ({ prompts: [] }));
        (globalThis as any).SillyTavern.getChatCompletionModel = jest.fn(() => 'test-model');
        (SillyTavern.registerMacro as jest.Mock).mockClear();
        const run = jest.fn().mockResolvedValue(REPLY);
        (globalThis as any).generate = run;
        (globalThis as any).generateRaw = run;
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        expect(getPendingWorldinfoRequests()).toHaveLength(0);
        for (const name of [
            'generate',
            'generateRaw',
            'getCurrentCharPrimaryLorebook',
            'getLorebookEntries',
            'getPresetNames',
            'getPreset',
        ]) {
            delete (globalThis as any)[name];
        }
        delete (globalThis as any).SillyTavern.getChatCompletionModel;
        jest.restoreAllMocks();
    });

    test.each(['使用当前预设', '使用其他预设', '使用内置破限'] as const)(
        'does not start delayed requests after a sibling wins using %s',
        async preset => {
            const store = useDataStore();
            store.settings.额外模型解析配置.破限方案 = preset;
            const slow_entries = deferred<typeof ENTRIES>();
            (getLorebookEntries as jest.Mock)
                .mockResolvedValueOnce(ENTRIES)
                .mockReturnValueOnce(slow_entries.promise);

            await expect(invokeExtraModelWithStrategy()).resolves.toBe(REPLY);
            expect(getLorebookEntries).toHaveBeenCalledTimes(2);
            expect(generate).toHaveBeenCalledTimes(1);
            expect(stopGenerationById).toHaveBeenCalledTimes(2);
            expect(store.runtimes.is_during_extra_analysis).toBe(false);

            slow_entries.resolve(ENTRIES);
            await flushRequests();

            expect(generate).toHaveBeenCalledTimes(1);
            expect(SillyTavern.registerMacro).toHaveBeenCalledTimes(1);
            expect(store.runtimes.is_during_extra_analysis).toBe(false);
        }
    );

    test('keeps a finished batch canceled while a new batch is active', async () => {
        const slow_entries = deferred<typeof ENTRIES>();
        (getLorebookEntries as jest.Mock)
            .mockResolvedValueOnce(ENTRIES)
            .mockReturnValueOnce(slow_entries.promise);
        await expect(invokeExtraModelWithStrategy()).resolves.toBe(REPLY);

        const next_started = deferred<void>();
        const next_reply = deferred<string>();
        (generate as jest.Mock).mockImplementationOnce(() => {
            next_started.resolve();
            return next_reply.promise;
        });
        useDataStore().settings.额外模型解析配置.请求次数 = 1;
        const next_batch = invokeExtraModelWithStrategy();
        await next_started.promise;
        const next_requests = getPendingWorldinfoRequests();
        try {
            slow_entries.resolve(ENTRIES);
            await flushRequests();

            expect(generate).toHaveBeenCalledTimes(2);
            expect(next_requests).toHaveLength(1);
            expect(getPendingWorldinfoRequests()).toEqual(next_requests);
            expect(useDataStore().runtimes.is_during_extra_analysis).toBe(true);
        } finally {
            next_reply.resolve(REPLY);
            await next_batch;
        }
    });

    test('allows a delayed request to win after its sibling fails', async () => {
        const slow_entries = deferred<typeof ENTRIES>();
        const first_failed = deferred<void>();
        (getLorebookEntries as jest.Mock)
            .mockResolvedValueOnce(ENTRIES)
            .mockReturnValueOnce(slow_entries.promise);
        (generate as jest.Mock).mockImplementationOnce(async () => {
            first_failed.resolve();
            throw new Error('first request failed');
        });

        const batch = invokeExtraModelWithStrategy();
        await first_failed.promise;
        await flushRequests();
        expect(stopGenerationById).not.toHaveBeenCalled();
        slow_entries.resolve(ENTRIES);

        await expect(batch).resolves.toBe(REPLY);
        expect(generate).toHaveBeenCalledTimes(2);
        expect(useDataStore().runtimes.is_during_extra_analysis).toBe(false);
    });
});
