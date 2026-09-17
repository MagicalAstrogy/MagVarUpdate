import { initRequest, initWorldinfoFilter } from '@/function/request';
import type { LoreEntries } from '@/function/request/filter_entries';
import {
    registerWorldinfoRequest,
    getPendingWorldinfoRequests,
} from '@/function/request/worldinfo_request';
import type { WorldinfoScanData } from '@/function/request/worldinfo_scan';
import { useDataStore } from '@/store';
import { nextTick } from 'vue';

const lores = (): LoreEntries => ({
    characterLore: [
        { world: 'character', uid: 1, comment: '[mvu_update]', content: 'UPDATE' },
        { world: 'character', uid: 2, comment: '[mvu_plot]', content: 'PLOT' },
    ],
    globalLore: [],
    chatLore: [],
    personaLore: [],
});

describe('instance-level worldinfo listeners', () => {
    const stops: Array<() => void> = [];
    beforeEach(async () => {
        const store = useDataStore();
        store.should_enable = true;
        await nextTick();
        store.settings.更新方式 = '额外模型解析';
        store.settings.兼容性.额外模型解析非阻塞 = false;
        store.settings.额外模型解析配置.应答格式 = '聊天消息';
        store.runtimes.is_during_extra_analysis = true;
        (globalThis as any).getCurrentCharPrimaryLorebook = jest.fn(() => 'character');
        (globalThis as any).getLorebookEntries = jest.fn(async () => [{ comment: '[mvu_update]' }]);
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'debug').mockImplementation(() => {});
        jest.mocked(eventOn).mockClear();
        jest.mocked(eventRemoveListener).mockClear();
    });
    afterEach(() => {
        stops
            .splice(0)
            .reverse()
            .forEach(stop => stop());
        expect(getPendingWorldinfoRequests()).toHaveLength(0);
        jest.restoreAllMocks();
    });

    test('keeps an in-flight scan registered across chat-level teardown and reinitialization', async () => {
        useDataStore().settings.兼容性.额外模型解析非阻塞 = true;
        stops.push(initWorldinfoFilter());
        const stop_chat = initRequest();
        stops.push(
            await registerWorldinfoRequest('in-flight', useDataStore().settings.额外模型解析配置)
        );
        const request = getPendingWorldinfoRequests()[0];
        const loaded = lores();
        await (globalThis as any).eventEmit('worldinfo_entries_loaded', loaded);
        const sortedEntries = structuredClone(loaded.characterLore);
        const business = sortedEntries.filter(entry => entry.world === 'character');
        const scan: WorldinfoScanData = {
            state: { current: 1, next: 0, loopCount: 1 },
            sortedEntries,
            new: {
                all: [
                    ...business,
                    ...sortedEntries.filter(entry => entry.key?.includes(request.marker)),
                ],
                successful: [...business],
            },
            activated: {
                entries: new Map(business.map(entry => [`character.${entry.uid}`, entry])),
                text: '',
            },
        };

        stop_chat();
        // 即使下一聊天的异步初始化尚未完成，本轮扫描仍能经过完整筛选。
        await (globalThis as any).eventEmit('worldinfo_scan_done', scan);
        expect(scan.sortedEntries.map(entry => entry.content)).toEqual(['UPDATE']);
        expect([...scan.activated.entries.values()].map(entry => entry.content)).toEqual([
            'UPDATE',
        ]);
        stops.push(initRequest());
        for (const name of ['worldinfo_entries_loaded', 'worldinfo_scan_done']) {
            expect(
                jest.mocked(eventOn).mock.calls.filter(([event]) => event === name)
            ).toHaveLength(1);
            expect(
                jest.mocked(eventRemoveListener).mock.calls.filter(([event]) => event === name)
            ).toHaveLength(0);
        }
    });

    test('keeps listeners installed while disabled and resumes filtering when this instance is enabled', async () => {
        stops.push(initWorldinfoFilter());
        const store = useDataStore();
        store.should_enable = false;
        await nextTick();
        const disabled = lores();
        await (globalThis as any).eventEmit('worldinfo_entries_loaded', disabled);
        expect(disabled.characterLore.map(entry => entry.content)).toEqual(['UPDATE', 'PLOT']);

        store.should_enable = true;
        await nextTick();
        const enabled = lores();
        await (globalThis as any).eventEmit('worldinfo_entries_loaded', enabled);
        expect(enabled.characterLore.map(entry => entry.content)).toEqual(['UPDATE']);
        expect(
            jest
                .mocked(eventOn)
                .mock.calls.filter(([event]) => event === 'worldinfo_entries_loaded')
        ).toHaveLength(1);
    });

    test('unregisters both worldinfo listeners only when the instance is disposed', async () => {
        const stop = initWorldinfoFilter();
        stop();
        const loaded = lores();
        await (globalThis as any).eventEmit('worldinfo_entries_loaded', loaded);
        expect(loaded.characterLore.map(entry => entry.content)).toEqual(['UPDATE', 'PLOT']);
        for (const name of ['worldinfo_entries_loaded', 'worldinfo_scan_done']) {
            expect(
                jest.mocked(eventRemoveListener).mock.calls.filter(([event]) => event === name)
            ).toHaveLength(1);
        }
    });
});
