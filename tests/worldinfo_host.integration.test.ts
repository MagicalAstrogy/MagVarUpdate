import { nextTick } from 'vue';
import { useDataStore } from '@/store';
import type { LoreEntries } from '@/function/request/filter_entries';
import {
    getPendingWorldinfoRequests,
    registerWorldinfoRequest,
    withWorldinfoRequestMarker,
} from '@/function/request/worldinfo_request';
import {
    onWorldinfoEntriesLoaded,
    onWorldinfoScanDone,
    type WorldinfoScanData,
} from '@/function/request/worldinfo_scan';
import { createWorldinfoHost, worldinfoHostPath } from './helpers/worldinfo_host';
import { generateExtraModel } from '@/function/update/invoke_extra_model';

const describeHost = worldinfoHostPath ? describe : describe.skip;
/** 创建默认常驻的宿主业务条目，允许用例覆盖关键词、递归或定时效果字段。 */
const entry = (uid: number, comment: string, content: string, extra: Record<string, any> = {}) => ({
    world: 'character',
    uid,
    comment,
    content,
    constant: true,
    order: 100 - uid,
    position: 0,
    disable: false,
    key: [],
    keysecondary: [],
    useProbability: false,
    ...extra,
});
/** 将业务条目放入角色来源，补齐宿主加载回调需要的四组数组。 */
const books = (entries: Record<string, any>[]): LoreEntries => ({
    characterLore: entries,
    globalLore: [],
    chatLore: [],
    personaLore: [],
});

