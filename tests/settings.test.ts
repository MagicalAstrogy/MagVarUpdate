// Set up global mocks before any imports
const mockGetVariables = jest.fn();
const mockReplaceVariables = jest.fn();
const mockGetScriptId = jest.fn(() => 'test-script-id');

// Make lodash and mocked functions available globally BEFORE importing the module
import _ from 'lodash';
(global as any)._ = _;
(global as any).getVariables = mockGetVariables;
(global as any).replaceVariables = mockReplaceVariables;
(global as any).getScriptId = mockGetScriptId;

// Now import the module after globals are set
import { GetSettings, VerifySettings, type MvuSettings } from '@/settings';

describe('VerifySettings', () => {
    it('应该接受有效的设置对象', () => {
        const validSettings = {
            是否显示变量更新错误: '是',
        };
        expect(VerifySettings(validSettings)).toBe(true);
    });

    it('应该接受值为"否"的设置', () => {
        const validSettings = {
            是否显示变量更新错误: '否',
        };
        expect(VerifySettings(validSettings)).toBe(true);
    });

    it('应该接受任意字符串值', () => {
        const validSettings = {
            是否显示变量更新错误: '其他值',
        };
        expect(VerifySettings(validSettings)).toBe(true);
    });

    it('应该拒绝null或undefined', () => {
        expect(VerifySettings(null)).toBe(false);
        expect(VerifySettings(undefined)).toBe(false);
    });

    it('应该拒绝非对象类型', () => {
        expect(VerifySettings('string')).toBe(false);
        expect(VerifySettings(123)).toBe(false);
        expect(VerifySettings(true)).toBe(false);
    });

    it('应该拒绝缺少必需字段的对象', () => {
        const invalidSettings = {
            其他字段: '值',
        };
        expect(VerifySettings(invalidSettings)).toBe(false);
    });

    it('应该拒绝字段类型不正确的对象', () => {
        const invalidSettings = {
            是否显示变量更新错误: 123, // 应该是字符串
        };
        expect(VerifySettings(invalidSettings)).toBe(false);
    });

    it('应该接受包含额外字段的对象', () => {
        const settingsWithExtra = {
            是否显示变量更新错误: '是',
            额外字段: 'extra',
        };
        expect(VerifySettings(settingsWithExtra)).toBe(true);
    });
});

