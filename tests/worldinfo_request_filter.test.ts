import {
    createEntryFilterContext,
    filterEntries,
    type LoreEntries,
} from '@/function/request/filter_entries';
import {
    getPendingWorldinfoRequests,
    registerWorldinfoRequest,
    stripWorldinfoRequestMarkers,
    withWorldinfoRequestMarker,
} from '@/function/request/worldinfo_request';
import {
    onWorldinfoEntriesLoaded,
    onWorldinfoScanDone,
    type WorldinfoScanData,
} from '@/function/request/worldinfo_scan';
import { useDataStore } from '@/store';
import { nextTick } from 'vue';

type Entry = Record<string, any>;
/** 创建可通过 world/uid 稳定识别的业务条目，正文保留标题以便断言。 */
const entry = (uid: number, comment: string, world = 'character'): Entry => ({
    uid,
    world,
    comment,
    content: `content:${comment}`,
    disable: false,
});
/** 创建同时含更新、剧情和普通条目的独立测试世界书集合。 */
const lores = (): LoreEntries => ({
    characterLore: [entry(1, '[mvu_update]'), entry(2, '[mvu_plot]'), entry(3, 'A'), entry(4, 'B')],
    globalLore: [],
    chatLore: [],
    personaLore: [],
});

/**
 * 构造宿主克隆条目后的事件载荷，用于测试过滤结果和生命周期。
 *
 * 此处只提供可控的候选与激活集合，真实的关键词、概率及预算逻辑由宿主集成测试覆盖。
 *
 * @param loaded 已经过加载回调、可能含探针的四组 lore。
 * @param marker 指定本轮匹配的请求标记；省略时模拟无标记的普通请求。
 * @returns 可供扫描完成回调原地修改的测试载荷。
 */
function scanData(loaded: LoreEntries, marker?: string): WorldinfoScanData {
    const sortedEntries = structuredClone(Object.values(loaded).flat());
    const business = sortedEntries.filter(candidate => candidate.world === 'character');
    const probes = sortedEntries.filter(candidate => marker && candidate.key?.includes(marker));
    return {
        state: { current: 1, next: 0, loopCount: 1 },
        sortedEntries,
        new: { all: [...business, ...probes], successful: [...business] },
        activated: {
            entries: new Map(
                business.map(candidate => [`${candidate.world}.${candidate.uid}`, candidate])
            ),
            text: '',
        },
    };
}

