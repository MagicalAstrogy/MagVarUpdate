import {
    applyExtraModelApiProfile,
    clearUnboundExtraModelApiProfileFields,
    DEFAULT_EXTRA_MODEL_API_PROFILE_NAME,
    deleteActiveExtraModelApiProfile,
    deleteActiveExtraModelApiProfileWithConfirmation,
    isActiveExtraModelApiProfileDirty,
    migrateExtraModelApiProfiles,
    reconcileExtraModelApiProfileSelection,
    removeExtraModelApiProfile,
    saveAsNewExtraModelApiProfile,
    saveCurrentExtraModelApiProfile,
    selectExtraModelApiProfile,
    upsertExtraModelApiProfile,
    type ExtraModelApiProfile,
} from '@/function/update/extra_model_api_profiles';
import { useDataStore } from '@/store';
import { reactive } from 'vue';

const base_config = {
    模型来源: '自定义' as const,
    api地址: 'http://localhost:1234/v1',
    密钥: 'secret-a',
    模型名称: 'model-a',
    api方案列表: [] as ExtraModelApiProfile[],
    当前api方案: '',
};

const base_pi_settings = {
    provider: 'anthropic',
    api: 'anthropic-messages',
    authType: 'oauth' as const,
    endpoint: 'https://api.anthropic.com',
    useProxy: true,
    model: 'claude-sonnet-4-5',
    contextWindow: 200_000,
    credentials: {
        anthropic: {
            type: 'oauth',
            access: 'access-token',
            refresh: 'refresh-token',
            expires: 1_900_000_000_000,
        },
    },
    apiKeys: {
        'anthropic\nhttps://api.anthropic.com': 'cached-anthropic-key',
    },
    customHeaders: 'X-Test: true',
    customIncludeBody: 'metadata:\n  source: mvu',
    customExcludeBody: '- store',
    futurePiField: { nested: true },
};

