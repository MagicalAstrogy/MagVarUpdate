import { registerButtons } from '@/button';
import { EXTENSIBLE_MARKER } from '@/schema';
import { getLastValidVariable } from '@/function';
import { createEmptyGameData, loadInitVarData } from '@/variable_init';
import _ from 'lodash';

// Mock only external dependencies
jest.mock('@/function', () => ({
    ...jest.requireActual('@/function'),
    getLastValidVariable: jest.fn(),
}));

jest.mock('@/variable_init', () => ({
    ...jest.requireActual('@/variable_init'),
    createEmptyGameData: jest.fn(),
    loadInitVarData: jest.fn(),
}));

// Spy on these functions to check calls but keep their implementation
const reconcileAndApplySchemaSpy = jest.spyOn(require('@/schema'), 'reconcileAndApplySchema');
const cleanUpMetadataSpy = jest.spyOn(require('@/schema'), 'cleanUpMetadata');
const updateDescriptionsSpy = jest.spyOn(require('@/update_descriptions'), 'updateDescriptions');

global._ = _;
global.getLastMessageId = jest.fn();
global.replaceVariables = jest.fn();
global.toastr = {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
    clear: jest.fn(),
    remove: jest.fn(),
    info: jest.fn(),
    options: {},
    subscribe: jest.fn(),
    getContainer: jest.fn(),
    version: '2.1.4',
};
global.getScriptButtons = jest.fn();
global.getScriptId = jest.fn();
global.replaceScriptButtons = jest.fn();
global.eventOnButton = jest.fn();
global.deleteVariable = jest.fn();
//@ts-ignore
global.SillyTavern = {
    chat: [],
    callGenericPopup: jest.fn(),
    POPUP_TYPE: { INPUT: 'input' },
    saveChat: jest.fn(),
};

// Helper to get the reloadInit callback
function getReloadInitCallback() {
    const calls = (global.eventOnButton as jest.Mock).mock.calls;
    const reloadInitCall = calls.find(call => call[0] === '重新读取初始变量');
    return reloadInitCall ? reloadInitCall[1] : null;
}

