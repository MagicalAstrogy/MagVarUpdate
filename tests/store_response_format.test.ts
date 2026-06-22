import { useDataStore } from '@/store';

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

    test('defaults max chat history to the previous hardcoded value', () => {
        const store = useDataStore();

        expect(store.settings.额外模型解析配置.max_chat_history).toBe(2);
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
