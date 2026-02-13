import { filterEntries } from '@/function/request/filter_entries';
import { useDataStore } from '@/store';

const makeEntry = (world: string, comment: string) => ({ world, comment });
const cloneEntries = (entries: Array<{ world: string; comment: string }>) =>
    entries.map(entry => ({ ...entry }));

let mockGetCurrentCharPrimaryLorebook: jest.MockedFunction<() => string | undefined>;
let mockGetLorebookEntries: jest.MockedFunction<(name: string) => Promise<any[]>>;

describe('filterEntries', () => {
    beforeEach(() => {
        const store = useDataStore();
        store.settings.更新方式 = '额外模型解析';
        store.settings.额外模型解析配置.使用函数调用 = false;

        store.runtimes.unsupported_warnings = '';
        store.runtimes.is_during_extra_analysis = false;

        (globalThis as any).toastr = {
            warning: jest.fn(),
            info: jest.fn(),
            error: jest.fn(),
        };

        (globalThis as any).SillyTavern.ToolManager.isToolCallingSupported.mockReturnValue(true);
        (globalThis as any).SillyTavern.chatCompletionSettings.function_calling = true;

        mockGetCurrentCharPrimaryLorebook = (globalThis as any)
            .getCurrentCharPrimaryLorebook as jest.MockedFunction<() => string | undefined>;
        if (!mockGetCurrentCharPrimaryLorebook) {
            mockGetCurrentCharPrimaryLorebook = jest.fn();
            (globalThis as any).getCurrentCharPrimaryLorebook = mockGetCurrentCharPrimaryLorebook;
        }
        mockGetCurrentCharPrimaryLorebook.mockReturnValue('current');

        mockGetLorebookEntries = jest.fn();
        (globalThis as any).getLorebookEntries = mockGetLorebookEntries;
    });

    afterEach(() => {
        useDataStore().runtimes.is_during_extra_analysis = false;
    });

    // 场景: 更新方式为随AI输出时，不进行任何过滤处理
    test('returns early when update mode is 随AI输出', async () => {
        const store = useDataStore();
        store.settings.更新方式 = '随AI输出';

        const lores = {
            globalLore: [makeEntry('WorldA', '[mvu_update]')],
            characterLore: [makeEntry('WorldA', '[mvu_plot]')],
            chatLore: [],
            personaLore: [],
        };

        mockGetLorebookEntries.mockResolvedValue(cloneEntries(lores.characterLore));

        await filterEntries(lores);

        expect(lores.globalLore).toHaveLength(1);
        expect(lores.characterLore).toHaveLength(1);
        expect(store.runtimes.unsupported_warnings).toBe('');
    });

    // 场景: 需要函数调用但不支持时，直接提示并退出
    test('returns early when function calling is required but unsupported', async () => {
        const store = useDataStore();
        store.settings.额外模型解析配置.使用函数调用 = true;

        (globalThis as any).SillyTavern.ToolManager.isToolCallingSupported.mockReturnValue(false);

        const lores = {
            globalLore: [makeEntry('WorldA', '[mvu_update]')],
            characterLore: [makeEntry('WorldA', '[mvu_plot]')],
            chatLore: [],
            personaLore: [],
        };

        mockGetLorebookEntries.mockResolvedValue(cloneEntries(lores.characterLore));

        await filterEntries(lores);

        expect(lores.globalLore).toHaveLength(1);
        expect(lores.characterLore).toHaveLength(1);
        expect(store.runtimes.unsupported_warnings).toBe('');
        expect((globalThis as any).toastr.warning).toHaveBeenCalled();
    });

    // 场景: 角色世界书未标记时，额外模型不启用且不处理其他世界书
    test('returns early when character lore has no tags', async () => {
        const store = useDataStore();

        const lores = {
            globalLore: [
                makeEntry('WorldA', '[mvu_update]'),
                makeEntry('WorldB', '[mvu_plot]'),
                makeEntry('WorldC', 'untagged'),
            ],
            characterLore: [makeEntry('WorldChar', 'untagged')],
            chatLore: [],
            personaLore: [],
        };

        mockGetLorebookEntries.mockResolvedValue(cloneEntries(lores.characterLore));

        await filterEntries(lores);

        expect(lores.globalLore).toHaveLength(3);
        expect(lores.characterLore).toHaveLength(1);
        expect(store.runtimes.unsupported_warnings).toBe('');
    });

    // 场景: 主阶段过滤 update-only 条目，并不会移除未支持的世界书
    test('filters update-only entries and removes unsupported worlds in main phase', async () => {
        const store = useDataStore();

        store.runtimes.is_during_extra_analysis = false;
        const lores = {
            globalLore: [
                makeEntry('WorldA', 'untagged'),
                makeEntry('WorldB', 'untagged'),
                makeEntry('WorldC', '[mvu_update]'),
                makeEntry('WorldD', '[mvu_plot]'),
            ],
            characterLore: [makeEntry('WorldA', '[mvu_update]'), makeEntry('WorldA', 'untagged')],
            chatLore: [makeEntry('WorldB', 'untagged')],
            personaLore: [],
        };

        mockGetLorebookEntries.mockResolvedValue(cloneEntries(lores.characterLore));

        await filterEntries(lores);

        expect(lores.characterLore).toEqual([makeEntry('WorldA', 'untagged')]);
        expect(lores.globalLore).toEqual([
            makeEntry('WorldA', 'untagged'),
            makeEntry('WorldB', 'untagged'),
            makeEntry('WorldD', '[mvu_plot]'),
        ]);
        expect(lores.chatLore).toHaveLength(1);
        //即便在主阶段，也会明确检测不支持的世界书，只是不进行删除
        expect(store.runtimes.unsupported_warnings).toBe('WorldB');
    });

    // 场景: 非额外解析阶段保留 [mvu_plot]，过滤掉 [mvu_update]
    test('keeps plot entries and removes update-only entries in main phase', async () => {
        const store = useDataStore();

        store.runtimes.is_during_extra_analysis = false;

        const lores = {
            globalLore: [
                makeEntry('WorldD', '[mvu_plot]'),
                makeEntry('WorldA', '[mvu_update]'),
                makeEntry('WorldA', 'untagged'),
                makeEntry('WorldC', '[mvu_plot][mvu_update]'),
            ],
            characterLore: [makeEntry('WorldA', '[mvu_plot]')],
            chatLore: [],
            personaLore: [],
        };

        mockGetLorebookEntries.mockResolvedValue(cloneEntries(lores.characterLore));

        await filterEntries(lores);

        expect(lores.globalLore).toEqual([
            makeEntry('WorldD', '[mvu_plot]'),
            makeEntry('WorldA', 'untagged'),
            makeEntry('WorldC', '[mvu_plot][mvu_update]'),
        ]);
        expect(store.runtimes.unsupported_warnings).toBe('');
    });

    // 场景: 额外解析阶段，plot-only 世界书的未标记条目应保留
    test('keeps untagged entries from plot-only worlds during extra analysis', async () => {
        const store = useDataStore();

        store.runtimes.is_during_extra_analysis = true;

        const lores = {
            globalLore: [
                makeEntry('PlotWorld', '[mvu_plot]'),
                makeEntry('PlotWorld', 'untagged'),
                makeEntry('UntaggedWorld', 'untagged'),
                makeEntry('PlotWorld2', '[mvu_update]'),
                makeEntry('PlotWorld2', 'untagged'),
            ],
            characterLore: [makeEntry('WorldA', '[mvu_update]')],
            chatLore: [],
            personaLore: [],
        };

        mockGetLorebookEntries.mockResolvedValue(cloneEntries(lores.characterLore));

        await filterEntries(lores);

        expect(lores.globalLore).toEqual([
            makeEntry('PlotWorld', 'untagged'),
            makeEntry('PlotWorld2', '[mvu_update]'),
            makeEntry('PlotWorld2', 'untagged'),
        ]);
        expect(store.runtimes.unsupported_warnings).toBe('UntaggedWorld');
    });
});