describe('request-scoped worldinfo filtering', () => {
    const releases: Array<() => void> = [];
    beforeEach(async () => {
        const store = useDataStore();
        store.should_enable = true;
        await nextTick();
        store.settings.更新方式 = '额外模型解析';
        store.runtimes.is_during_extra_analysis = true;
        store.settings.额外模型解析配置.模型来源 = '与插头相同';
        store.settings.额外模型解析配置.应答格式 = '聊天消息';
        (globalThis as any).getCurrentCharPrimaryLorebook = jest.fn(() => 'character');
        (globalThis as any).getLorebookEntries = jest.fn(async () => [{ comment: '[mvu_update]' }]);
        (SillyTavern.getCharacterCardFields as jest.Mock).mockReturnValue({
            description: 'original description',
        });
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        releases.splice(0).forEach(release => release());
        expect(getPendingWorldinfoRequests()).toHaveLength(0);
        jest.restoreAllMocks();
    });
    /** 按指定白名单登记测试请求，并把清理函数纳入用例结束后的统一释放列表。 */
    async function register(id: string, whitelist = '') {
        const store = useDataStore();
        store.settings.额外模型解析配置.世界书条目白名单正则 = whitelist;
        releases.push(await registerWorldinfoRequest(id, store.settings.额外模型解析配置));
        return getPendingWorldinfoRequests().find(request => request.generation_id === id)!;
    }

    test('decorates only the matching request configuration without changing the caller or global data', async () => {
        const request = await register('A');
        const config: GenerateConfig = { generation_id: 'A', overrides: { scenario: 'scene' } };
        const decorated = withWorldinfoRequestMarker(config);
        expect(decorated.overrides).toEqual({
            scenario: 'scene',
            char_description: `original description\n${request.marker}`,
        });
        expect(config).toEqual({ generation_id: 'A', overrides: { scenario: 'scene' } });
        const unrelated: GenerateConfig = { generation_id: 'unrelated' };
        expect(withWorldinfoRequestMarker(unrelated)).toBe(unrelated);
        expect(SillyTavern.getCharacterCardFields().description).toBe('original description');
        expect(SillyTavern.saveWorldInfo).not.toHaveBeenCalled();
    });

    test('snapshots Pi tool support independently of the current Tavern model', async () => {
        const store = useDataStore();
        store.versions.tavernhelper = '4.0.0';
        store.settings.额外模型解析配置.模型来源 = '更多';
        store.settings.额外模型解析配置.应答格式 = '工具调用';
        const context = await createEntryFilterContext(true);
        expect(context.tool_calling_unsupported).toBe(false);

        store.settings.额外模型解析配置.模型来源 = '与插头相同';
        const loaded = lores();
        await filterEntries(loaded, context);
        expect(loaded.characterLore.map(candidate => candidate.comment)).toEqual([
            '[mvu_update]',
            'A',
            'B',
        ]);
    });

    test('keeps business entries untouched at loaded and snapshots all in-flight policies', async () => {
        const a = await register('A', '^A$');
        const b = await register('B', '^B$');
        const loaded = lores();
        const original_entries = [...loaded.characterLore];
        const original_json = JSON.stringify(original_entries);
        await onWorldinfoEntriesLoaded(loaded);
        expect(loaded.characterLore.slice(0, 4)).toEqual(original_entries);
        expect(JSON.stringify(original_entries)).toBe(original_json);
        expect(
            loaded.characterLore
                .filter(candidate => candidate.key?.length)
                .map(candidate => candidate.key[0])
        ).toEqual([a.marker, b.marker]);
        for (const probe of loaded.characterLore.slice(4)) {
            expect(probe.content).toBe('');
            expect(probe.probability).toBeLessThan(0);
            expect(probe.preventRecursion).toBe(true);
        }

        // 后续面板变化不能改变已经登记的两个请求；同一份快照也能处理无标记的请求。
        useDataStore().settings.额外模型解析配置.世界书条目白名单正则 = 'nothing';
        const scans = [scanData(loaded, a.marker), scanData(loaded, b.marker), scanData(loaded)];
        await Promise.all(scans.map(onWorldinfoScanDone));
        expect(
            scans.map(scan =>
                [...scan.activated.entries.values()].map(candidate => candidate.comment)
            )
        ).toEqual([
            ['[mvu_update]', 'A'],
            ['[mvu_update]', 'B'],
            ['[mvu_plot]', 'A', 'B'],
        ]);
        expect(
            scans.every(scan =>
                scan.sortedEntries.every(candidate => candidate.world === 'character')
            )
        ).toBe(true);
    });

    test('preserves support from an inactive tagged entry and filters using original lore sources', async () => {
        const a = await register('A');
        const loaded = lores();
        loaded.globalLore = [
            { ...entry(10, '[mvu_plot]', 'supported'), disable: true },
            entry(11, 'shared setting', 'supported'),
            entry(12, 'unrelated setting', 'unsupported'),
        ];
        await onWorldinfoEntriesLoaded(loaded);
        const scan = scanData(loaded, a.marker);
        for (const candidate of scan.sortedEntries.filter(
            candidate => candidate.uid === 11 || candidate.uid === 12
        )) {
            scan.activated.entries.set(`${candidate.world}.${candidate.uid}`, candidate);
            scan.new.all.push(candidate);
            scan.new.successful.push(candidate);
        }
        await onWorldinfoScanDone(scan);
        expect(scan.activated.entries.has('supported.11')).toBe(true);
        expect(scan.activated.entries.has('unsupported.12')).toBe(false);
    });

    test('retains the scan policy after request cleanup and prunes every subsequent scan round', async () => {
        const a = await register('A');
        const loaded = lores();
        await onWorldinfoEntriesLoaded(loaded);
        const scan = scanData(loaded, a.marker);
        const removed = scan.sortedEntries.find(candidate => candidate.comment === '[mvu_plot]')!;
        releases[0]();
        useDataStore().runtimes.is_during_extra_analysis = false;
        await onWorldinfoScanDone(scan);
        scan.activated.entries.set('character.2', removed);
        scan.new = { all: [removed], successful: [removed] };
        scan.state = { current: 2, next: 2, loopCount: 2 };
        scan.activated.text = removed.content;
        await onWorldinfoScanDone(scan);
        expect(scan.activated.entries.has('character.2')).toBe(false);
        expect(scan.new.all).toHaveLength(0);
        expect(scan.new.successful).toHaveLength(0);
        expect(scan.activated.text).toBe('');
    });

    test('keeps the original early main-phase filtering when the extra-analysis gate is closed', async () => {
        await register('A');
        useDataStore().runtimes.is_during_extra_analysis = false;
        const loaded = lores();
        await onWorldinfoEntriesLoaded(loaded);
        expect(loaded.characterLore.map(candidate => candidate.comment)).toEqual([
            '[mvu_plot]',
            'A',
            'B',
        ]);
    });

    test('does not apply extra-analysis rules to unrelated requests while registration is empty', async () => {
        const loaded = lores();
        await onWorldinfoEntriesLoaded(loaded);
        expect(loaded.characterLore.map(candidate => candidate.comment)).toEqual([
            '[mvu_plot]',
            'A',
            'B',
        ]);
    });

    test('does not force a scan when there are no worldinfo entries to filter', async () => {
        await register('A');
        const loaded: LoreEntries = {
            characterLore: [],
            globalLore: [],
            chatLore: [],
            personaLore: [],
        };
        await onWorldinfoEntriesLoaded(loaded);
        expect(Object.values(loaded).flat()).toHaveLength(0);
    });

    test('cleans adjacent marker-only messages and multimodal text before other listeners run', async () => {
        const a = await register('A');
        const b = await register('B');
        const messages: SillyTavern.SendingMessage[] = [
            { role: 'system', content: a.marker },
            { role: 'system', content: b.marker },
            { role: 'user', content: [{ type: 'text', text: `hello\n${a.marker}` }] },
        ];
        const observer = jest.fn((data: { chat: unknown }) => {
            expect(JSON.stringify(data.chat)).not.toContain('__MVU_WI_REQUEST_');
        });
        eventOn('chat_completion_prompt_ready', observer);
        await eventEmit('chat_completion_prompt_ready', { chat: messages, dryRun: false });
        expect(messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]);
        expect(observer).toHaveBeenCalledTimes(1);
        stripWorldinfoRequestMarkers({ messages });
        expect(messages).toHaveLength(1);
    });

    test('does not register outside extra analysis and releases listeners only after the last request', async () => {
        useDataStore().runtimes.is_during_extra_analysis = false;
        await registerWorldinfoRequest('ignored', useDataStore().settings.额外模型解析配置);
        expect(getPendingWorldinfoRequests()).toHaveLength(0);
        useDataStore().runtimes.is_during_extra_analysis = true;
        const a = await register('A');
        await register('B');
        releases[0]();
        releases[0]();
        expect(getPendingWorldinfoRequests().map(request => request.generation_id)).toEqual(['B']);
        const data = { messages: [{ role: 'system', content: `text\n${a.marker}` }] };
        await (globalThis as any).eventEmit('chat_completion_settings_ready', data);
        expect(data.messages[0].content).toBe('text');
        releases[1]();
        expect(eventRemoveListener).toHaveBeenCalledWith(
            'chat_completion_prompt_ready',
            stripWorldinfoRequestMarkers
        );
    });

    test('preserves tool calls when their accompanying marker-only text is removed', async () => {
        const request = await register('A');
        const calls = [
            { id: 'call', type: 'function', function: { name: 'tool', arguments: '{}' } },
        ];
        const messages: SillyTavern.SendingMessage[] = [
            {
                role: 'assistant',
                content: request.marker,
                tool_calls: calls,
            } as SillyTavern.SendingMessage,
        ];
        stripWorldinfoRequestMarkers({ messages });
        expect(messages).toEqual([{ role: 'assistant', content: '', tool_calls: calls }]);
    });

    test('explicit filter contexts do not read a subsequently changed global phase', async () => {
        const context = await createEntryFilterContext(true);
        useDataStore().runtimes.is_during_extra_analysis = false;
        const loaded = lores();
        await filterEntries(loaded, context);
        expect(loaded.characterLore.map(candidate => candidate.comment)).toEqual([
            '[mvu_update]',
            'A',
            'B',
        ]);
    });
});
