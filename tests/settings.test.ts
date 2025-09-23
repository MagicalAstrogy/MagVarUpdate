// Set up global mocks before any imports
const mockGetVariables = jest.fn();
const mockGetScriptId = jest.fn(() => 'test-script-id');

// Make lodash and mocked functions available globally BEFORE importing the module
import _ from 'lodash';
(global as any)._ = _;
(global as any).getVariables = mockGetVariables;
(global as any).getScriptId = mockGetScriptId;

// Now import the module after globals are set
import { getSettings, MvuSettings } from '@/settings';

describe('getSettings', () => {
    beforeEach(() => {
        mockGetVariables.mockClear();
    });

    describe('当变量不存在时', () => {
        it('应该返回默认设置并保存', async () => {
            mockGetVariables.mockReturnValue(undefined);

            const result = getSettings();

            expect(result).toEqual({
                是否显示变量更新错误: '否'
            });
        });

        it('应该处理空对象情况', async () => {
            mockGetVariables.mockReturnValue({});

            const result = getSettings();

            expect(result).toEqual({
                是否显示变量更新错误: '否',
            });
        });
    });

    describe('当设置验证失败时', () => {
        it('应该使用默认值补充缺失字段', async () => {
            mockGetVariables.mockReturnValue({
                其他字段: '值'
            });

            const result = getSettings();

            expect(result).toEqual({
                是否显示变量更新错误: '否',
            });
        });

        it('应该修正错误类型的字段', async () => {
            mockGetVariables.mockReturnValue({
                是否显示变量更新错误: 123 // 错误类型
            });

            const result = getSettings();

            expect(result).toEqual({
                是否显示变量更新错误: '否'
            });
        });
    });

    describe('边界情况', () => {
        it('只会得到需要的设置', async () => {
            const nestedSettings = {
                是否显示变量更新错误: '否',
                nested: {
                    deep: {
                        value: 'test'
                    }
                }
            };
            mockGetVariables.mockReturnValue(nestedSettings);

            const result = getSettings();

            expect(result).toEqual({
                是否显示变量更新错误: '否',
            });
        });

        it('应该处理含有特殊字符的值', async () => {
            mockGetVariables.mockReturnValue({
                是否显示变量更新错误: '是\n否'
            });

            const result = getSettings();

            expect(result).toEqual({
                是否显示变量更新错误: '否'
            });
        });

        it('应该处理Unicode字符', async () => {
            mockGetVariables.mockReturnValue({
                是否显示变量更新错误: '✓'
            });

            const result = getSettings();

            expect(result).toEqual({
                是否显示变量更新错误: '否'
            });
        });
    });

    describe('并发调用', () => {
        it('应该正确处理并发调用', async () => {
            mockGetVariables.mockReturnValue({
                是否显示变量更新错误: 'concurrent'
            });

            const results = await Promise.all([
                getSettings(),
                getSettings(),
                getSettings()
            ]);

            results.forEach(result => {
                expect(result).toEqual({
                    是否显示变量更新错误: '否'
                });
            });
        });
    });

    describe('类型安全', () => {
        it('返回值应该符合MvuSettings类型', async () => {
            mockGetVariables.mockReturnValue({
                是否显示变量更新错误: '是'
            });

            const result: MvuSettings = getSettings();

            expect(result).toBeDefined();
            expect(typeof result.是否显示变量更新错误).toBe('string');
        });
    });
});
