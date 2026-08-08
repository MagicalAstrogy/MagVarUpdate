import {
    flushCharacterSettingsOverrideSave,
    initCharacterSettingsOverride,
    setCharacterSettingsOverride,
} from '@/function/character_override';
import { CHARACTER_SETTINGS_OVERRIDE_ENTRY_NAME } from '@/function/character_override/schema';
import { useDataStore } from '@/store';
import { klona } from 'klona';

type TestWorldbook = {
    entries: Record<string, SillyTavern.FlattenedWorldInfoEntry & Record<string, unknown>>;
};

type TestWorldbookUpdater = (
    worldbook: WorldbookEntry[]
) => WorldbookEntry[] | Promise<WorldbookEntry[]>;

function makeRawEntry(
    uid: number,
    content: string,
    {
        comment = CHARACTER_SETTINGS_OVERRIDE_ENTRY_NAME,
        disable = true,
        displayIndex = uid,
    }: { comment?: string; disable?: boolean; displayIndex?: number } = {}
): SillyTavern.FlattenedWorldInfoEntry & Record<string, unknown> {
    return {
        uid,
        displayIndex,
        comment,
        disable,
        constant: false,
        selective: false,
        key: [],
        selectiveLogic: 0,
        keysecondary: [],
        scanDepth: null,
        vectorized: false,
        position: 1,
        role: 0,
        depth: 4,
        order: 100,
        content,
        useProbability: true,
        probability: 100,
        excludeRecursion: false,
        preventRecursion: false,
        delayUntilRecursion: false,
        sticky: null,
        cooldown: null,
        delay: null,
    };
}

function toWorldbookEntry(entry: TestWorldbook['entries'][string]): WorldbookEntry {
    return {
        uid: Number(entry.uid),
        name: String(entry.comment ?? ''),
        enabled: entry.disable !== true,
        strategy: {
            type: 'selective',
            keys: [],
            keys_secondary: { logic: 'and_any', keys: [] },
            scan_depth: 'same_as_global',
        },
        position: {
            type: 'after_character_definition',
            role: 'system',
            depth: 4,
            order: 100,
        },
        content: entry.content,
        probability: 100,
        recursion: {
            prevent_incoming: false,
            prevent_outgoing: false,
            delay_until: null,
        },
        effect: { sticky: null, cooldown: null, delay: null },
    };
}

