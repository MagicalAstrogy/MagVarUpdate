import { useDataStore } from '@/store';
import { nextTick } from 'vue';

describe('settings unknown field passthrough', () => {
    beforeEach(() => {
        (globalThis as any).SillyTavern.extensionSettings = {};
    });

    afterEach(() => {
        (globalThis as any).SillyTavern.extensionSettings = {};
    });

    test('provides fail-closed pi defaults without changing the legacy model source', () => {
        const store = useDataStore();

        expect(store.settings.额外模型解析配置.模型来源).toBe('与插头相同');
        expect(store.settings.额外模型解析配置.pi).toEqual({
            provider: 'openai',
            api: 'openai-responses',
            authType: 'api_key',
            endpoint: '',
            useProxy: false,
            model: '',
            contextWindow: 0,
            credentials: {},
            apiKeys: {},
            customHeaders: '',
            customIncludeBody: '',
            customExcludeBody: '',
        });
    });

    test('loads pi settings permissively and strips credentials misplaced in profiles', () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                额外模型解析配置: {
                    模型来源: '更多',
                    密钥: 'must-clear-active-oauth-root-key',
                    pi: {
                        provider: 'future-provider',
                        api: 'future-wire-api',
                        authType: 'oauth',
                        endpoint: 'https://api.example/v1',
                        useProxy: true,
                        model: 'future-model',
                        contextWindow: 200000.6,
                        credentials: {
                            'future-provider': {
                                type: 'future_credential',
                                opaque: { keep: true },
                            },
                        },
                        apiKeys: {
                            'future-provider\nhttps://api.example/v1': 'provider-secret',
                        },
                        customHeaders: 'X-Test: value',
                        customIncludeBody: 'metadata:\n  source: mvu',
                        customExcludeBody: '- store',
                        future_pi_setting: { keep: true },
                    },
                    api方案列表: [
                        {
                            名称: 'Pi 方案',
                            backend: 'pi',
                            密钥: 'must-remove-oauth-profile-key',
                            customApiKey: 'must-remove-custom-cache',
                            pi: {
                                provider: 'future-provider',
                                api: 'future-wire-api',
                                authType: 'oauth',
                                endpoint: 'https://api.example/v1',
                                useProxy: true,
                                model: 'future-model',
                                contextWindow: 200000,
                                credentials: { leaked: { type: 'oauth', access: 'must-remove' } },
                                apiKeys: {
                                    'future-provider\nhttps://api.example/v1': 'must-remove-key',
                                },
                                customHeaders: '',
                                customIncludeBody: '',
                                customExcludeBody: '',
                                future_profile_pi: { keep: true },
                            },
                        },
                    ],
                    当前api方案: 'Pi 方案',
                },
            },
        };

        const store = useDataStore();
        const config = store.settings.额外模型解析配置;

        expect(config.模型来源).toBe('更多');
        expect(config.密钥).toBe('');
        expect(config.pi).toMatchObject({
            provider: 'future-provider',
            api: 'future-wire-api',
            contextWindow: 200000.6,
            useProxy: true,
            credentials: {
                'future-provider': {
                    type: 'future_credential',
                    opaque: { keep: true },
                },
            },
            apiKeys: {
                'future-provider\nhttps://api.example/v1': 'provider-secret',
            },
            future_pi_setting: { keep: true },
        });
        expect(config.api方案列表[0]).toMatchObject({
            backend: 'pi',
            密钥: '',
            pi: { useProxy: true, future_profile_pi: { keep: true } },
        });
        expect(config.api方案列表[0].pi).not.toHaveProperty('credentials');
        expect(config.api方案列表[0].pi).not.toHaveProperty('apiKeys');
        expect(config.api方案列表[0]).not.toHaveProperty('customApiKey');
    });

    test('keeps a profile but drops a partial Pi snapshot instead of filling wire defaults', () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                额外模型解析配置: {
                    模型来源: '更多',
                    api方案列表: [
                        {
                            名称: 'Partial Pi',
                            backend: 'pi',
                            api地址: '',
                            密钥: 'must-not-bind-to-openai',
                            模型名称: '',
                            pi: { provider: 'future-provider', model: 'future-model' },
                        },
                    ],
                    当前api方案: 'Partial Pi',
                },
            },
        };

        const store = useDataStore();
        const config = store.settings.额外模型解析配置;

        expect(config.api方案列表).toHaveLength(1);
        expect(config.api方案列表[0]).toMatchObject({
            名称: 'Partial Pi',
            backend: 'pi',
            密钥: '',
        });
        expect(config.api方案列表[0].pi).toBeUndefined();
        expect(config.模型来源).toBe('更多');
        expect(config.密钥).toBe('');
        expect(config.pi).toMatchObject({ provider: '', api: '', model: '' });
    });

    test('normalizes profile names and numeric contextWindow strings during import', () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                额外模型解析配置: {
                    模型来源: '更多',
                    api地址: 'https://hidden-custom.example/v1',
                    模型名称: 'hidden-custom-model',
                    api方案列表: [
                        {
                            名称: ' Pi 方案 ',
                            backend: 'pi',
                            api地址: 'https://legacy-profile-custom.example/v1',
                            密钥: '',
                            模型名称: 'legacy-profile-custom-model',
                            pi: {
                                provider: 'anthropic',
                                api: 'anthropic-messages',
                                authType: 'oauth',
                                endpoint: '',
                                model: 'claude-sonnet-4-5',
                                contextWindow: ' 200000 ',
                                customHeaders: '',
                                customIncludeBody: '',
                                customExcludeBody: '',
                            },
                        },
                    ],
                    当前api方案: ' Pi 方案 ',
                },
            },
        };

        const config = useDataStore().settings.额外模型解析配置;

        expect(config.当前api方案).toBe('Pi 方案');
        expect(config.api方案列表[0]).toMatchObject({
            名称: 'Pi 方案',
            api地址: '',
            模型名称: '',
            pi: { contextWindow: 200_000 },
        });
        expect(typeof config.api方案列表[0].pi?.contextWindow).toBe('number');
        expect(config.api方案列表[0].pi?.useProxy).toBe(false);
        expect(config.api地址).toBe('https://hidden-custom.example/v1');
        expect(config.模型名称).toBe('hidden-custom-model');
    });

    test('canonicalizes Pi connection identifiers consistently in active settings and profiles', () => {
        const pi = {
            provider: ' openai ',
            api: ' openai-responses ',
            authType: ' api_key ',
            endpoint: ' https://api.openai.com/v1/ ',
            model: ' gpt-4.1 ',
            contextWindow: 128_000,
            customHeaders: '',
            customIncludeBody: '',
            customExcludeBody: '',
        };
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                额外模型解析配置: {
                    模型来源: '更多',
                    api地址: '',
                    密钥: 'profile-secret',
                    模型名称: '',
                    pi,
                    api方案列表: [
                        {
                            名称: 'Pi Canonical',
                            backend: 'pi',
                            api地址: '',
                            密钥: 'profile-secret',
                            模型名称: '',
                            pi,
                        },
                    ],
                    当前api方案: 'Pi Canonical',
                },
            },
        };

        const config = useDataStore().settings.额外模型解析配置;

        expect(config.pi).toMatchObject({
            provider: 'openai',
            api: 'openai-responses',
            authType: 'api_key',
            endpoint: 'https://api.openai.com/v1/',
            model: 'gpt-4.1',
        });
        expect(config.api方案列表[0].pi).toMatchObject({
            provider: 'openai',
            api: 'openai-responses',
            authType: 'api_key',
            endpoint: 'https://api.openai.com/v1/',
            model: 'gpt-4.1',
        });
        expect(config.密钥).toBe('profile-secret');
        expect(config.api方案列表[0].密钥).toBe('profile-secret');
    });

    test('clears an active root key for an invalid Pi target while preserving isolated caches', () => {
        const pi = {
            provider: 'openai',
            api: 'openai-responses',
            authType: 'api_key',
            endpoint: 'not a URL',
            model: 'gpt-4.1',
            contextWindow: 128_000,
            credentials: { anthropic: { type: 'oauth', access: 'keep-oauth' } },
            apiKeys: { 'openai\nhttps://api.openai.com/v1': 'keep-scoped-key' },
            customHeaders: '',
            customIncludeBody: '',
            customExcludeBody: '',
        };
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                future_top_level: 'keep',
                额外模型解析配置: {
                    模型来源: '更多',
                    api地址: '',
                    密钥: 'must-clear-unowned-root-key',
                    customApiKey: 'keep-custom-key',
                    模型名称: '',
                    pi,
                    api方案列表: [
                        {
                            名称: 'Invalid Target',
                            backend: 'pi',
                            api地址: '',
                            密钥: 'must-clear-profile-key',
                            模型名称: '',
                            pi,
                        },
                    ],
                    当前api方案: 'Invalid Target',
                },
            },
        };

        const store = useDataStore();
        const config = store.settings.额外模型解析配置;

        expect(config.密钥).toBe('');
        expect(config.api方案列表[0].密钥).toBe('');
        expect(config.customApiKey).toBe('keep-custom-key');
        expect(config.pi.credentials).toEqual(pi.credentials);
        expect(config.pi.apiKeys).toEqual(pi.apiKeys);
        expect((store.settings as any).future_top_level).toBe('keep');
    });

    test('preserves an unsupported active auth identifier but fails its root key closed', () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                future_top_level: 'keep',
                更新方式: '额外模型解析',
                额外模型解析配置: {
                    模型来源: '更多',
                    api地址: '',
                    密钥: 'must-clear-unowned-root-key',
                    模型名称: '',
                    pi: {
                        provider: 'openai',
                        api: 'openai-responses',
                        authType: 'future-auth',
                        endpoint: '',
                        model: 'gpt-4.1',
                        contextWindow: 128_000,
                    },
                },
            },
        };

        const store = useDataStore();
        const config = store.settings.额外模型解析配置;

        expect(store.settings.更新方式).toBe('额外模型解析');
        expect((store.settings as any).future_top_level).toBe('keep');
        expect(config.pi.authType).toBe('future-auth');
        expect(config.密钥).toBe('');
    });

    test('filters one malformed profile without resetting settings or retaining its credentials', () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                future_top_level: { keep: true },
                更新方式: '额外模型解析',
                额外模型解析配置: {
                    破限方案: '使用其他预设',
                    其他预设名称: 'must-survive',
                    模型来源: '自定义',
                    api方案列表: [
                        {
                            名称: 'Valid A',
                            api地址: 'https://a.example/v1',
                            密钥: 'key-a',
                            模型名称: 'model-a',
                        },
                        {
                            名称: 42,
                            backend: 'pi',
                            密钥: 'malformed-profile-key',
                            customApiKey: 'malformed-custom-key',
                            pi: {
                                credentials: {
                                    anthropic: { access: 'malformed-oauth-token' },
                                },
                                apiKeys: { leaked: 'malformed-cached-key' },
                            },
                        },
                        {
                            名称: 'Valid B',
                            api地址: 'https://b.example/v1',
                            密钥: 'key-b',
                            模型名称: 'model-b',
                        },
                    ],
                    当前api方案: 'Valid A',
                },
            },
        };

        const store = useDataStore();
        const serialized = JSON.stringify(store.settings);

        expect(store.settings.更新方式).toBe('额外模型解析');
        expect(store.settings.额外模型解析配置.破限方案).toBe('使用其他预设');
        expect(store.settings.额外模型解析配置.其他预设名称).toBe('must-survive');
        expect(store.settings.额外模型解析配置.api方案列表.map(profile => profile.名称)).toEqual([
            'Valid A',
            'Valid B',
        ]);
        expect((store.settings as any).future_top_level).toEqual({ keep: true });
        expect(serialized).not.toContain('malformed-profile-key');
        expect(serialized).not.toContain('malformed-custom-key');
        expect(serialized).not.toContain('malformed-oauth-token');
        expect(serialized).not.toContain('malformed-cached-key');
    });

    test('drops an invalid profile contextWindow snapshot and its key without resetting settings', () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                future_top_level: 'keep',
                更新方式: '额外模型解析',
                额外模型解析配置: {
                    模型来源: '更多',
                    api方案列表: [
                        {
                            名称: 'Invalid Context',
                            backend: 'pi',
                            密钥: 'must-not-survive',
                            pi: {
                                provider: 'openai',
                                api: 'openai-responses',
                                authType: 'api_key',
                                endpoint: '',
                                model: 'gpt-4.1',
                                contextWindow: 'not-a-number',
                                customHeaders: '',
                                customIncludeBody: '',
                                customExcludeBody: '',
                            },
                        },
                    ],
                    当前api方案: 'Invalid Context',
                },
            },
        };

        const store = useDataStore();
        const config = store.settings.额外模型解析配置;

        expect(store.settings.更新方式).toBe('额外模型解析');
        expect((store.settings as any).future_top_level).toBe('keep');
        expect(config.api方案列表[0]).toMatchObject({
            名称: 'Invalid Context',
            backend: 'pi',
            密钥: '',
        });
        expect(config.api方案列表[0].pi).toBeUndefined();
        expect(config.pi).toMatchObject({ provider: '', api: '', contextWindow: 0 });
        expect(config.密钥).toBe('');
    });

    test('filters whitespace-only profile names and keeps the first trimmed duplicate', () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                额外模型解析配置: {
                    模型来源: '自定义',
                    api地址: 'https://first.example/v1',
                    密钥: 'first-key',
                    模型名称: 'first-model',
                    api方案列表: [
                        {
                            名称: '方案 A',
                            api地址: 'https://first.example/v1',
                            密钥: 'first-key',
                            模型名称: 'first-model',
                        },
                        {
                            名称: ' 方案 A ',
                            api地址: 'https://duplicate.example/v1',
                            密钥: 'duplicate-key',
                            模型名称: 'duplicate-model',
                        },
                        {
                            名称: '   ',
                            api地址: 'https://blank.example/v1',
                            密钥: 'blank-key',
                            模型名称: 'blank-model',
                        },
                    ],
                    当前api方案: ' 方案 A ',
                },
            },
        };

        const config = useDataStore().settings.额外模型解析配置;

        expect(config.当前api方案).toBe('方案 A');
        expect(config.api方案列表).toHaveLength(1);
        expect(config.api方案列表[0]).toMatchObject({
            名称: '方案 A',
            api地址: 'https://first.example/v1',
            密钥: 'first-key',
        });
    });

    test('contains a malformed active-profile pointer without resetting valid settings', () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                future_top_level: 'keep',
                更新方式: '额外模型解析',
                额外模型解析配置: {
                    模型来源: '自定义',
                    api地址: 'https://api.example/v1',
                    密钥: 'key-a',
                    模型名称: 'model-a',
                    api方案列表: [
                        {
                            名称: 'Valid A',
                            api地址: 'https://api.example/v1',
                            密钥: 'key-a',
                            模型名称: 'model-a',
                        },
                    ],
                    当前api方案: { malformed: true },
                },
            },
        };

        const store = useDataStore();
        const config = store.settings.额外模型解析配置;

        expect(store.settings.更新方式).toBe('额外模型解析');
        expect((store.settings as any).future_top_level).toBe('keep');
        expect(config.api方案列表).toHaveLength(1);
        expect(config.当前api方案).toBe('');
        expect(config.api地址).toBe('https://api.example/v1');
    });

    test('contains malformed API-key caches without resetting unrelated settings', () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                future_top_level: 'keep',
                额外模型解析配置: {
                    customApiKey: { malformed: true },
                    pi: { apiKeys: ['not', 'a', 'record'] },
                },
            },
        };

        const store = useDataStore();

        expect(store.settings.额外模型解析配置.customApiKey).toBe('');
        expect(store.settings.额外模型解析配置.pi.apiKeys).toEqual({});
        expect((store.settings as any).future_top_level).toBe('keep');
    });

    test('contains a malformed OAuth credential cache without resetting unrelated settings', () => {
        _.set(SillyTavern.extensionSettings, 'mvu_settings', {
            更新方式: '额外模型解析',
            额外模型解析配置: {
                模型来源: '更多',
                破限方案: '使用其他预设',
                其他预设名称: '保留的预设名',
                pi: {
                    credentials: 'malformed',
                },
            },
        });

        const store = useDataStore();

        expect(store.settings.更新方式).toBe('额外模型解析');
        expect(store.settings.额外模型解析配置.破限方案).toBe('使用其他预设');
        expect(store.settings.额外模型解析配置.其他预设名称).toBe('保留的预设名');
        expect(store.settings.额外模型解析配置.pi.credentials).toEqual({});
    });

    test('preserves an invalid context window for fail-closed request validation', () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                future_top_level: 'keep',
                通知: { 变量更新出错: true },
                额外模型解析配置: {
                    模型来源: '更多',
                    pi: { contextWindow: 'not-a-number' },
                },
            },
        };

        const store = useDataStore();

        expect(store.settings.额外模型解析配置.pi.contextWindow).toBe('not-a-number');
        expect(store.settings.通知.变量更新出错).toBe(true);
        expect((store.settings as any).future_top_level).toBe('keep');
    });

    test('contains an invalid maximum-token value without resetting unrelated settings', () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                future_top_level: 'keep',
                通知: { 变量更新出错: true },
                额外模型解析配置: {
                    模型来源: '更多',
                    最大回复token数: 'not-a-number',
                },
            },
        };

        const store = useDataStore();

        expect(store.settings.额外模型解析配置.最大回复token数).toBe(0);
        expect(store.settings.通知.变量更新出错).toBe(true);
        expect((store.settings as any).future_top_level).toBe('keep');
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
