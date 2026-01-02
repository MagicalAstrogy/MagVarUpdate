import YAML from 'yaml';
import { MvuData } from '@/variable_def';
import { getEnabledLorebookList, loadInitVarData } from '@/variable_init';

jest.mock('@/variable_init', () => {
    const actual = jest.requireActual('@/variable_init');
    const mockGetEnabledLorebookList = jest.fn();
    return {
        ...actual,
        getEnabledLorebookList: mockGetEnabledLorebookList,
        loadInitVarData: async (mvu_data: any, lorebook_list?: string[]) => {
            const list = lorebook_list ?? (await mockGetEnabledLorebookList());
            return actual.loadInitVarData(mvu_data, list);
        },
    };
});

describe('loadInitVarData', () => {
    const mockGetEnabledLorebookList = getEnabledLorebookList as jest.MockedFunction<
        typeof getEnabledLorebookList
    >;
    let mockGetLorebookEntries: jest.MockedFunction<(name: string) => Promise<any[]>>;
    let mockSubstitudeMacros: jest.MockedFunction<(input: string) => string>;

    beforeAll(() => {
        (globalThis as any).YAML = YAML;
    });

    beforeEach(() => {
        jest.clearAllMocks();

        mockGetLorebookEntries = jest.fn();
        (globalThis as any).getLorebookEntries = mockGetLorebookEntries;

        mockSubstitudeMacros = jest.fn(input => input);
        (globalThis as any).substitudeMacros = mockSubstitudeMacros;
    });

    test('merges initvar entries across multiple lorebooks without overriding existing stat_data', async () => {
        const mvuData: MvuData = {
            stat_data: {
                悠纪: { 喵: '1' },
                existing: 'keep',
            },
            initialized_lorebooks: {},
        };

        mockGetEnabledLorebookList.mockResolvedValue(['version1.2', 'bonus']);

        const blockBody = '{"block":"yes"}';
        mockGetLorebookEntries.mockImplementation(async lorebookName => {
            if (lorebookName === 'version1.2') {
                return [
                    {
                        comment: 'alpha [initvar]',
                        content: '{"悠纪":{"喵":"1","喵呜":"2"},"new_key":"new"}',
                    },
                    { comment: 'skip', content: '{"ignored":true}' },
                    {
                        comment: '[initvar] block',
                        content: `\`\`\`json\n${blockBody}\n\`\`\``,
                    },
                ];
            }
            if (lorebookName === 'bonus') {
                return [
                    { comment: '[INITVAR]', content: '{"bonus":123}' },
                    { comment: 'notes', content: '{"ignored_bonus":true}' },
                    { comment: '[initvar]', content: '{"new_key":"override"}' },
                ];
            }
            return [];
        });

        const updated = await loadInitVarData(mvuData);

        expect(updated).toBe(true);
        expect(mockGetEnabledLorebookList).toHaveBeenCalledTimes(1);
        expect(mockGetLorebookEntries).toHaveBeenCalledWith('version1.2');
        expect(mockGetLorebookEntries).toHaveBeenCalledWith('bonus');
        expect(mockSubstitudeMacros).toHaveBeenCalledTimes(4);
        expect(mockSubstitudeMacros).toHaveBeenCalledWith(blockBody);
        expect(mvuData.stat_data).toEqual({
            悠纪: { 喵: '1' },
            existing: 'keep',
            new_key: 'new',
            block: 'yes',
            bonus: 123,
        });
        expect(mvuData.initialized_lorebooks).toEqual({
            'version1.2': [],
            bonus: [],
        });
    });

    test('keeps existing nested stat_data when initvar contains the same top-level key', async () => {
        const mvuData: MvuData = {
            stat_data: {
                悠纪: { 喵: '1' },
            },
            initialized_lorebooks: {},
        };

        mockGetEnabledLorebookList.mockResolvedValue(['version1.2']);
        mockGetLorebookEntries.mockResolvedValue([
            {
                comment: '[initvar]',
                content: '{"悠纪":{"喵":"1","喵呜":"2"}}',
            },
        ]);

        const updated = await loadInitVarData(mvuData);

        expect(updated).toBe(true);
        expect(mvuData.stat_data).toEqual({
            悠纪: { 喵: '1' },
        });
        expect(mvuData.initialized_lorebooks).toEqual({
            'version1.2': [],
        });
    });

    test('merge elements in same lorebook', async () => {
        const mvuData: MvuData = {
            stat_data: {
                //empty
            },
            initialized_lorebooks: {},
        };

        mockGetEnabledLorebookList.mockResolvedValue(['version1.2', 'version1.3']);
        mockGetLorebookEntries.mockImplementation(async lorebookName => {
            if (lorebookName === 'version1.2') {
                return [
                    {
                        comment: '[initvar]',
                        content: '{"悠纪":{"喵":"1","喵呜":"2"}}',
                    },
                    {
                        comment: '[initvar]222',
                        content: '{"悠纪":{"捏":"3"}}',
                    },
                ];
            }
            if (lorebookName === 'version1.3') {
                return [
                    {
                        comment: '[initvar]',
                        content: '{"悠纪":{"杂鱼喵": "杂鱼杂鱼"}}',
                    },
                ];
            }
            return [];
        });

        const updated = await loadInitVarData(mvuData);

        expect(updated).toBe(true);
        expect(mvuData.stat_data).toEqual({
            悠纪: { 喵: '1', 喵呜: '2', 捏: '3' },
        });
        expect(mvuData.initialized_lorebooks).toEqual({
            'version1.2': [],
            'version1.3': [],
        });
    });

    test('new merge behaviour', async () => {
        const mvuData: MvuData = {
            stat_data: {
                //empty
            },
            initialized_lorebooks: {},
        };

        mockGetEnabledLorebookList.mockResolvedValue(['version1.2']);
        mockGetLorebookEntries.mockImplementation(async lorebookName => {
            if (lorebookName === 'version1.2') {
                return [
                    {
                        comment: '[initvar]',
                        content: '{"悠纪":["abc", "def"]}',
                    },
                    {
                        comment: '[initvar]222',
                        content: '{"悠纪":[]}',
                    },
                ];
            }
            return [];
        });

        const updated = await loadInitVarData(mvuData);

        expect(updated).toBe(true);
        expect(mvuData.stat_data).toEqual({
            悠纪: [],
        });
        expect(mvuData.initialized_lorebooks).toEqual({
            'version1.2': [],
        });
    });
});