describe('character settings override manager', () => {
    let worldbook: TestWorldbook;
    let stop: (() => void | Promise<void>) | undefined;
    let applyWorldbookUpdater: (updater: TestWorldbookUpdater) => Promise<WorldbookEntry[]>;
    let persistWorldbook: (name: string, entries: WorldbookEntry[]) => Promise<WorldbookEntry[]>;

    beforeEach(() => {
        worldbook = { entries: {} };
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        (globalThis as any).toastr = {
            warning: jest.fn(),
            info: jest.fn(),
            error: jest.fn(),
        };
        (globalThis as any).getCharWorldbookNames.mockReturnValue({
            primary: 'Character Book',
            additional: [],
        });
        useDataStore().should_enable = true;
        (SillyTavern.loadWorldInfo as jest.Mock).mockImplementation(async () => klona(worldbook));
        (SillyTavern.loadWorldInfo as jest.Mock).mockClear();
        (SillyTavern.saveWorldInfo as jest.Mock).mockClear();
        applyWorldbookUpdater = async updater => {
            const entries = _(worldbook.entries)
                .values()
                .sortBy('displayIndex')
                .map(toWorldbookEntry)
                .value();
            return await updater(klona(entries));
        };
        persistWorldbook = async (name, entries) => {
            worldbook = {
                entries: Object.fromEntries(
                    entries.map((entry, display_index) => {
                        const previous = Object.values(worldbook.entries).find(
                            raw_entry => Number(raw_entry.uid) === entry.uid
                        );
                        return [
                            String(entry.uid),
                            {
                                ...previous,
                                ...makeRawEntry(entry.uid, entry.content, {
                                    comment: entry.name,
                                    disable: !entry.enabled,
                                    displayIndex: display_index,
                                }),
                            },
                        ];
                    })
                ),
            };
            await eventEmit(tavern_events.WORLDINFO_UPDATED, name, klona(worldbook));
            return klona(entries);
        };
        (globalThis as any).updateWorldbookWith.mockReset();
        (globalThis as any).updateWorldbookWith.mockImplementation(
            async (name: string, updater: TestWorldbookUpdater) =>
                persistWorldbook(name, await applyWorldbookUpdater(updater))
        );
        (SillyTavern.callGenericPopup as jest.Mock).mockResolvedValue(
            SillyTavern.POPUP_RESULT.AFFIRMATIVE
        );
        (SillyTavern.callGenericPopup as jest.Mock).mockClear();
    });

    afterEach(async () => {
        await stop?.();
        stop = undefined;
        jest.restoreAllMocks();
        jest.clearAllTimers();
    });

    test('loads the first closed matching entry in display order and warns about duplicates', async () => {
        worldbook.entries = {
            1: makeRawEntry(1, JSON.stringify({ 更新方式: '随AI输出' }), {
                displayIndex: 20,
            }),
            2: makeRawEntry(2, JSON.stringify({ 更新方式: '额外模型解析' }), {
                comment: '  [CONFIG_OVERRIDE] ',
                displayIndex: 10,
            }),
        };

        stop = await initCharacterSettingsOverride();
        useDataStore().should_enable = true;
        const store = useDataStore();

        expect(store.character_settings.entry_uid).toBe(2);
        expect(store.character_settings.draft.更新方式).toBe('额外模型解析');
        expect((globalThis as any).toastr.warning).toHaveBeenCalled();
    });

    test('does not let a stale initial load overwrite a worldbook update received during init', async () => {
        const stale = {
            entries: {
                1: makeRawEntry(1, JSON.stringify({ 更新方式: '随AI输出' })),
            },
            originalData: { entries: [] },
        };
        const external = {
            entries: {
                1: makeRawEntry(1, JSON.stringify({ 更新方式: '额外模型解析' })),
            },
            originalData: { entries: [] },
        };
        let release_initial_load!: () => void;
        let mark_initial_load_started!: () => void;
        const initial_load_started = new Promise<void>(resolve => {
            mark_initial_load_started = resolve;
        });
        const initial_load_gate = new Promise<void>(resolve => {
            release_initial_load = resolve;
        });
        (SillyTavern.loadWorldInfo as jest.Mock).mockImplementationOnce(async () => {
            mark_initial_load_started();
            await initial_load_gate;
            return klona(stale);
        });

        const init_promise = initCharacterSettingsOverride();
        await initial_load_started;
        await eventEmit(tavern_events.WORLDINFO_UPDATED, 'Character Book', klona(external));
        release_initial_load();
        stop = await init_promise;

        expect(useDataStore().character_settings.draft.更新方式).toBe('额外模型解析');
    });

    test('recovers repairable passthrough content and keeps the source snapshot for editing', async () => {
        worldbook.entries = {
            7: makeRawEntry(7, '{invalid'),
        };

        stop = await initCharacterSettingsOverride();
        const store = useDataStore();

        expect(store.character_settings.is_valid).toBe(false);
        expect(store.character_settings.draft).toEqual({ invalid: null });
        expect(store.character_settings.entry_uid).toBe(7);
        expect(store.character_settings.expected_content).toBe('{invalid');

        setCharacterSettingsOverride('更新方式', '额外模型解析');
        expect(store.effective_settings.更新方式).toBe('额外模型解析');
        await flushCharacterSettingsOverrideSave();

        expect(store.character_settings.is_valid).toBe(true);
        expect(JSON.parse(worldbook.entries[7].content)).toMatchObject({
            invalid: null,
            更新方式: '额外模型解析',
        });
    });

    test('preserves recoverable passthrough fields when repairing an invalid known field', async () => {
        worldbook.entries = {
            7: makeRawEntry(
                7,
                JSON.stringify({
                    更新方式: 'invalid',
                    custom_top_level: { kept: true },
                    兼容性: {
                        更新到聊天变量: 'invalid',
                        custom_compatibility: 42,
                    },
                })
            ),
        };

        stop = await initCharacterSettingsOverride();
        expect(useDataStore().character_settings.is_valid).toBe(false);

        setCharacterSettingsOverride('更新方式', '额外模型解析');
        await flushCharacterSettingsOverrideSave();

        expect(JSON.parse(worldbook.entries[7].content)).toMatchObject({
            更新方式: '额外模型解析',
            custom_top_level: { kept: true },
            兼容性: { custom_compatibility: 42 },
        });
    });

    test('creates a closed schema-bearing entry on first edit and updates runtime immediately', async () => {
        stop = await initCharacterSettingsOverride();
        const store = useDataStore();

        setCharacterSettingsOverride('兼容性.更新到聊天变量', true);
        expect(store.effective_settings.兼容性.更新到聊天变量).toBe(true);
        expect(
            store.character_settings.has_pending_save || store.character_settings.is_saving
        ).toBe(true);

        await flushCharacterSettingsOverrideSave();

        const [entry] = Object.values(worldbook.entries);
        const document = JSON.parse(entry.content);
        expect(entry.comment).toBe(CHARACTER_SETTINGS_OVERRIDE_ENTRY_NAME);
        expect(entry.disable).toBe(true);
        expect(document.兼容性.更新到聊天变量).toBe(true);
        expect(Object.keys(document).at(-1)).toBe('schema');
        expect(updateWorldbookWith).toHaveBeenCalledWith('Character Book', expect.any(Function), {
            render: 'immediate',
        });
        expect(SillyTavern.saveWorldInfo).not.toHaveBeenCalled();
        expect(SillyTavern.reloadWorldInfoEditor).not.toHaveBeenCalled();
    });

    test('assigns a new entry the largest used uid plus one instead of filling a gap', async () => {
        worldbook.entries = {
            2: makeRawEntry(2, 'unrelated', { comment: 'unrelated', disable: false }),
            7: makeRawEntry(7, 'unrelated', { comment: 'unrelated', disable: false }),
        };
        stop = await initCharacterSettingsOverride();

        setCharacterSettingsOverride('更新方式', '额外模型解析');
        await flushCharacterSettingsOverrideSave();

        expect(useDataStore().character_settings.entry_uid).toBe(8);
        expect(worldbook.entries[8]).toBeDefined();
        expect(worldbook.entries[0]).toBeUndefined();
    });

    test('preserves passthrough fields and keeps a schema-only entry after clearing the last override', async () => {
        worldbook.entries = {
            3: makeRawEntry(
                3,
                JSON.stringify({
                    更新方式: '额外模型解析',
                    custom: { kept: true },
                    schema: { old: true },
                })
            ),
        };
        stop = await initCharacterSettingsOverride();

        setCharacterSettingsOverride('更新方式', undefined);
        await flushCharacterSettingsOverrideSave();

        const document = JSON.parse(worldbook.entries[3].content);
        expect(document.custom).toEqual({ kept: true });
        expect(document).not.toHaveProperty('更新方式');
        expect(Object.keys(document).at(-1)).toBe('schema');
        expect(useDataStore().is_character_settings_override_active).toBe(false);
    });

    test('reloads the latest external config when a conflict is declined', async () => {
        worldbook.entries = {
            4: makeRawEntry(4, JSON.stringify({ 更新方式: '随AI输出' })),
        };
        stop = await initCharacterSettingsOverride();
        worldbook.entries[4].content = JSON.stringify({
            兼容性: { 更新到聊天变量: true },
        });
        (SillyTavern.callGenericPopup as jest.Mock).mockResolvedValue(
            SillyTavern.POPUP_RESULT.NEGATIVE
        );
        const save_count = (updateWorldbookWith as jest.Mock).mock.calls.length;

        setCharacterSettingsOverride('更新方式', '额外模型解析');
        await flushCharacterSettingsOverrideSave();

        const store = useDataStore();
        expect(SillyTavern.callGenericPopup).toHaveBeenCalled();
        expect(store.character_settings.draft).toEqual({
            兼容性: { 更新到聊天变量: true },
        });
        expect(updateWorldbookWith).toHaveBeenCalledTimes(save_count);
    });

    test('overwrites the latest entry after a conflict is confirmed', async () => {
        worldbook.entries = {
            5: makeRawEntry(5, JSON.stringify({ 更新方式: '随AI输出' })),
        };
        stop = await initCharacterSettingsOverride();
        worldbook.entries[5].content = JSON.stringify({
            兼容性: { 更新到聊天变量: true },
        });

        setCharacterSettingsOverride('更新方式', '额外模型解析');
        await flushCharacterSettingsOverrideSave();

        expect(SillyTavern.callGenericPopup).toHaveBeenCalled();
        expect(JSON.parse(worldbook.entries[5].content).更新方式).toBe('额外模型解析');
    });

    test('reloads the worldbook after conflict confirmation so unrelated changes are preserved', async () => {
        worldbook.entries = {
            5: makeRawEntry(5, JSON.stringify({ 更新方式: '随AI输出' })),
            9: makeRawEntry(9, 'unrelated-before', {
                comment: 'unrelated',
                disable: false,
            }),
        };
        stop = await initCharacterSettingsOverride();
        worldbook.entries[5].content = JSON.stringify({
            兼容性: { 更新到聊天变量: true },
        });
        (SillyTavern.callGenericPopup as jest.Mock).mockImplementation(async () => {
            worldbook.entries[9].content = 'unrelated-during-popup';
            return SillyTavern.POPUP_RESULT.AFFIRMATIVE;
        });

        setCharacterSettingsOverride('更新方式', '额外模型解析');
        await flushCharacterSettingsOverrideSave();

        expect(worldbook.entries[9].content).toBe('unrelated-during-popup');
        expect(JSON.parse(worldbook.entries[5].content).更新方式).toBe('额外模型解析');
    });

    test('keeps a failed save pending and retries it on the next flush', async () => {
        stop = await initCharacterSettingsOverride();
        (updateWorldbookWith as jest.Mock).mockRejectedValueOnce(
            new Error('temporary save failure')
        );

        setCharacterSettingsOverride('更新方式', '额外模型解析');
        await flushCharacterSettingsOverrideSave();

        const store = useDataStore();
        expect(store.character_settings.has_pending_save).toBe(true);
        expect(store.effective_settings.更新方式).toBe('额外模型解析');
        expect(Object.keys(worldbook.entries)).toHaveLength(0);

        await flushCharacterSettingsOverrideSave();

        expect(store.character_settings.has_pending_save).toBe(false);
        expect(JSON.parse(Object.values(worldbook.entries)[0].content).更新方式).toBe(
            '额外模型解析'
        );
    });

    test('normalizes string ids before updating through the worldbook interface', async () => {
        const entry = makeRawEntry(8, JSON.stringify({ 更新方式: '随AI输出' }));
        (entry as any).uid = '8';
        worldbook.entries = { 8: entry };
        stop = await initCharacterSettingsOverride();

        setCharacterSettingsOverride('更新方式', '额外模型解析');
        await flushCharacterSettingsOverrideSave();

        expect(useDataStore().character_settings.entry_uid).toBe(8);
        expect(JSON.parse(worldbook.entries[8].content).更新方式).toBe('额外模型解析');
    });

    test('serializes saves without letting an older result replace a newer draft', async () => {
        stop = await initCharacterSettingsOverride();
        let release_first_save!: () => void;
        let mark_first_save_started!: () => void;
        const first_save_started = new Promise<void>(resolve => {
            mark_first_save_started = resolve;
        });
        const first_save_gate = new Promise<void>(resolve => {
            release_first_save = resolve;
        });
        (updateWorldbookWith as jest.Mock)
            .mockImplementationOnce(async (name: string, updater: TestWorldbookUpdater) => {
                const entries = await applyWorldbookUpdater(updater);
                mark_first_save_started();
                await first_save_gate;
                return persistWorldbook(name, entries);
            })
            .mockImplementation(async (name: string, updater: TestWorldbookUpdater) =>
                persistWorldbook(name, await applyWorldbookUpdater(updater))
            );

        setCharacterSettingsOverride('更新方式', '额外模型解析');
        await first_save_started;
        setCharacterSettingsOverride('额外模型解析配置.启用自动请求', false);
        release_first_save();
        await flushCharacterSettingsOverrideSave();

        const [entry] = Object.values(worldbook.entries);
        const document = JSON.parse(entry.content);
        expect(document.更新方式).toBe('额外模型解析');
        expect(document.额外模型解析配置.启用自动请求).toBe(false);
        expect(useDataStore().character_settings.draft).toMatchObject({
            更新方式: '额外模型解析',
            额外模型解析配置: { 启用自动请求: false },
        });
        expect(updateWorldbookWith).toHaveBeenCalledTimes(2);
    });

    test('flush waits for a newer save loop spawned after an older revision fails', async () => {
        stop = await initCharacterSettingsOverride();
        let reject_first_save!: () => void;
        let mark_first_save_started!: () => void;
        let release_second_save!: () => void;
        let mark_second_save_started!: () => void;
        const first_save_started = new Promise<void>(resolve => {
            mark_first_save_started = resolve;
        });
        const first_save_gate = new Promise<void>((_resolve, reject) => {
            reject_first_save = () => reject(new Error('first revision failed'));
        });
        const second_save_started = new Promise<void>(resolve => {
            mark_second_save_started = resolve;
        });
        const second_save_gate = new Promise<void>(resolve => {
            release_second_save = resolve;
        });
        (updateWorldbookWith as jest.Mock)
            .mockImplementationOnce(async (_name: string, updater: TestWorldbookUpdater) => {
                await applyWorldbookUpdater(updater);
                mark_first_save_started();
                await first_save_gate;
            })
            .mockImplementationOnce(async (name: string, updater: TestWorldbookUpdater) => {
                const entries = await applyWorldbookUpdater(updater);
                mark_second_save_started();
                await second_save_gate;
                return persistWorldbook(name, entries);
            });

        setCharacterSettingsOverride('更新方式', '额外模型解析');
        await first_save_started;
        setCharacterSettingsOverride('额外模型解析配置.启用自动请求', false);
        reject_first_save();

        let flush_completed = false;
        const flush_promise = flushCharacterSettingsOverrideSave().then(() => {
            flush_completed = true;
        });
        await second_save_started;
        await Promise.resolve();
        expect(flush_completed).toBe(false);

        release_second_save();
        await flush_promise;

        expect(JSON.parse(Object.values(worldbook.entries)[0].content)).toMatchObject({
            更新方式: '额外模型解析',
            额外模型解析配置: { 启用自动请求: false },
        });
    });

    test('waits for a pending save before a controller is stopped', async () => {
        stop = await initCharacterSettingsOverride();
        let release_save!: () => void;
        let mark_save_started!: () => void;
        const save_started = new Promise<void>(resolve => {
            mark_save_started = resolve;
        });
        const save_gate = new Promise<void>(resolve => {
            release_save = resolve;
        });
        (updateWorldbookWith as jest.Mock).mockImplementationOnce(
            async (name: string, updater: TestWorldbookUpdater) => {
                const entries = await applyWorldbookUpdater(updater);
                mark_save_started();
                await save_gate;
                return persistWorldbook(name, entries);
            }
        );

        setCharacterSettingsOverride('更新方式', '额外模型解析');
        await save_started;
        let stop_completed = false;
        const stop_promise = Promise.resolve(stop()).then(() => {
            stop_completed = true;
        });
        stop = undefined;
        await Promise.resolve();
        expect(stop_completed).toBe(false);

        release_save();
        await stop_promise;
        expect(stop_completed).toBe(true);
        expect(JSON.parse(Object.values(worldbook.entries)[0].content).更新方式).toBe(
            '额外模型解析'
        );
    });

    test('retries a failed pending save while stopping the controller', async () => {
        stop = await initCharacterSettingsOverride();
        (updateWorldbookWith as jest.Mock)
            .mockRejectedValueOnce(new Error('initial save failure'))
            .mockRejectedValueOnce(new Error('first stop retry failure'));

        setCharacterSettingsOverride('更新方式', '额外模型解析');
        await flushCharacterSettingsOverrideSave();
        expect(useDataStore().character_settings.has_pending_save).toBe(true);

        await stop();
        stop = undefined;

        expect(updateWorldbookWith).toHaveBeenCalledTimes(3);
        expect(JSON.parse(Object.values(worldbook.entries)[0].content).更新方式).toBe(
            '额外模型解析'
        );
    });

    test('reloads WORLDINFO_UPDATED only when there is no pending save', async () => {
        worldbook.entries = {
            6: makeRawEntry(6, JSON.stringify({ 更新方式: '随AI输出' })),
        };
        stop = await initCharacterSettingsOverride();
        const external = klona(worldbook);
        external.entries[6].content = JSON.stringify({ 更新方式: '额外模型解析' });

        await eventEmit(tavern_events.WORLDINFO_UPDATED, 'Character Book', external);
        expect(useDataStore().character_settings.draft.更新方式).toBe('额外模型解析');

        setCharacterSettingsOverride('额外模型解析配置.世界书条目白名单正则', 'character-rule');
        const second_external = klona(external);
        second_external.entries[6].content = JSON.stringify({ 更新方式: '随AI输出' });
        worldbook = klona(second_external);
        await eventEmit(tavern_events.WORLDINFO_UPDATED, 'Character Book', second_external);

        expect(useDataStore().character_settings.draft.额外模型解析配置?.世界书条目白名单正则).toBe(
            'character-rule'
        );
        (SillyTavern.callGenericPopup as jest.Mock).mockResolvedValue(
            SillyTavern.POPUP_RESULT.NEGATIVE
        );
        await flushCharacterSettingsOverrideSave();
    });

    test('does not apply a fallback event reload if an edit becomes pending while loading', async () => {
        worldbook.entries = {
            6: makeRawEntry(6, JSON.stringify({ 更新方式: '随AI输出' })),
        };
        stop = await initCharacterSettingsOverride();
        let release_reload!: () => void;
        let mark_reload_started!: () => void;
        const reload_started = new Promise<void>(resolve => {
            mark_reload_started = resolve;
        });
        const reload_gate = new Promise<void>(resolve => {
            release_reload = resolve;
        });
        (SillyTavern.loadWorldInfo as jest.Mock).mockImplementationOnce(async () => {
            mark_reload_started();
            await reload_gate;
            return klona(worldbook);
        });

        const event_promise = eventEmit(
            tavern_events.WORLDINFO_UPDATED,
            'Character Book',
            undefined as any
        );
        await reload_started;
        setCharacterSettingsOverride('额外模型解析配置.世界书条目白名单正则', 'pending-rule');
        release_reload();
        await event_promise;

        expect(useDataStore().character_settings.draft.额外模型解析配置?.世界书条目白名单正则).toBe(
            'pending-rule'
        );
        await flushCharacterSettingsOverrideSave();
    });

    test('disables character editing state when no primary worldbook is bound', async () => {
        (globalThis as any).getCharWorldbookNames.mockReturnValue({
            primary: null,
            additional: [],
        });

        stop = await initCharacterSettingsOverride();
        const save_count = (updateWorldbookWith as jest.Mock).mock.calls.length;

        expect(useDataStore().character_settings.status).toBe('unbound');
        setCharacterSettingsOverride('更新方式', '额外模型解析');
        await flushCharacterSettingsOverrideSave();
        expect(updateWorldbookWith).toHaveBeenCalledTimes(save_count);
    });
});
