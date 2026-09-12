/**
 * 测试场景：验证额外模型应答格式及相关默认设置，覆盖旧工具调用标记迁移、显式选项优先和历史条数限制。
 */
import { useDataStore } from '@/store';

// 设置默认与迁移：格式、思考、随机头部和世界书过滤保持约定，合法显式值不被迁移覆盖。
describe('extra model response format settings', () => {
    beforeEach(() => {
        (globalThis as any).SillyTavern.extensionSettings = {};
    });

    afterEach(() => {
        (globalThis as any).SillyTavern.extensionSettings = {};
    });

    test('defaults to chat message response format', () => {
        const store = useDataStore();

        expect(store.settings.额外模型解析配置.应答格式).toBe('聊天消息');
        expect(store.settings.额外模型解析配置.兼容假流式).toBe(false);
    });

    test('migrates legacy function calling flag to tool calling response format', () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                额外模型解析配置: {
                    使用函数调用: true,
                },
            },
        };

        const store = useDataStore();

        expect(store.settings.额外模型解析配置.应答格式).toBe('工具调用');
    });

    test('keeps explicit response format over legacy flag', () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                额外模型解析配置: {
                    使用函数调用: true,
                    应答格式: '格式化输出',
                },
            },
        };

        const store = useDataStore();

        expect(store.settings.额外模型解析配置.应答格式).toBe('格式化输出');
    });

    test('accepts v4 compatible formatted output response format', () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                额外模型解析配置: {
                    应答格式: '格式化输出(v4兼容)',
                },
            },
        };

        const store = useDataStore();

        expect(store.settings.额外模型解析配置.应答格式).toBe('格式化输出(v4兼容)');
    });

    // 关联默认值：历史条数、世界书正则、思考和随机头部在加载后保持预期范围与开关状态。
    test('defaults max chat history to the previous hardcoded value', () => {
        const store = useDataStore();

        expect(store.settings.额外模型解析配置.max_chat_history).toBe(2);
    });

    test('defaults worldbook entry comment filters to disabled empty regexes', () => {
        const store = useDataStore();

        expect(store.settings.额外模型解析配置.世界书条目白名单正则).toBe('');
        expect(store.settings.额外模型解析配置.世界书条目黑名单正则).toBe('');
    });

    test('keeps configured worldbook entry comment filters when loading settings', () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                额外模型解析配置: {
                    世界书条目白名单正则: '角色|地点',
                    世界书条目黑名单正则: '/临时/i',
                },
            },
        };

        const store = useDataStore();

        expect(store.settings.额外模型解析配置.世界书条目白名单正则).toBe('角色|地点');
        expect(store.settings.额外模型解析配置.世界书条目黑名单正则).toBe('/临时/i');
    });

    test('defaults v4 compatible thinking override to disabled state off', () => {
        const store = useDataStore();

        expect(store.settings.额外模型解析配置.关闭thinking).toBe(false);
    });

    test('defaults random header to enabled', () => {
        const store = useDataStore();

        expect(store.settings.额外模型解析配置.随机头部).toBe(true);
    });

    test('clamps max chat history to the supported range', () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                额外模型解析配置: {
                    max_chat_history: 150,
                },
            },
        };

        expect(useDataStore().settings.额外模型解析配置.max_chat_history).toBe(100);

        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                额外模型解析配置: {
                    max_chat_history: 1,
                },
            },
        };

        const store = useDataStore();
        store._reload_settings();

        expect(store.settings.额外模型解析配置.max_chat_history).toBe(2);
    });
});
