import { useDataStore } from '@/store';
import { nextTick } from 'vue';

describe('settings unknown field passthrough', () => {
    beforeEach(() => {
        (globalThis as any).SillyTavern.extensionSettings = {};
    });

    afterEach(() => {
        (globalThis as any).SillyTavern.extensionSettings = {};
    });

    test('preserves unknown fields at every current settings level when writing back', async () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                future_top_level: { enabled: true },
                通知: {
                    future_notification: 'keep-notification',
                },
                额外模型解析配置: {
                    模型来源: '自定义',
                    api地址: 'https://api.example/v1',
                    密钥: 'secret',
                    模型名称: 'model-a',
                    future_extra_model: { headers: { 'X-Test': 'keep' } },
                    api方案列表: [
                        {
                            名称: '方案 A',
                            api地址: 'https://api.example/v1',
                            密钥: 'secret',
                            模型名称: 'model-a',
                            future_profile: { provider: 'custom' },
                        },
                    ],
                    当前api方案: '方案 A',
                },
                自动清理变量: {
                    future_cleanup: ['keep-cleanup'],
                },
                兼容性: {
                    future_compatibility: 42,
                },
                internal: {
                    future_internal: { acknowledged: false },
                },
            },
        };

        const store = useDataStore();
        await nextTick();

        const loaded = store.settings as any;
        expect(loaded.future_top_level).toEqual({ enabled: true });
        expect(loaded.通知.future_notification).toBe('keep-notification');
        expect(loaded.额外模型解析配置.future_extra_model).toEqual({
            headers: { 'X-Test': 'keep' },
        });
        expect(loaded.额外模型解析配置.api方案列表[0].future_profile).toEqual({
            provider: 'custom',
        });
        expect(loaded.自动清理变量.future_cleanup).toEqual(['keep-cleanup']);
        expect(loaded.兼容性.future_compatibility).toBe(42);
        expect(loaded.internal.future_internal).toEqual({ acknowledged: false });

        (globalThis as any).SillyTavern.extensionSettings.mvu_settings = { sentinel: true };
        store.settings.通知.变量更新出错 = true;
        await nextTick();

        const persisted = (globalThis as any).SillyTavern.extensionSettings.mvu_settings;
        expect(persisted.sentinel).toBeUndefined();
        expect(persisted.通知.变量更新出错).toBe(true);
        expect(persisted).toMatchObject({
            future_top_level: { enabled: true },
            通知: { future_notification: 'keep-notification' },
            额外模型解析配置: {
                future_extra_model: { headers: { 'X-Test': 'keep' } },
                api方案列表: [{ future_profile: { provider: 'custom' } }],
            },
            自动清理变量: { future_cleanup: ['keep-cleanup'] },
            兼容性: { future_compatibility: 42 },
            internal: { future_internal: { acknowledged: false } },
        });
    });

    test('preserves unknown fields while migrating old settings', async () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                future_top_level: 'keep-top-level',
                通知: {
                    变量更新出错: true,
                    额外模型解析中: false,
                    future_notification: 'keep-notification',
                },
                更新方式: '额外模型解析',
                自动触发额外模型解析: false,
                额外模型解析配置: {
                    发送预设: true,
                    使用函数调用: true,
                    模型来源: '自定义',
                    api地址: 'https://legacy.example/v1',
                    密钥: 'legacy-key',
                    模型名称: 'legacy-model',
                    温度: 1,
                    频率惩罚: 0,
                    存在惩罚: 0,
                    top_p: 1,
                    最大回复token数: 4096,
                    future_extra_model: { provider: 'legacy' },
                },
                快照保留间隔: 25,
                更新到聊天变量: true,
                legacy: {
                    显示老旧功能: true,
                    future_legacy: 'keep-legacy',
                },
                auto_cleanup: {
                    启用: false,
                    要保留变量的最近楼层数: 12,
                    触发恢复变量的最近楼层数: 6,
                    future_cleanup: 'keep-cleanup',
                },
                自动清理变量: {
                    future_new_cleanup: 'keep-new-cleanup',
                },
                兼容性: {
                    future_new_compatibility: 'keep-new-compatibility',
                },
                internal: {
                    已提醒更新了配置界面: true,
                    已提醒自动清理旧变量功能: true,
                    已提醒更新了API温度等配置: true,
                    已默认开启自动清理旧变量功能: true,
                    future_internal: 'keep-internal',
                },
            },
        };

        const store = useDataStore();
        await nextTick();
        store.settings.自动清理变量.启用 = true;
        await nextTick();
        store._reload_settings();
        await nextTick();

        const migrated = store.settings as any;
        expect(migrated.future_top_level).toBe('keep-top-level');
        expect(migrated.通知.future_notification).toBe('keep-notification');
        expect(migrated.额外模型解析配置.future_extra_model).toEqual({ provider: 'legacy' });
        expect(migrated.自动清理变量).toMatchObject({
            future_cleanup: 'keep-cleanup',
            future_new_cleanup: 'keep-new-cleanup',
        });
        expect(migrated.兼容性).toMatchObject({
            future_legacy: 'keep-legacy',
            future_new_compatibility: 'keep-new-compatibility',
        });
        expect(migrated.internal.future_internal).toBe('keep-internal');
        expect(migrated.自动清理变量.启用).toBe(true);

        const persisted = (globalThis as any).SillyTavern.extensionSettings.mvu_settings;
        expect(persisted.future_top_level).toBe('keep-top-level');
        expect(persisted.额外模型解析配置.future_extra_model).toEqual({ provider: 'legacy' });
        expect(persisted.自动清理变量.future_cleanup).toBe('keep-cleanup');
        expect(persisted.兼容性.future_legacy).toBe('keep-legacy');
    });
});
