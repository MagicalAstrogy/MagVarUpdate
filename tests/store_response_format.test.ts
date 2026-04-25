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
});
