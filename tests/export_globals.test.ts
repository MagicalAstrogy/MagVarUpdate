/**
 * 测试场景：验证全局 Mvu 接口的导出、消息解析、变量读写和异常返回，使用模拟酒馆环境隔离宿主依赖。
 */
import { initGlobals as exportGlobals } from '@/function/global';
import { updateVariable, updateVariables } from '@/function/update_variables';
import { variable_events } from '@/variable_def';
import { loadInitVarData } from '@/function/initvar/variable_init';
import _ from 'lodash';
import { useDataStore } from '@/store';

type MvuData = any;

jest.mock('@/function/update_variables', () => ({
    updateVariables: jest.fn(),
    updateVariable: jest.fn(),
}));

jest.mock('@/function/initvar/variable_init', () => ({
    loadInitVarData: jest.fn(),
}));

const mockUpdateVariables = updateVariables as jest.MockedFunction<typeof updateVariables>;
const mockUpdateVariable = updateVariable as jest.MockedFunction<typeof updateVariable>;
const mockLoadInitVarData = loadInitVarData as jest.MockedFunction<typeof loadInitVarData>;

declare global {
    interface Window {
        Mvu: any;
    }
}

// 全局接口总体验证：统一准备酒馆变量和解析依赖，再分别验证各公开方法。
describe('exportGlobals', () => {
    let originalWindow: any;
    let mockMvuData: MvuData;
    let mockGetVariables: jest.Mock;
    let mockReplaceVariables: jest.Mock;
    let mockGetCurrentMessageId: jest.Mock;

    beforeEach(() => {
        originalWindow = global.window;
        global.window = {
            parent: {} as any,
        } as any;

        global._ = _;

        mockGetVariables = jest.fn();
        mockReplaceVariables = jest.fn();
        mockGetCurrentMessageId = jest.fn();

        (global as any).getVariables = mockGetVariables;
        (global as any).replaceVariables = mockReplaceVariables;
        (global as any).getCurrentMessageId = mockGetCurrentMessageId;

        mockMvuData = {
            initialized_lorebooks: { lorebook1: [], lorebook2: [] },
            stat_data: {
                health: 100,
                mana: 50,
                level: 5,
                nested: {
                    value: 42,
                },
                withDescription: [99, 'This is a description'],
            },
            display_data: {
                health_display: '100/100',
                mana_display: '50/50',
            },
            delta_data: {
                health_change: -10,
                mana_change: 5,
            },
            schema: {
                type: 'object',
                properties: {},
            },
        };

        jest.clearAllMocks();
        useDataStore().should_enable = true;
    });

    afterEach(() => {
        global.window = originalWindow;
        jest.restoreAllMocks();
    });

    // 接口导出：当前窗口和父窗口都获得完整方法与事件名称。
    describe('exportGlobals function', () => {
        test('should export Mvu object to window and window.parent', () => {
            exportGlobals();

            expect(global.window.Mvu).toBeDefined();
            expect(global.window.parent.Mvu).toBeDefined();
            expect(global.window.Mvu).toBe(global.window.parent.Mvu);
        });

        test('exported Mvu object should have all required properties', () => {
            exportGlobals();

            const mvu = global.window.Mvu;

            expect(mvu).toHaveProperty('events');
            expect(mvu).toHaveProperty('parseMessage');
            expect(mvu).toHaveProperty('getMvuData');
            expect(mvu).toHaveProperty('replaceMvuData');
            expect(mvu).toHaveProperty('getCurrentMvuData');
            expect(mvu).toHaveProperty('replaceCurrentMvuData');
            expect(mvu).toHaveProperty('reloadInitVar');
            expect(mvu).toHaveProperty('setMvuVariable');
            expect(mvu).toHaveProperty('getMvuVariable');
            expect(mvu).toHaveProperty('getRecordFromMvuData');
        });

        test('events property should contain correct event names', () => {
            exportGlobals();

            const mvu = global.window.Mvu;

            expect(mvu.events).toEqual(variable_events);
            expect(mvu.events.SINGLE_VARIABLE_UPDATED).toBe('mag_variable_updated');
            expect(mvu.events.VARIABLE_UPDATE_ENDED).toBe('mag_variable_update_ended');
            expect(mvu.events.VARIABLE_UPDATE_STARTED).toBe('mag_variable_update_started');
        });
    });

    // 消息解析：变量更新和无更新结果都返回独立数据。
    describe('parseMessage', () => {
        test('should update variables and return new variables', async () => {
            const newMvuData: MvuData = {
                ...mockMvuData,
                stat_data: { ...mockMvuData.stat_data, health: 90 } as MvuData['stat_data'],
            };

            mockUpdateVariables.mockImplementation(async (_message, variableData) => {
                Object.assign(variableData, newMvuData);
                return true;
            });

            exportGlobals();
            const mvu = global.window.Mvu;

            const result = await mvu.parseMessage('test message', mockMvuData);

            expect(mockUpdateVariables).toHaveBeenCalledWith('test message', expect.any(Object));
            expect(result).toEqual(newMvuData);
        });

        test('should still return cloned data when no updates are applied', async () => {
            mockUpdateVariables.mockImplementation(async () => {
                return false;
            });

            exportGlobals();
            const mvu = global.window.Mvu;

            const result = await mvu.parseMessage('test message', mockMvuData);

            expect(result).toEqual(mockMvuData);
        });
    });

    // 读取变量：将显式目标选项传给宿主并返回对应数据。
    describe('getMvuData', () => {
        test('should call getVariables with correct options and return MvuData', () => {
            mockGetVariables.mockReturnValue(mockMvuData);

            exportGlobals();
            const mvu = global.window.Mvu;

            const options = { type: 'message', message_id: 'test-id' };
            const result = mvu.getMvuData(options);

            expect(mockGetVariables).toHaveBeenCalledWith(options);
            expect(result).toEqual(mockMvuData);
        });
    });

    // 替换变量：原样转交目标选项和完整变量数据。
    describe('replaceMvuData', () => {
        test('should call replaceVariables with correct parameters', async () => {
            mockReplaceVariables.mockResolvedValue(undefined);

            exportGlobals();
            const mvu = global.window.Mvu;

            const options = { type: 'chat' };
            await mvu.replaceMvuData(mockMvuData, options);

            expect(mockReplaceVariables).toHaveBeenCalledWith(mockMvuData, options);
        });
    });

    // 读取当前消息：使用当前楼层的变量目标。
    describe('getCurrentMvuData', () => {
        test('should get variables for current message', () => {
            mockGetCurrentMessageId.mockReturnValue('current-msg-123');
            mockGetVariables.mockReturnValue(mockMvuData);

            exportGlobals();
            const mvu = global.window.Mvu;

            const result = mvu.getCurrentMvuData();

            expect(mockGetCurrentMessageId).toHaveBeenCalled();
            expect(mockGetVariables).toHaveBeenCalledWith({
                type: 'message',
                message_id: 'current-msg-123',
            });
            expect(result).toEqual(mockMvuData);
        });
    });

    // 替换当前消息：写入当前楼层而非其他变量存储。
    describe('replaceCurrentMvuData', () => {
        test('should replace variables for current message', async () => {
            mockGetCurrentMessageId.mockReturnValue('current-msg-456');
            mockReplaceVariables.mockResolvedValue(undefined);

            exportGlobals();
            const mvu = global.window.Mvu;

            await mvu.replaceCurrentMvuData(mockMvuData);

            expect(mockGetCurrentMessageId).toHaveBeenCalled();
            expect(mockReplaceVariables).toHaveBeenCalledWith(mockMvuData, {
                type: 'message',
                message_id: 'current-msg-456',
            });
        });
    });

    // 重新初始化：分别检查初始化成功与失败的布尔返回。
    describe('reloadInitVar', () => {
        test('should call loadInitVarData and return true on success', async () => {
            mockLoadInitVarData.mockResolvedValue(true);

            exportGlobals();
            const mvu = global.window.Mvu;

            const result = await mvu.reloadInitVar(mockMvuData);

            expect(mockLoadInitVarData).toHaveBeenCalledWith(mockMvuData);
            expect(result).toBe(true);
        });

        test('should return false on failure', async () => {
            mockLoadInitVarData.mockResolvedValue(false);

            exportGlobals();
            const mvu = global.window.Mvu;

            const result = await mvu.reloadInitVar(mockMvuData);

            expect(result).toBe(false);
        });
    });

    // 单变量写入：验证默认选项、自定义原因和递归标记，以及失败返回。
    describe('setMvuVariable', () => {
        test('should update variable with default options', async () => {
            mockUpdateVariable.mockResolvedValue(true);

            exportGlobals();
            const mvu = global.window.Mvu;

            const result = await mvu.setMvuVariable(mockMvuData, 'health', 80);

            expect(mockUpdateVariable).toHaveBeenCalledWith(
                mockMvuData.stat_data,
                'health',
                80,
                '',
                false
            );
            expect(result).toBe(true);
        });

        test('should update variable with custom reason and recursive flag', async () => {
            mockUpdateVariable.mockResolvedValue(true);

            exportGlobals();
            const mvu = global.window.Mvu;

            const result = await mvu.setMvuVariable(mockMvuData, 'nested.value', 100, {
                reason: 'Level up bonus',
                is_recursive: true,
            });

            expect(mockUpdateVariable).toHaveBeenCalledWith(
                mockMvuData.stat_data,
                'nested.value',
                100,
                'Level up bonus',
                true
            );
            expect(result).toBe(true);
        });

        test('should return false when update fails', async () => {
            mockUpdateVariable.mockResolvedValue(false);

            exportGlobals();
            const mvu = global.window.Mvu;

            const result = await mvu.setMvuVariable(mockMvuData, 'invalid.path', 999);

            expect(result).toBe(false);
        });
    });

    // 单变量读取：覆盖数据类别、缺失路径、描述包装和嵌套路径。
    describe('getMvuVariable', () => {
        test('should get value from stat_data by default', () => {
            exportGlobals();
            const mvu = global.window.Mvu;

            const result = mvu.getMvuVariable(mockMvuData, 'health');

            expect(result).toBe(100);
        });

        test('should get value from display_data when category is display', () => {
            exportGlobals();
            const mvu = global.window.Mvu;

            const result = mvu.getMvuVariable(mockMvuData, 'health_display', {
                category: 'display',
            });

            expect(result).toBe('100/100');
        });

        test('should get value from delta_data when category is delta', () => {
            exportGlobals();
            const mvu = global.window.Mvu;

            const result = mvu.getMvuVariable(mockMvuData, 'health_change', {
                category: 'delta',
            });

            expect(result).toBe(-10);
        });

        test('should return default value when path does not exist', () => {
            exportGlobals();
            const mvu = global.window.Mvu;

            const result = mvu.getMvuVariable(mockMvuData, 'non.existent.path', {
                default_value: 'default',
            });

            expect(result).toBe('default');
        });

        test('should extract first element from ValueWithDescription', () => {
            exportGlobals();
            const mvu = global.window.Mvu;

            const result = mvu.getMvuVariable(mockMvuData, 'withDescription');

            expect(result).toBe(99);
        });

        test('should get nested values correctly', () => {
            exportGlobals();
            const mvu = global.window.Mvu;

            const result = mvu.getMvuVariable(mockMvuData, 'nested.value');

            expect(result).toBe(42);
        });
    });

    // 数据类别选择：分别读取状态、展示和增量数据。
    describe('getRecordFromMvuData', () => {
        test('should return stat_data when category is stat', () => {
            exportGlobals();
            const mvu = global.window.Mvu;

            const result = mvu.getRecordFromMvuData(mockMvuData, 'stat');

            expect(result).toBe(mockMvuData.stat_data);
        });

        test('should return display_data when category is display', () => {
            exportGlobals();
            const mvu = global.window.Mvu;

            const result = mvu.getRecordFromMvuData(mockMvuData, 'display');

            expect(result).toBe(mockMvuData.display_data);
        });

        test('should return delta_data when category is delta', () => {
            exportGlobals();
            const mvu = global.window.Mvu;

            const result = mvu.getRecordFromMvuData(mockMvuData, 'delta');

            expect(result).toBe(mockMvuData.delta_data);
        });
    });

    // 异常与边界：空消息、缺失字段和不完整数据不破坏公开接口约定。
    describe('Edge Cases', () => {
        test('parseMessage should handle empty message', async () => {
            mockUpdateVariables.mockResolvedValue(false);

            exportGlobals();
            const mvu = global.window.Mvu;

            const result = await mvu.parseMessage('', mockMvuData);

            expect(mockUpdateVariables).toHaveBeenCalledWith('', expect.any(Object));
            expect(result).toEqual(mockMvuData);
        });

        test('getMvuVariable should handle undefined data gracefully', () => {
            const emptyMvuData: MvuData = {
                initialized_lorebooks: {},
                stat_data: {},
                display_data: {},
                delta_data: {},
                schema: {
                    type: 'object',
                    properties: {},
                },
            };

            exportGlobals();
            const mvu = global.window.Mvu;

            const result = mvu.getMvuVariable(emptyMvuData, 'any.path', {
                default_value: 'fallback',
            });

            expect(result).toBe('fallback');
        });

        test('setMvuVariable should handle empty path', async () => {
            mockUpdateVariable.mockResolvedValue(true);

            exportGlobals();
            const mvu = global.window.Mvu;

            await mvu.setMvuVariable(mockMvuData, '', 'value');

            expect(mockUpdateVariable).toHaveBeenCalledWith(
                mockMvuData.stat_data,
                '',
                'value',
                '',
                false
            );
        });
    });
});