describe('extra model api profiles', () => {
    beforeEach(() => {
        (globalThis as any).SillyTavern.extensionSettings = {};
    });

    afterEach(() => {
        (globalThis as any).SillyTavern.extensionSettings = {};
    });

    test('migrates legacy single api fields into a default profile', () => {
        const migrated = migrateExtraModelApiProfiles(base_config);

        expect(migrated.api方案列表).toEqual([
            {
                名称: DEFAULT_EXTRA_MODEL_API_PROFILE_NAME,
                backend: 'custom',
                api地址: 'http://localhost:1234/v1',
                密钥: 'secret-a',
                模型名称: 'model-a',
            },
        ]);
        expect(migrated.当前api方案).toBe(DEFAULT_EXTRA_MODEL_API_PROFILE_NAME);
    });

    test('switches active api fields when selecting a saved profile', () => {
        const config = {
            ...base_config,
            api方案列表: [
                {
                    名称: '剧情',
                    api地址: 'https://api-a.example/v1',
                    密钥: 'key-a',
                    模型名称: 'gemini-a',
                },
                {
                    名称: '变量',
                    api地址: 'https://api-b.example/v1',
                    密钥: 'key-b',
                    模型名称: 'gemini-b',
                },
            ],
            当前api方案: '剧情',
        };

        const selected = selectExtraModelApiProfile(config, '变量');

        expect(selected.当前api方案).toBe('变量');
        expect(selected.api地址).toBe('https://api-b.example/v1');
        expect(selected.密钥).toBe('key-b');
        expect(selected.模型名称).toBe('gemini-b');
    });

    test('upserts profiles by name', () => {
        const profiles = upsertExtraModelApiProfile([], {
            名称: '变量',
            api地址: 'https://api-b.example/v1',
            密钥: 'key-b',
            模型名称: 'gemini-b',
        });

        const updated = upsertExtraModelApiProfile(profiles, {
            名称: '变量',
            api地址: 'https://api-b.example/v1',
            密钥: 'new-key',
            模型名称: 'gemini-b',
        });

        expect(updated).toHaveLength(1);
        expect(updated[0].密钥).toBe('new-key');
    });

    test('saves current fields into the active profile', () => {
        const saved = saveCurrentExtraModelApiProfile(
            applyExtraModelApiProfile(base_config, {
                名称: '变量',
                api地址: 'https://api-b.example/v1',
                密钥: 'key-b',
                模型名称: 'gemini-b',
            }),
            '变量'
        );

        expect(saved.当前api方案).toBe('变量');
        expect(saved.api方案列表).toEqual([
            {
                名称: '变量',
                backend: 'custom',
                api地址: 'https://api-b.example/v1',
                密钥: 'key-b',
                模型名称: 'gemini-b',
            },
        ]);
    });

    test('preserves unknown profile fields when saving the active profile', () => {
        const config = {
            ...base_config,
            api地址: 'https://edited.example/v1',
            api方案列表: [
                {
                    名称: '变量',
                    api地址: 'https://api-b.example/v1',
                    密钥: 'key-b',
                    模型名称: 'gemini-b',
                    extra_headers: { 'X-Provider': 'custom' },
                    metadata: { owner: 'player' },
                },
            ],
            当前api方案: '变量',
        };

        const saved = saveCurrentExtraModelApiProfile(config);

        expect(saved.api方案列表[0]).toEqual({
            名称: '变量',
            backend: 'custom',
            api地址: 'https://edited.example/v1',
            密钥: 'secret-a',
            模型名称: 'model-a',
            extra_headers: { 'X-Provider': 'custom' },
            metadata: { owner: 'player' },
        });
    });

    test('copies unknown active profile fields when saving as a new profile', () => {
        const config = {
            ...base_config,
            api方案列表: [
                {
                    名称: '剧情',
                    api地址: base_config.api地址,
                    密钥: base_config.密钥,
                    模型名称: base_config.模型名称,
                    metadata: { owner: 'player' },
                },
            ],
            当前api方案: '剧情',
        };

        const saved = saveAsNewExtraModelApiProfile(config, '变量');

        expect(saved.api方案列表).toHaveLength(2);
        expect(saved.api方案列表[1]).toMatchObject({
            名称: '变量',
            backend: 'custom',
            metadata: { owner: 'player' },
        });
    });

    test('saves a deep pi connection snapshot without OAuth credentials', () => {
        const config = {
            ...base_config,
            模型来源: '更多' as const,
            pi: structuredClone(base_pi_settings),
        };

        const saved = saveCurrentExtraModelApiProfile(config, 'Pi 方案');
        const profile = saved.api方案列表[0];

        expect(profile).toMatchObject({
            名称: 'Pi 方案',
            backend: 'pi',
            密钥: '',
            pi: {
                provider: 'anthropic',
                api: 'anthropic-messages',
                authType: 'oauth',
                endpoint: 'https://api.anthropic.com',
                useProxy: true,
                model: 'claude-sonnet-4-5',
                contextWindow: 200_000,
                customHeaders: 'X-Test: true',
                customIncludeBody: 'metadata:\n  source: mvu',
                customExcludeBody: '- store',
                futurePiField: { nested: true },
            },
        });
        expect(profile.pi).not.toHaveProperty('credentials');
        expect(profile.pi).not.toHaveProperty('apiKeys');
        expect(saved.密钥).toBe('');

        (config.pi.futurePiField as { nested: boolean }).nested = false;
        expect(profile.pi?.futurePiField).toEqual({ nested: true });
    });

    test('keeps hidden Custom endpoint and model fields outside Pi profile lifecycle', () => {
        const saved = saveCurrentExtraModelApiProfile(
            {
                ...base_config,
                模型来源: '更多' as const,
                api地址: 'https://hidden-custom.example/v1',
                模型名称: 'hidden-custom-model',
                pi: structuredClone(base_pi_settings),
            },
            'Pi 方案'
        );
        const imported_profile = {
            ...saved.api方案列表[0],
            api地址: 'https://legacy-profile-value.example/v1',
            模型名称: 'legacy-profile-model',
        };

        expect(saved.api方案列表[0]).toMatchObject({ api地址: '', 模型名称: '' });

        const selected = selectExtraModelApiProfile(
            {
                ...saved,
                api地址: 'https://current-custom.example/v1',
                模型名称: 'current-custom-model',
                api方案列表: [imported_profile],
                当前api方案: '',
            },
            'Pi 方案'
        );

        expect(selected.api地址).toBe('https://current-custom.example/v1');
        expect(selected.模型名称).toBe('current-custom-model');
        expect(selected.api方案列表[0]).toMatchObject({ api地址: '', 模型名称: '' });
        expect(isActiveExtraModelApiProfileDirty(selected)).toBe(false);

        selected.api地址 = 'https://edited-hidden-custom.example/v1';
        selected.模型名称 = 'edited-hidden-custom-model';
        expect(isActiveExtraModelApiProfileDirty(selected)).toBe(false);

        const cleared = clearUnboundExtraModelApiProfileFields(selected);
        expect(cleared.api地址).toBe('https://edited-hidden-custom.example/v1');
        expect(cleared.模型名称).toBe('edited-hidden-custom-model');
    });

    test('strips injected secret caches from imported Pi profiles while preserving unknown metadata', () => {
        const profiles = upsertExtraModelApiProfile([], {
            名称: 'Imported Pi',
            backend: 'pi',
            api地址: '',
            密钥: 'profile-key',
            模型名称: '',
            customApiKey: 'must-remove-custom-cache',
            pi: {
                ...structuredClone(base_pi_settings),
                credentials: { leaked: { access: 'must-remove' } },
                apiKeys: { 'openai\nhttps://api.openai.com/v1': 'must-remove-key' },
            },
            future_profile: { keep: true },
        });

        expect(profiles[0]).toMatchObject({ future_profile: { keep: true } });
        expect(profiles[0].密钥).toBe('');
        expect(profiles[0]).not.toHaveProperty('customApiKey');
        expect(profiles[0].pi).not.toHaveProperty('credentials');
        expect(profiles[0].pi).not.toHaveProperty('apiKeys');
    });

    test('retains the target key for a complete Pi API-key profile', () => {
        const saved = saveCurrentExtraModelApiProfile(
            {
                ...base_config,
                模型来源: '更多' as const,
                pi: {
                    ...structuredClone(base_pi_settings),
                    authType: 'api_key' as const,
                },
            },
            'Pi API Key'
        );

        expect(saved.密钥).toBe('secret-a');
        expect(saved.api方案列表[0]).toMatchObject({
            backend: 'pi',
            密钥: 'secret-a',
            pi: { authType: 'api_key' },
        });
    });

    test.each([
        ['unknown provider', 'future-provider', 'openai-responses', ''],
        ['unsupported API', 'openai', 'anthropic-messages', ''],
        ['invalid endpoint', 'openai', 'openai-responses', 'not a URL'],
        ['forbidden custom endpoint', 'google', 'google-generative-ai', 'https://proxy.example/v1'],
    ])(
        'does not persist or install a Pi key for an %s target',
        (_label, provider, api, endpoint) => {
            const profile = upsertExtraModelApiProfile([], {
                名称: 'Imported Pi',
                backend: 'pi',
                api地址: 'https://legacy-custom.example/v1',
                密钥: 'must-not-install',
                模型名称: 'legacy-custom-model',
                pi: {
                    provider,
                    api,
                    authType: 'api_key',
                    endpoint,
                    useProxy: false,
                    model: 'model-a',
                    contextWindow: 128_000,
                    customHeaders: '',
                    customIncludeBody: '',
                    customExcludeBody: '',
                },
            })[0];

            expect(profile).toMatchObject({ api地址: '', 密钥: '', 模型名称: '' });

            const selected = applyExtraModelApiProfile(
                {
                    ...base_config,
                    pi: structuredClone(base_pi_settings),
                },
                profile
            );
            expect(selected.密钥).toBe('');
        }
    );

    test('normalizes a numeric profile contextWindow string before save and apply', () => {
        const saved = saveCurrentExtraModelApiProfile(
            {
                ...base_config,
                模型来源: '更多' as const,
                pi: {
                    ...structuredClone(base_pi_settings),
                    provider: ' anthropic ',
                    api: ' anthropic-messages ',
                    authType: ' oauth ',
                    endpoint: ' https://api.anthropic.com ',
                    model: ' claude-sonnet-4-5 ',
                    contextWindow: ' 200000 ',
                },
            },
            'Pi 数字字符串'
        );

        expect(saved.api方案列表[0].pi?.contextWindow).toBe(200_000);
        expect(saved.pi).toMatchObject({
            provider: 'anthropic',
            api: 'anthropic-messages',
            authType: 'oauth',
            endpoint: 'https://api.anthropic.com',
            model: 'claude-sonnet-4-5',
            contextWindow: 200_000,
            credentials: base_pi_settings.credentials,
            apiKeys: base_pi_settings.apiKeys,
        });
        expect(typeof saved.pi?.contextWindow).toBe('number');
        const selected = selectExtraModelApiProfile(
            {
                ...base_config,
                pi: structuredClone(base_pi_settings),
                api方案列表: saved.api方案列表,
                当前api方案: '',
            },
            'Pi 数字字符串'
        );
        expect(selected.pi?.contextWindow).toBe(200_000);
        expect(typeof selected.pi?.contextWindow).toBe('number');
    });

    test('fails closed before an invalid profile contextWindow string reaches runtime settings', () => {
        const profile = upsertExtraModelApiProfile([], {
            名称: 'Invalid Context',
            backend: 'pi',
            api地址: '',
            密钥: 'must-not-install',
            模型名称: '',
            pi: {
                ...structuredClone(base_pi_settings),
                authType: 'api_key',
                contextWindow: 'not-a-number',
            },
        })[0];

        expect(profile.密钥).toBe('');
        const selected = applyExtraModelApiProfile(
            {
                ...base_config,
                pi: structuredClone(base_pi_settings),
            },
            profile
        );
        expect(selected.pi).toMatchObject({ provider: '', api: '', contextWindow: 0 });
        expect(typeof selected.pi?.contextWindow).toBe('number');
    });

    test('supports reactive Pi settings and profile entries from Pinia', () => {
        const config = reactive({
            ...base_config,
            模型来源: '更多' as const,
            pi: structuredClone(base_pi_settings),
        });

        const saved = saveCurrentExtraModelApiProfile(config, 'Reactive Pi');
        expect(saved.api方案列表[0]).toMatchObject({
            名称: 'Reactive Pi',
            backend: 'pi',
            pi: {
                provider: 'anthropic',
                model: 'claude-sonnet-4-5',
            },
        });
        expect(saved.api方案列表[0].pi).not.toHaveProperty('credentials');
        expect(saved.api方案列表[0].pi).not.toHaveProperty('apiKeys');

        const selected = selectExtraModelApiProfile(
            reactive({
                ...base_config,
                pi: structuredClone(base_pi_settings),
                api方案列表: saved.api方案列表,
                当前api方案: '',
            }),
            'Reactive Pi'
        );
        expect(selected.模型来源).toBe('更多');
        expect(selected.pi?.credentials).toEqual(base_pi_settings.credentials);
    });

    test('applies pi profiles, preserves provider credentials, and does not share nested state', () => {
        const profile = saveCurrentExtraModelApiProfile(
            {
                ...base_config,
                模型来源: '更多' as const,
                pi: structuredClone(base_pi_settings),
            },
            'Pi 方案'
        ).api方案列表[0];
        const credentials = {
            anthropic: { type: 'oauth', access: 'new-access', refresh: 'new-refresh', expires: 42 },
        };
        const selected = applyExtraModelApiProfile(
            {
                ...base_config,
                pi: {
                    ...structuredClone(base_pi_settings),
                    provider: 'openai',
                    credentials,
                },
            },
            profile
        );

        expect(selected.模型来源).toBe('更多');
        expect(selected.pi).toMatchObject({
            provider: 'anthropic',
            api: 'anthropic-messages',
            useProxy: true,
            model: 'claude-sonnet-4-5',
            credentials,
            apiKeys: base_pi_settings.apiKeys,
            futurePiField: { nested: true },
        });
        expect(selected.pi?.credentials).not.toBe(credentials);
        expect(selected.pi?.apiKeys).not.toBe(base_pi_settings.apiKeys);

        (profile.pi!.futurePiField as { nested: boolean }).nested = false;
        expect(selected.pi?.futurePiField).toEqual({ nested: true });
    });

    test('ignores credential refreshes for dirty checks but detects pi connection changes', () => {
        const saved = saveCurrentExtraModelApiProfile(
            {
                ...base_config,
                模型来源: '更多' as const,
                pi: structuredClone(base_pi_settings),
            },
            'Pi 方案'
        );

        expect(isActiveExtraModelApiProfileDirty(saved)).toBe(false);
        saved.pi!.credentials.anthropic = { type: 'oauth', access: 'refreshed' };
        expect(isActiveExtraModelApiProfileDirty(saved)).toBe(false);
        saved.pi!.apiKeys!['anthropic\nhttps://proxy.example'] = 'rotated';
        expect(isActiveExtraModelApiProfileDirty(saved)).toBe(false);
        saved.pi!.useProxy = false;
        expect(isActiveExtraModelApiProfileDirty(saved)).toBe(true);
        saved.pi!.useProxy = true;
        expect(isActiveExtraModelApiProfileDirty(saved)).toBe(false);
        saved.pi!.model = 'claude-opus-4-1';
        expect(isActiveExtraModelApiProfileDirty(saved)).toBe(true);
    });

    test('migrates profiles without a backend as custom and strips misplaced credentials', () => {
        const migrated = migrateExtraModelApiProfiles({
            ...base_config,
            模型来源: '更多' as const,
            pi: structuredClone(base_pi_settings),
            api方案列表: [
                {
                    名称: '旧方案',
                    api地址: 'https://legacy.example/v1',
                    密钥: 'legacy-key',
                    模型名称: 'legacy-model',
                    pi: structuredClone(base_pi_settings),
                    future_profile: { keep: true },
                },
            ],
            当前api方案: '旧方案',
        });

        expect(migrated.api方案列表[0]).toMatchObject({
            backend: 'custom',
            future_profile: { keep: true },
        });
        expect(migrated.api方案列表[0]).not.toHaveProperty('pi');

        const selected = selectExtraModelApiProfile(migrated, '旧方案');
        expect(selected.模型来源).toBe('自定义');
        expect(selected.pi?.credentials).toEqual(base_pi_settings.credentials);
    });

    test('clears a stale OAuth root key without an active profile while preserving credential caches', () => {
        const migrated = migrateExtraModelApiProfiles({
            ...base_config,
            模型来源: '更多' as const,
            api地址: '',
            密钥: 'stale-oauth-root-key',
            customApiKey: 'custom-key',
            模型名称: '',
            pi: structuredClone(base_pi_settings),
            api方案列表: [],
            当前api方案: '',
        });

        expect(migrated.密钥).toBe('');
        expect(migrated.customApiKey).toBe('custom-key');
        expect(migrated.pi.credentials).toEqual(base_pi_settings.credentials);
        expect(migrated.pi.apiKeys).toEqual(base_pi_settings.apiKeys);
        expect(migrated.api方案列表).toEqual([]);
        expect(migrated.当前api方案).toBe('');
    });

    test('disables a missing pi profile snapshot instead of mixing its key with stale settings', () => {
        const migrated = migrateExtraModelApiProfiles({
            ...base_config,
            模型来源: '更多' as const,
            pi: structuredClone(base_pi_settings),
            api方案列表: [
                {
                    名称: 'Pi 早期方案',
                    backend: 'pi',
                    api地址: '',
                    密钥: 'pi-key',
                    模型名称: '',
                },
            ] as ExtraModelApiProfile[],
            当前api方案: 'Pi 早期方案',
        });

        expect(migrated.api方案列表[0]).toMatchObject({
            backend: 'pi',
            密钥: '',
        });
        expect(migrated.api方案列表[0].pi).toBeUndefined();
        expect(migrated.模型来源).toBe('更多');
        expect(migrated.密钥).toBe('');
        expect(migrated.pi).toMatchObject({
            provider: '',
            api: '',
            model: '',
            credentials: base_pi_settings.credentials,
            apiKeys: base_pi_settings.apiKeys,
        });
    });

    test('fails closed when selecting a malformed pi profile', () => {
        const selected = selectExtraModelApiProfile(
            {
                ...base_config,
                pi: structuredClone(base_pi_settings),
                api方案列表: [
                    {
                        名称: 'Malformed Pi',
                        backend: 'pi',
                        api地址: '',
                        密钥: 'must-not-be-sent',
                        模型名称: '',
                    },
                ],
                当前api方案: '',
            },
            'Malformed Pi'
        );

        expect(selected.当前api方案).toBe('Malformed Pi');
        expect(selected.模型来源).toBe('更多');
        expect(selected.密钥).toBe('');
        expect(selected.pi).toMatchObject({
            provider: '',
            api: '',
            model: '',
            credentials: base_pi_settings.credentials,
            apiKeys: base_pi_settings.apiKeys,
        });
        expect(selected.pi?.credentials).not.toBe(base_pi_settings.credentials);
    });

    test('refuses to save a Pi profile without a complete connection snapshot', () => {
        expect(() =>
            saveCurrentExtraModelApiProfile(
                {
                    ...base_config,
                    模型来源: '更多',
                },
                'Broken Pi'
            )
        ).toThrow('“更多”API 方案缺少完整的连接配置，无法保存。');
    });

    test('refuses to save structurally present Pi settings with empty required fields', () => {
        expect(() =>
            saveCurrentExtraModelApiProfile(
                {
                    ...base_config,
                    模型来源: '更多',
                    pi: {
                        ...structuredClone(base_pi_settings),
                        provider: '',
                        api: '',
                        model: '',
                    },
                },
                'Unconfigured Pi'
            )
        ).toThrow('“更多”API 方案缺少完整的连接配置，无法保存。');
    });

    test('does not synthesize a Pi profile from unrelated legacy root fields', () => {
        const migrated = migrateExtraModelApiProfiles({
            ...base_config,
            模型来源: '更多' as const,
            密钥: 'unbound-key',
            pi: {
                ...structuredClone(base_pi_settings),
                model: '',
            },
        });

        expect(migrated.api方案列表).toEqual([]);
        expect(migrated.当前api方案).toBe('');
        expect(migrated.pi?.model).toBe('');
    });

    test('removes a saved profile', () => {
        const profiles = removeExtraModelApiProfile(
            [
                {
                    名称: '剧情',
                    api地址: 'https://api-a.example/v1',
                    密钥: 'key-a',
                    模型名称: 'gemini-a',
                },
                {
                    名称: '变量',
                    api地址: 'https://api-b.example/v1',
                    密钥: 'key-b',
                    模型名称: 'gemini-b',
                },
            ],
            '剧情'
        );

        expect(profiles).toHaveLength(1);
        expect(profiles[0].名称).toBe('变量');
    });

    test('trims profile names consistently and keeps the first imported duplicate', () => {
        const migrated = migrateExtraModelApiProfiles({
            ...base_config,
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
                {
                    名称: '方案 B',
                    api地址: 'https://second.example/v1',
                    密钥: 'second-key',
                    模型名称: 'second-model',
                },
            ],
            当前api方案: ' 方案 A ',
        });

        expect(migrated.当前api方案).toBe('方案 A');
        expect(migrated.api方案列表.map(profile => profile.名称)).toEqual(['方案 A', '方案 B']);
        expect(migrated.api方案列表[0].api地址).toBe('https://first.example/v1');
        expect(isActiveExtraModelApiProfileDirty(migrated)).toBe(false);

        const saved = saveCurrentExtraModelApiProfile(migrated, ' 方案 A ');
        expect(saved.当前api方案).toBe('方案 A');
        expect(saved.api方案列表.map(profile => profile.名称)).toEqual(['方案 A', '方案 B']);

        const deleted = deleteActiveExtraModelApiProfile(saved, ' 方案 A ');
        expect(deleted.api方案列表.map(profile => profile.名称)).toEqual(['方案 B']);
        expect(deleted.当前api方案).toBe('方案 B');
    });

    test('rejects duplicate names when saving as a new profile', () => {
        const config = {
            ...base_config,
            api方案列表: [
                {
                    名称: '变量',
                    api地址: 'https://api-b.example/v1',
                    密钥: 'key-b',
                    模型名称: 'gemini-b',
                },
            ],
            当前api方案: '变量',
        };

        expect(() => saveAsNewExtraModelApiProfile(config, '变量')).toThrow(
            'API 方案「变量」已存在'
        );
    });

    test('switches to the first remaining profile after deleting the active one', () => {
        const config = {
            ...base_config,
            api地址: 'https://api-a.example/v1',
            密钥: 'key-a',
            模型名称: 'gemini-a',
            api方案列表: [
                {
                    名称: '剧情',
                    api地址: 'https://api-a.example/v1',
                    密钥: 'key-a',
                    模型名称: 'gemini-a',
                },
                {
                    名称: '变量',
                    api地址: 'https://api-b.example/v1',
                    密钥: 'key-b',
                    模型名称: 'gemini-b',
                },
            ],
            当前api方案: '剧情',
        };

        const next_config = deleteActiveExtraModelApiProfile(config, '剧情');

        expect(next_config.api方案列表).toHaveLength(1);
        expect(next_config.当前api方案).toBe('变量');
        expect(next_config.api地址).toBe('https://api-b.example/v1');
        expect(next_config.密钥).toBe('key-b');
        expect(next_config.模型名称).toBe('gemini-b');
    });

    test('does not delete or switch when the requested profile is not active', async () => {
        const config = {
            ...base_config,
            api地址: 'https://api-a.example/v1',
            密钥: 'key-a',
            模型名称: 'gemini-a',
            api方案列表: [
                {
                    名称: '剧情',
                    api地址: 'https://api-a.example/v1',
                    密钥: 'key-a',
                    模型名称: 'gemini-a',
                },
                {
                    名称: '变量',
                    api地址: 'https://api-b.example/v1',
                    密钥: 'key-b',
                    模型名称: 'gemini-b',
                },
            ],
            当前api方案: '剧情',
        };
        const confirm = jest.fn().mockResolvedValue(true);

        expect(deleteActiveExtraModelApiProfile(config, '变量')).toBe(config);
        expect(deleteActiveExtraModelApiProfile(config, '不存在')).toBe(config);
        await expect(
            deleteActiveExtraModelApiProfileWithConfirmation(config, '变量', confirm)
        ).resolves.toBe(config);
        expect(confirm).not.toHaveBeenCalled();
    });

    test('switches from a deleted pi profile to the remaining custom backend', () => {
        const pi_profile = saveCurrentExtraModelApiProfile(
            {
                ...base_config,
                模型来源: '更多' as const,
                pi: structuredClone(base_pi_settings),
            },
            'Pi 方案'
        ).api方案列表[0];
        const config = {
            ...base_config,
            模型来源: '更多' as const,
            pi: structuredClone(base_pi_settings),
            api方案列表: [
                pi_profile,
                {
                    名称: '自定义方案',
                    backend: 'custom' as const,
                    api地址: 'https://custom.example/v1',
                    密钥: 'custom-key',
                    模型名称: 'custom-model',
                },
            ],
            当前api方案: 'Pi 方案',
        };

        const next_config = deleteActiveExtraModelApiProfile(config, 'Pi 方案');

        expect(next_config.模型来源).toBe('自定义');
        expect(next_config.当前api方案).toBe('自定义方案');
        expect(next_config.api地址).toBe('https://custom.example/v1');
        expect(next_config.pi?.credentials).toEqual(base_pi_settings.credentials);
    });

    test('switches from a deleted custom profile to the remaining pi backend', () => {
        const pi_profile = saveCurrentExtraModelApiProfile(
            {
                ...base_config,
                模型来源: '更多' as const,
                pi: structuredClone(base_pi_settings),
            },
            'Pi 方案'
        ).api方案列表[0];
        const config = {
            ...base_config,
            模型来源: '自定义' as const,
            pi: structuredClone(base_pi_settings),
            api方案列表: [
                {
                    名称: '自定义方案',
                    backend: 'custom' as const,
                    api地址: 'https://custom.example/v1',
                    密钥: 'custom-key',
                    模型名称: 'custom-model',
                },
                pi_profile,
            ],
            当前api方案: '自定义方案',
        };

        const next_config = deleteActiveExtraModelApiProfile(config, '自定义方案');

        expect(next_config.模型来源).toBe('更多');
        expect(next_config.当前api方案).toBe('Pi 方案');
        expect(next_config.密钥).toBe('');
        expect(next_config.pi).toMatchObject({
            provider: base_pi_settings.provider,
            api: base_pi_settings.api,
            authType: base_pi_settings.authType,
            endpoint: base_pi_settings.endpoint,
            model: base_pi_settings.model,
            contextWindow: base_pi_settings.contextWindow,
            credentials: base_pi_settings.credentials,
            apiKeys: base_pi_settings.apiKeys,
        });
        expect(next_config.pi?.credentials).not.toBe(config.pi.credentials);
        expect(next_config.pi?.apiKeys).not.toBe(config.pi.apiKeys);
    });

    test('asks to discard dirty edits before asking to delete a profile', async () => {
        const config = {
            ...base_config,
            api地址: 'https://edited.example/v1',
            api方案列表: [
                {
                    名称: '剧情',
                    api地址: 'https://api-a.example/v1',
                    密钥: 'secret-a',
                    模型名称: 'model-a',
                },
                {
                    名称: '变量',
                    api地址: 'https://api-b.example/v1',
                    密钥: 'key-b',
                    模型名称: 'model-b',
                },
            ],
            当前api方案: '剧情',
        };
        const confirmations: string[] = [];

        const next_config = await deleteActiveExtraModelApiProfileWithConfirmation(
            config,
            '剧情',
            async confirmation => {
                confirmations.push(confirmation);
                return true;
            }
        );

        expect(confirmations).toEqual(['discard_unsaved_changes', 'delete_profile']);
        expect(next_config?.api方案列表.map(profile => profile.名称)).toEqual(['变量']);
        expect(next_config?.当前api方案).toBe('变量');
    });

    test('stops deletion when discarding dirty edits is cancelled', async () => {
        const config = {
            ...base_config,
            api地址: 'https://edited.example/v1',
            api方案列表: [
                {
                    名称: '剧情',
                    api地址: 'https://api-a.example/v1',
                    密钥: 'secret-a',
                    模型名称: 'model-a',
                },
                {
                    名称: '变量',
                    api地址: 'https://api-b.example/v1',
                    密钥: 'key-b',
                    模型名称: 'model-b',
                },
            ],
            当前api方案: '剧情',
        };
        const original_config = structuredClone(config);
        const confirm = jest.fn().mockResolvedValue(false);

        const next_config = await deleteActiveExtraModelApiProfileWithConfirmation(
            config,
            '剧情',
            confirm
        );

        expect(next_config).toBeNull();
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(confirm).toHaveBeenCalledWith('discard_unsaved_changes');
        expect(config).toEqual(original_config);
    });

    test('stops deletion when the final delete confirmation is cancelled', async () => {
        const config = {
            ...base_config,
            api地址: 'https://edited.example/v1',
            api方案列表: [
                {
                    名称: '剧情',
                    api地址: 'https://api-a.example/v1',
                    密钥: 'secret-a',
                    模型名称: 'model-a',
                },
                {
                    名称: '变量',
                    api地址: 'https://api-b.example/v1',
                    密钥: 'key-b',
                    模型名称: 'model-b',
                },
            ],
            当前api方案: '剧情',
        };
        const original_config = structuredClone(config);
        const confirmations: string[] = [];

        const next_config = await deleteActiveExtraModelApiProfileWithConfirmation(
            config,
            '剧情',
            async confirmation => {
                confirmations.push(confirmation);
                return confirmation === 'discard_unsaved_changes';
            }
        );

        expect(next_config).toBeNull();
        expect(confirmations).toEqual(['discard_unsaved_changes', 'delete_profile']);
        expect(config).toEqual(original_config);
    });

    test('skips the discard confirmation when the active profile is clean', async () => {
        const config = {
            ...base_config,
            api方案列表: [
                {
                    名称: '剧情',
                    api地址: base_config.api地址,
                    密钥: base_config.密钥,
                    模型名称: base_config.模型名称,
                },
                {
                    名称: '变量',
                    api地址: 'https://api-b.example/v1',
                    密钥: 'key-b',
                    模型名称: 'model-b',
                },
            ],
            当前api方案: '剧情',
        };
        const confirmations: string[] = [];

        const next_config = await deleteActiveExtraModelApiProfileWithConfirmation(
            config,
            '剧情',
            async confirmation => {
                confirmations.push(confirmation);
                return true;
            }
        );

        expect(confirmations).toEqual(['delete_profile']);
        expect(next_config?.api方案列表.map(profile => profile.名称)).toEqual(['变量']);
    });

    test('detects dirty active profile fields', () => {
        const config = {
            ...base_config,
            api地址: 'https://edited.example/v1',
            密钥: 'key-a',
            模型名称: 'gemini-a',
            api方案列表: [
                {
                    名称: '剧情',
                    api地址: 'https://api-a.example/v1',
                    密钥: 'key-a',
                    模型名称: 'gemini-a',
                },
            ],
            当前api方案: '剧情',
        };

        expect(isActiveExtraModelApiProfileDirty(config)).toBe(true);
    });

    test('clears active api fields when entering unbound mode', () => {
        const cleared = clearUnboundExtraModelApiProfileFields({
            ...base_config,
            api地址: 'https://api-a.example/v1',
            密钥: 'key-a',
            模型名称: 'gemini-a',
            当前api方案: '剧情',
        });

        expect(cleared.当前api方案).toBe('');
        expect(cleared.api地址).toBe('');
        expect(cleared.密钥).toBe('');
        expect(cleared.模型名称).toBe('');
    });

    test('clears pi connection fields in unbound mode without clearing credentials or unknown data', () => {
        const config = {
            ...base_config,
            模型来源: '更多' as const,
            pi: structuredClone(base_pi_settings),
            当前api方案: 'Pi 方案',
        };

        const cleared = clearUnboundExtraModelApiProfileFields(config);

        expect(cleared.pi).toMatchObject({
            provider: '',
            api: '',
            authType: 'api_key',
            endpoint: '',
            useProxy: false,
            model: '',
            contextWindow: 0,
            credentials: base_pi_settings.credentials,
            apiKeys: base_pi_settings.apiKeys,
            customHeaders: '',
            customIncludeBody: '',
            customExcludeBody: '',
            futurePiField: { nested: true },
        });
        expect(cleared.pi?.credentials).not.toBe(config.pi.credentials);
        expect(cleared.pi?.apiKeys).not.toBe(config.pi.apiKeys);
    });

    test('reconciles invalid active profile names on load', () => {
        const reconciled = reconcileExtraModelApiProfileSelection({
            ...base_config,
            api地址: 'https://stale.example/v1',
            密钥: 'stale-key',
            模型名称: 'stale-model',
            api方案列表: [
                {
                    名称: '变量',
                    api地址: 'https://api-b.example/v1',
                    密钥: 'key-b',
                    模型名称: 'gemini-b',
                },
            ],
            当前api方案: '已失效',
        });

        expect(reconciled.当前api方案).toBe('变量');
        expect(reconciled.api地址).toBe('https://api-b.example/v1');
    });

    test('rejects saving current profile under an existing name while unbound', () => {
        const config = {
            ...base_config,
            api地址: 'https://manual.example/v1',
            密钥: 'manual-key',
            模型名称: 'manual-model',
            api方案列表: [
                {
                    名称: '变量',
                    api地址: 'https://api-b.example/v1',
                    密钥: 'key-b',
                    模型名称: 'gemini-b',
                },
            ],
            当前api方案: '',
        };

        expect(() => saveCurrentExtraModelApiProfile(config, '变量')).toThrow(
            'API 方案「变量」已存在'
        );
    });

    test('migrates legacy settings and reconciles invalid active profile names', () => {
        const migrated = migrateExtraModelApiProfiles({
            ...base_config,
            api地址: 'https://legacy.example/v1',
            密钥: 'legacy-key',
            模型名称: 'legacy-model',
            当前api方案: '不存在',
        });

        expect(migrated.当前api方案).toBe(DEFAULT_EXTRA_MODEL_API_PROFILE_NAME);
        expect(migrated.api地址).toBe('https://legacy.example/v1');
    });

    test('loads api profile settings from mvu_settings', () => {
        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                额外模型解析配置: {
                    模型来源: '自定义',
                    api地址: 'https://legacy.example/v1',
                    密钥: 'legacy-key',
                    模型名称: 'legacy-model',
                },
            },
        };

        const store = useDataStore();

        expect(store.settings.额外模型解析配置.api方案列表).toEqual([
            {
                名称: DEFAULT_EXTRA_MODEL_API_PROFILE_NAME,
                backend: 'custom',
                api地址: 'https://legacy.example/v1',
                密钥: 'legacy-key',
                模型名称: 'legacy-model',
            },
        ]);
        expect(store.settings.额外模型解析配置.当前api方案).toBe(
            DEFAULT_EXTRA_MODEL_API_PROFILE_NAME
        );
    });
});