describe('reloadInit function', () => {
    let reloadInit: () => Promise<void>;

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup default mocks
        (getScriptId as jest.Mock).mockReturnValue('test-script');
        (getScriptButtons as jest.Mock).mockReturnValue([]);
        (createEmptyGameData as jest.Mock).mockReturnValue({
            stat_data: {},
            schema: {},
        });
        (loadInitVarData as jest.Mock).mockResolvedValue(true);
        (getLastMessageId as jest.Mock).mockReturnValue(1);
        (getLastValidVariable as jest.Mock).mockResolvedValue({
            stat_data: {},
            schema: {},
        });
        (replaceVariables as jest.Mock).mockResolvedValue(undefined);

        // Register buttons to get the callback
        registerButtons();
        reloadInit = getReloadInitCallback();
    });

    describe('Basic error handling', () => {
        test('should handle missing InitVar data', async () => {
            (loadInitVarData as jest.Mock).mockResolvedValue(false);

            await reloadInit();

            expect(toastr.error).toHaveBeenCalledWith('没有找到 InitVar 数据', '', {
                timeOut: 3000,
            });
            expect(reconcileAndApplySchemaSpy).not.toHaveBeenCalled();
        });

        test('should handle InitVar data loading error', async () => {
            (loadInitVarData as jest.Mock).mockRejectedValue(new Error('Load failed'));
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

            await reloadInit();

            expect(consoleSpy).toHaveBeenCalledWith('加载 InitVar 数据失败:', expect.any(Error));
            expect(reconcileAndApplySchemaSpy).not.toHaveBeenCalled();

            consoleSpy.mockRestore();
        });

        test('should handle no message found', async () => {
            (getLastMessageId as jest.Mock).mockReturnValue(-1);

            await reloadInit();

            expect(toastr.error).toHaveBeenCalledWith('没有找到消息', '', { timeOut: 3000 });
            expect(getLastValidVariable).not.toHaveBeenCalled();
        });

        test('should handle missing stat_data in latest message', async () => {
            (getLastValidVariable as jest.Mock).mockResolvedValue({});

            await reloadInit();

            expect(toastr.error).toHaveBeenCalledWith('最新消息中没有 stat_data', '', {
                timeOut: 3000,
            });
            expect(updateDescriptionsSpy).not.toHaveBeenCalled();
        });
    });

    describe('Schema processing order (666542e1 fix)', () => {
        test('should process schema for init_data before merging', async () => {
            const init_data = {
                stat_data: {
                    init: 'value',
                    $meta: {
                        extensible: true,
                    },
                },
                schema: {},
            };
            const msg_data = {
                stat_data: { msg: 'value' },
                schema: {
                    type: 'object',
                    properties: {
                        init: { type: 'string' },
                        msg: { type: 'string' },
                    },
                },
            };

            (createEmptyGameData as jest.Mock).mockReturnValue(init_data);
            (getLastValidVariable as jest.Mock).mockResolvedValue(msg_data);

            await reloadInit();

            // Verify reconcileAndApplySchema is called for init_data first
            expect(reconcileAndApplySchemaSpy).toHaveBeenCalledTimes(2);
            expect(reconcileAndApplySchemaSpy).toHaveBeenNthCalledWith(1, init_data);

            // Verify cleanUpMetadata is called after first schema processing
            expect(cleanUpMetadataSpy).toHaveBeenNthCalledWith(1, init_data.stat_data);

            const finalResult = (replaceVariables as jest.Mock).mock.calls[1][0] as any;
            expect(finalResult.schema.extensible).toBe(true);
            expect(finalResult.stat_data.init).toBe('value');
            expect(finalResult.stat_data.msg).toBe('value');
        });

        test('should merge schemas correctly with proper order', async () => {
            const init_data = {
                stat_data: {
                    base: 'init',
                    shared: 'init_value',
                    $meta: {
                        extensible: true,
                        template: { defaultProp: 'defaultValueNew' },
                    },
                },
                schema: {},
            };
            const msg_data = {
                stat_data: { derived: 'msg', shared: 'msg_value' },
                schema: {
                    type: 'object',
                    properties: {
                        base: { type: 'string' },
                        shared: { type: 'string' },
                        derived: { type: 'string' },
                    },
                    extensible: false,
                    template: { defaultProp: 'defaultValue' },
                },
            };

            (createEmptyGameData as jest.Mock).mockReturnValue(init_data);
            (getLastValidVariable as jest.Mock).mockResolvedValue(msg_data);

            await reloadInit();

            // Verify the merged data structure
            const finalResult = (replaceVariables as jest.Mock).mock.calls[1][0] as any;

            // Schema should merge msg_data.schema into init_data.schema
            expect(finalResult.schema).toMatchObject({
                type: 'object',
                properties: {
                    base: { type: 'string' },
                    shared: { type: 'string' },
                    derived: { type: 'string' },
                },
                extensible: true,
                template: { defaultProp: 'defaultValueNew' },
            });

            // Stat_data should merge with init_data as base
            expect(finalResult.stat_data).toMatchObject({
                base: 'init',
                shared: 'msg_value',
                derived: 'msg',
            });
        });
    });

    describe('EXTENSIBLE_MARKER scenarios', () => {
        test('should handle arrays with EXTENSIBLE_MARKER correctly', async () => {
            const init_data = {
                stat_data: {
                    items: ['item1', 'item2'],
                    nested: {
                        array: [EXTENSIBLE_MARKER, 'e', 'b'], //此处修改的e不起效果，因为
                    },
                },
            };

            const msg_data = {
                stat_data: {
                    items: ['item1', 'item2', 'item3'],
                    nested: {
                        array: ['a', 'b', 'c'],
                    },
                },
                schema: {
                    type: 'object',
                    properties: {
                        items: { type: 'array', extensible: true },
                        nested: {
                            type: 'object',
                            properties: {
                                array: { type: 'array', extensible: false },
                            },
                        },
                    },
                },
            };

            (createEmptyGameData as jest.Mock).mockReturnValue(init_data);
            (getLastValidVariable as jest.Mock).mockResolvedValue(msg_data);

            await reloadInit();

            // Verify merge preserves EXTENSIBLE_MARKER
            const finalResult = (replaceVariables as jest.Mock).mock.calls[1][0] as any;

            expect(finalResult.schema.properties.nested.properties.array.extensible).toBe(true);
            expect(finalResult.stat_data.nested.array).toEqual(['a', 'b', 'c']);
        });
    });

    describe('Complete workflow', () => {
        test('should execute complete reload workflow successfully', async () => {
            const init_data = {
                stat_data: { init: 'data' },
                schema: {},
            };
            const msg_data = {
                stat_data: { msg: 'data' },
                schema: {
                    type: 'object',
                    properties: {
                        init: { type: 'string' },
                        msg: { type: 'string' },
                    },
                },
            };

            (createEmptyGameData as jest.Mock).mockReturnValue(init_data);
            (getLastValidVariable as jest.Mock).mockResolvedValue(msg_data);
            (getLastMessageId as jest.Mock).mockReturnValue(5);

            await reloadInit();

            // Verify execution order
            expect(createEmptyGameData).toHaveBeenCalled();
            expect(loadInitVarData).toHaveBeenCalledWith(init_data);

            // First schema processing (new in 666542e1)
            expect(reconcileAndApplySchemaSpy).toHaveBeenNthCalledWith(1, init_data);
            expect(cleanUpMetadataSpy).toHaveBeenNthCalledWith(1, init_data.stat_data);

            expect(getLastMessageId).toHaveBeenCalled();
            expect(getLastValidVariable).toHaveBeenCalledWith(5);

            // Description updates
            expect(updateDescriptionsSpy).toHaveBeenCalledWith(
                '',
                init_data.stat_data,
                msg_data.stat_data,
                expect.any(Object)
            );

            // Second schema processing with merged data
            expect(reconcileAndApplySchemaSpy).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    stat_data: expect.any(Object),
                    schema: expect.any(Object),
                })
            );
            expect(cleanUpMetadataSpy).toHaveBeenNthCalledWith(2, expect.any(Object));

            // Variable replacements
            expect(replaceVariables).toHaveBeenCalledTimes(2);
            expect(replaceVariables).toHaveBeenNthCalledWith(1, expect.any(Object), {
                type: 'message',
                message_id: 5,
            });
            expect(replaceVariables).toHaveBeenNthCalledWith(2, expect.any(Object), {
                type: 'chat',
            });

            expect(toastr.success).toHaveBeenCalledWith('InitVar描述已更新', '', { timeOut: 3000 });
        });

        test('should create new object instead of using structuredClone', async () => {
            const init_data = {
                stat_data: { test: 'init' },
                schema: {},
            };
            const msg_data = {
                stat_data: { test: 'msg' },
                schema: {
                    type: 'object',
                    properties: {
                        test: { type: 'string' },
                    },
                },
            };

            (createEmptyGameData as jest.Mock).mockReturnValue(init_data);
            (getLastValidVariable as jest.Mock).mockResolvedValue(msg_data);

            await reloadInit();

            // Verify the merged data is a new object with correct structure
            const mergedData = reconcileAndApplySchemaSpy.mock.calls[1][0] as any;

            // Should have both stat_data and schema properties
            expect(mergedData).toHaveProperty('stat_data');
            expect(mergedData).toHaveProperty('schema');

            // Should not be the same reference as init_data or msg_data
            expect(mergedData).not.toBe(init_data);
            expect(mergedData).not.toBe(msg_data);
            expect(mergedData.stat_data).not.toBe(init_data.stat_data);
            expect(mergedData.stat_data).not.toBe(msg_data.stat_data);
        });

        test('should handle complex merge with overrides correctly', async () => {
            const init_data = {
                stat_data: {
                    player: {
                        health: 100,
                        inventory: ['sword'],
                        stats: { str: 10, dex: 8 },
                    },
                    game: {
                        level: 1,
                        difficulty: 'normal',
                    },
                },
                schema: {
                    type: 'object',
                    properties: {
                        player: {
                            type: 'object',
                            properties: {
                                health: { type: 'number' },
                                inventory: { type: 'array' },
                                stats: {
                                    type: 'object',
                                    properties: {
                                        str: { type: 'number' },
                                        dex: { type: 'number' },
                                        int: { type: 'number' },
                                    },
                                },
                            },
                        },
                        game: {
                            type: 'object',
                            properties: {
                                level: { type: 'number' },
                                difficulty: { type: 'string' },
                            },
                        },
                    },
                },
            };

            const msg_data = {
                stat_data: {
                    player: {
                        health: 75,
                        inventory: ['sword', 'potion'],
                        stats: { str: 12, int: 5 },
                    },
                    npcs: ['npc1'],
                },
                schema: {
                    type: 'object',
                    properties: {
                        player: { type: 'object' },
                        npcs: { type: 'array' },
                    },
                },
            };

            (createEmptyGameData as jest.Mock).mockReturnValue(init_data);
            (getLastValidVariable as jest.Mock).mockResolvedValue(msg_data);

            await reloadInit();

            const mergedData = reconcileAndApplySchemaSpy.mock.calls[1][0] as any;

            // Verify deep merge behavior
            expect(mergedData.stat_data.player.health).toBe(75); // msg_data overwrites
            expect(mergedData.stat_data.player.inventory).toEqual(['sword', 'potion']); // msg_data overwrites
            expect(mergedData.stat_data.player.stats).toEqual({
                str: 12, // overwritten
                dex: 8, // preserved from init
                int: 5, // new from msg
            });
            expect(mergedData.stat_data.game).toEqual(init_data.stat_data.game); // preserved from init
            expect(mergedData.stat_data.npcs).toEqual(['npc1']); // new from msg

            // Verify schema merge
            expect(mergedData.schema.properties).toHaveProperty('player');
            expect(mergedData.schema.properties).toHaveProperty('game');
            expect(mergedData.schema.properties).toHaveProperty('npcs');
        });
    });
});