describe('GetSettings', () => {
    beforeEach(() => {
        // Reset mocks before each test
        mockGetVariables.mockClear();
        mockReplaceVariables.mockClear();
        mockReplaceVariables.mockResolvedValue(undefined);
    });

    describe('当变量不存在时', () => {
        it('应该返回默认设置并保存', async () => {
            mockGetVariables.mockReturnValue(undefined);

            const result = await GetSettings();

            expect(result).toEqual({
                是否显示变量更新错误: '是',
                构建信息: '未知',
            });
            expect(mockReplaceVariables).toHaveBeenCalledWith(
                { 是否显示变量更新错误: '是', 构建信息: '未知' },
                { type: 'script', script_id: 'test-script-id' }
            );
        });

        it('应该处理空对象情况', async () => {
            mockGetVariables.mockReturnValue({});

            const result = await GetSettings();

            expect(result).toEqual({
                是否显示变量更新错误: '是',
                构建信息: '未知',
            });
            expect(mockReplaceVariables).toHaveBeenCalledWith(
                { 是否显示变量更新错误: '是', 构建信息: '未知' },
                { type: 'script', script_id: 'test-script-id' }
            );
        });
    });

    describe('当设置验证失败时', () => {
        it('应该使用默认值补充缺失字段', async () => {
            mockGetVariables.mockReturnValue({
                其他字段: '值',
            });

            const result = await GetSettings();

            expect(result).toEqual({
                其他字段: '值',
                是否显示变量更新错误: '是',
                构建信息: '未知',
            });
            expect(mockReplaceVariables).toHaveBeenCalledWith(
                { 其他字段: '值', 是否显示变量更新错误: '是', 构建信息: '未知' },
                { type: 'script', script_id: 'test-script-id' }
            );
        });

        it('应该修正错误类型的字段', async () => {
            mockGetVariables.mockReturnValue({
                是否显示变量更新错误: 123, // 错误类型
            });

            const result = await GetSettings();

            expect(result).toEqual({
                是否显示变量更新错误: '否',
                构建信息: '未知',
            });
            expect(mockReplaceVariables).toHaveBeenCalled();
        });
    });

    describe('值退化处理', () => {
        it('应该保留"是"的值', async () => {
            mockGetVariables.mockReturnValue({
                是否显示变量更新错误: '是',
                构建信息: '未知',
            });

            const result = await GetSettings();

            expect(result).toEqual({
                是否显示变量更新错误: '是',
                构建信息: '未知',
            });
            // 值没有变化，不应该调用 replaceVariables
            expect(mockReplaceVariables).not.toHaveBeenCalled();
        });

        it('应该保留"否"的值', async () => {
            mockGetVariables.mockReturnValue({
                是否显示变量更新错误: '否',
                构建信息: '未知',
            });

            const result = await GetSettings();

            expect(result).toEqual({
                是否显示变量更新错误: '否',
                构建信息: '未知',
            });
            // 值没有变化，不应该调用 replaceVariables
            expect(mockReplaceVariables).not.toHaveBeenCalled();
        });

        it('应该将其他字符串值退化为"否"', async () => {
            mockGetVariables.mockReturnValue({
                是否显示变量更新错误: 'true',
            });

            const result = await GetSettings();

            expect(result).toEqual({
                是否显示变量更新错误: '否',
                构建信息: '未知',
            });
            expect(mockReplaceVariables).toHaveBeenCalledWith(
                { 是否显示变量更新错误: '否', 构建信息: '未知' },
                { type: 'script', script_id: 'test-script-id' }
            );
        });

        it('应该将"yes"退化为"否"', async () => {
            mockGetVariables.mockReturnValue({
                是否显示变量更新错误: 'yes',
            });

            const result = await GetSettings();

            expect(result).toEqual({
                是否显示变量更新错误: '否',
                构建信息: '未知',
            });
            expect(mockReplaceVariables).toHaveBeenCalled();
        });

        it('应该将空字符串退化为"否"', async () => {
            mockGetVariables.mockReturnValue({
                是否显示变量更新错误: '',
            });

            const result = await GetSettings();

            expect(result).toEqual({
                是否显示变量更新错误: '否',
                构建信息: '未知',
            });
            expect(mockReplaceVariables).toHaveBeenCalled();
        });
    });

    describe('保存行为', () => {
        it('当设置未改变时不应该保存', async () => {
            mockGetVariables.mockReturnValue({
                是否显示变量更新错误: '是',
                构建信息: '未知',
            });

            await GetSettings();

            expect(mockReplaceVariables).not.toHaveBeenCalled();
        });

        it('当设置改变时应该保存', async () => {
            mockGetVariables.mockReturnValue({
                是否显示变量更新错误: 'maybe',
            });

            await GetSettings();

            expect(mockReplaceVariables).toHaveBeenCalledTimes(1);
            expect(mockReplaceVariables).toHaveBeenCalledWith(
                { 是否显示变量更新错误: '否', 构建信息: '未知' },
                { type: 'script', script_id: 'test-script-id' }
            );
        });

        it('应该处理保存时的错误', async () => {
            mockGetVariables.mockReturnValue({
                是否显示变量更新错误: 'invalid',
            });
            mockReplaceVariables.mockRejectedValue(new Error('Save failed'));

            await expect(GetSettings()).rejects.toThrow('Save failed');
        });
    });

    describe('边界情况', () => {
        it('不应该处理嵌套对象污染', async () => {
            const nestedSettings = {
                是否显示变量更新错误: '是',
                构建信息: '未知',
                nested: {
                    deep: {
                        value: 'test',
                    },
                },
            };
            mockGetVariables.mockReturnValue(nestedSettings);

            const result = await GetSettings();

            expect(result).toEqual({
                是否显示变量更新错误: '是',
                构建信息: '未知',
                nested: {
                    deep: {
                        value: 'test',
                    },
                },
            });
            expect(mockReplaceVariables).not.toHaveBeenCalled();
        });

        it('应该处理含有特殊字符的值', async () => {
            mockGetVariables.mockReturnValue({
                是否显示变量更新错误: '是\n否',
            });

            const result = await GetSettings();

            expect(result).toEqual({
                是否显示变量更新错误: '否',
                构建信息: '未知',
            });
            expect(mockReplaceVariables).toHaveBeenCalled();
        });

        it('应该处理Unicode字符', async () => {
            mockGetVariables.mockReturnValue({
                是否显示变量更新错误: '✓',
            });

            const result = await GetSettings();

            expect(result).toEqual({
                是否显示变量更新错误: '否',
                构建信息: '未知',
            });
            expect(mockReplaceVariables).toHaveBeenCalled();
        });
    });

    describe('并发调用', () => {
        it('应该正确处理并发调用', async () => {
            mockGetVariables.mockReturnValue({
                是否显示变量更新错误: 'concurrent',
            });

            const results = await Promise.all([GetSettings(), GetSettings(), GetSettings()]);

            results.forEach(result => {
                expect(result).toEqual({
                    是否显示变量更新错误: '否',
                    构建信息: '未知',
                });
            });

            // 每次调用都会触发保存
            expect(mockReplaceVariables).toHaveBeenCalledTimes(3);
        });
    });

    describe('类型安全', () => {
        it('返回值应该符合MvuSettings类型', async () => {
            mockGetVariables.mockReturnValue({
                是否显示变量更新错误: '是',
            });

            const result: MvuSettings = await GetSettings();

            expect(result).toBeDefined();
            expect(typeof result.是否显示变量更新错误).toBe('string');
        });
    });
});