/** 执行本机 ST 的真实加载、扫描、预算和递归代码；只替换 I/O、宏正则及 tokenizer。 */
describeHost('native WorldInfo scanner request isolation', () => {
    const releases: Array<() => void> = [];
    beforeEach(async () => {
        const store = useDataStore();
        store.should_enable = true;
        await nextTick();
        store.settings.更新方式 = '额外模型解析';
        store.settings.额外模型解析配置.应答格式 = '聊天消息';
        store.settings.额外模型解析配置.世界书条目白名单正则 = '';
        store.settings.额外模型解析配置.世界书条目黑名单正则 = '';
        store.runtimes.is_during_extra_analysis = true;
        (globalThis as any).getCurrentCharPrimaryLorebook = jest.fn(() => 'character');
        (globalThis as any).getLorebookEntries = jest.fn(async () => [{ comment: '[mvu_update]' }]);
        (SillyTavern.getCharacterCardFields as jest.Mock).mockReturnValue({
            description: 'original description',
        });
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        releases.splice(0).forEach(release => release());
        delete (globalThis as any).generate;
        delete (globalThis as any).generateRaw;
        delete (globalThis as any).getPreset;
        delete (globalThis as any).getPresetNames;
        jest.restoreAllMocks();
    });
    /** 登记独立过滤策略并生成带标记的调用配置，由用例清理阶段统一释放登记。 */
    async function request(id: string, whitelist = '') {
        useDataStore().settings.额外模型解析配置.世界书条目白名单正则 = whitelist;
        releases.push(await registerWorldinfoRequest(id, useDataStore().settings.额外模型解析配置));
        return withWorldinfoRequestMarker({ generation_id: id });
    }

    test('isolates two overlapping requests and an unmarked request using actual scanData', async () => {
        const a = await request('A', '^A$');
        const b = await request('B', '^B$');
        const input = books([
            entry(1, '[mvu_update]', 'UPDATE'),
            entry(2, '[mvu_plot]', 'PLOT'),
            entry(3, 'A', 'SETTING_A'),
            entry(4, 'B', 'SETTING_B'),
        ]);
        const original = JSON.stringify(input);
        const candidates: number[] = [];
        const host = createWorldinfoHost({
            books: input,
            loaded: onWorldinfoEntriesLoaded,
            scan: async data => {
                candidates.push(
                    data.new.all.filter(item => item.world.startsWith('龘靐齉')).length
                );
                expect(
                    [...data.activated.entries.values()].some(item =>
                        item.world.startsWith('龘靐齉')
                    )
                ).toBe(false);
                await onWorldinfoScanDone(data);
            },
        });
        const results = await Promise.all([host.run(a), host.run(b), host.run({})]);
        expect(results.map(result => result.worldInfoBefore.split('\n').sort())).toEqual([
            ['SETTING_A', 'UPDATE'],
            ['SETTING_B', 'UPDATE'],
            ['PLOT', 'SETTING_A', 'SETTING_B'],
        ]);
        expect(candidates.sort()).toEqual([0, 1, 1]);
        expect(JSON.stringify(input)).toBe(original);
    });

    test('a legitimate lorebook name sharing the old probe prefix retains its entries', async () => {
        const config = await request('prefix');
        const input = books([
            entry(1, '[mvu_update]', 'UPDATE', { world: '__MVU_WI_PROBE_user_book' }),
            entry(2, 'setting', 'SETTING', { world: '__MVU_WI_PROBE_user_book' }),
        ]);
        // 不安装 MVU 回调的宿主扫描确认这些是正常、可激活的业务条目。
        const baseline = createWorldinfoHost({
            books: input,
            loaded: async () => {},
            scan: async () => {},
        });
        const expected = (await baseline.run({})).worldInfoBefore.split('\n').sort();
        expect(expected).toEqual(['SETTING', 'UPDATE']);
        const host = createWorldinfoHost({
            books: input,
            loaded: onWorldinfoEntriesLoaded,
            scan: onWorldinfoScanDone,
        });
        expect((await host.run(config)).worldInfoBefore.split('\n').sort()).toEqual(expected);
    });

    test('probe checks do not consume token budget, minimum activations, or recursion steps', async () => {
        const config = await request('A');
        let rounds = 0;
        const host = createWorldinfoHost({
            books: books([entry(1, '[mvu_update]', 'U')]),
            settings: {
                world_info_budget_cap: 3,
                world_info_min_activations: 1,
                world_info_max_recursion_steps: 1,
                world_info_recursive: true,
            },
            loaded: onWorldinfoEntriesLoaded,
            scan: async data => {
                rounds++;
                expect(data.activated.entries.size).toBe(1);
                await onWorldinfoScanDone(data);
                expect(data.new.successful).toHaveLength(1);
            },
        });
        expect((await host.run(config)).worldInfoBefore).toBe('U');
        expect(rounds).toBe(1);
    });

    test('preserves business entry hashes and timed effects when probes are present', async () => {
        const config = await request('A');
        const input = books([entry(1, '[mvu_update]', 'U', { sticky: 2 })]);
        let originalHash: number | undefined;
        const baseline = createWorldinfoHost({
            books: input,
            loaded: async () => {},
            scan: async data => {
                originalHash = data.sortedEntries[0].hash;
            },
        });
        await baseline.run({});
        const host = createWorldinfoHost({
            books: input,
            loaded: onWorldinfoEntriesLoaded,
            scan: async data => {
                expect(data.sortedEntries.find(item => item.world === 'character')?.hash).toBe(
                    originalHash
                );
                await onWorldinfoScanDone(data);
            },
        });
        await host.run(config);
        expect(host.metadata).toEqual(baseline.metadata);
        expect(JSON.stringify(host.metadata)).not.toContain('__MVU');
    });

    test('continues filtering later recursion rounds after removing the probe', async () => {
        const config = await request('A');
        const rounds: WorldinfoScanData['state'][] = [];
        const host = createWorldinfoHost({
            books: books([
                entry(1, '[mvu_update]', 'TRIGGER'),
                entry(2, 'recursive context', 'SECOND', { constant: false, key: ['TRIGGER'] }),
            ]),
            settings: { world_info_recursive: true },
            loaded: onWorldinfoEntriesLoaded,
            scan: async data => {
                rounds.push({ ...data.state });
                await onWorldinfoScanDone(data);
                expect(data.sortedEntries.every(item => item.world === 'character')).toBe(true);
            },
        });
        expect((await host.run(config)).worldInfoBefore.split('\n').sort()).toEqual([
            'SECOND',
            'TRIGGER',
        ]);
        expect(rounds.length).toBeGreaterThan(1);
        expect(getPendingWorldinfoRequests()).toHaveLength(1);
    });

    test.each(['使用当前预设', '使用其他预设', '使用内置破限'] as const)(
        'registers and cleans the actual extra-model call using %s',
        async preset => {
            const store = useDataStore();
            store.runtimes.is_during_extra_analysis = false;
            store.settings.额外模型解析配置.破限方案 = preset;
            store.settings.额外模型解析配置.其他预设名称 = 'analysis';
            (globalThis as any).getPresetNames = jest.fn(() => ['analysis']);
            (globalThis as any).getPreset = jest.fn(() => ({ prompts: [] }));
            (globalThis as any).SillyTavern.getChatCompletionModel = jest.fn(() => 'test-model');
            const host = createWorldinfoHost({
                books: books([entry(1, '[mvu_update]', 'UPDATE'), entry(2, '[mvu_plot]', 'PLOT')]),
                loaded: onWorldinfoEntriesLoaded,
                scan: onWorldinfoScanDone,
            });
            const run = jest.fn(async (config: GenerateConfig) => {
                expect(getPendingWorldinfoRequests().map(item => item.generation_id)).toEqual([
                    config.generation_id,
                ]);
                const result = await host.run(config);
                expect(result.worldInfoBefore).toBe('UPDATE');
                const data = {
                    chat: [
                        { role: 'system' as const, content: config.overrides!.char_description! },
                        { role: 'system' as const, content: result.worldInfoBefore },
                    ],
                    dryRun: false,
                };
                await eventEmit('chat_completion_prompt_ready', data);
                expect(data.chat[0].content).toBe('original description');
                expect(JSON.stringify(data)).not.toContain('__MVU_WI_REQUEST_');
                return "<UpdateVariable>\n_.set('x', 1);\n</UpdateVariable>";
            });
            (globalThis as any).generate = run;
            (globalThis as any).generateRaw = run;
            await expect(generateExtraModel()).resolves.toContain("_.set('x', 1)");
            expect(run).toHaveBeenCalledTimes(1);
            expect(getPendingWorldinfoRequests()).toHaveLength(0);
            expect(store.runtimes.is_during_extra_analysis).toBe(false);
        }
    );

    test.each(['failure', 'cancel'])(
        'removes pending registration and marker listeners after generation %s',
        async reason => {
            const store = useDataStore();
            store.runtimes.is_during_extra_analysis = false;
            store.settings.额外模型解析配置.破限方案 = '使用当前预设';
            const error = new Error(reason);
            (globalThis as any).generate = jest.fn(async () => {
                expect(getPendingWorldinfoRequests()).toHaveLength(1);
                throw error;
            });
            await expect(generateExtraModel()).rejects.toBe(error);
            expect(getPendingWorldinfoRequests()).toHaveLength(0);
            expect(store.runtimes.is_during_extra_analysis).toBe(false);
        }
    );
});
