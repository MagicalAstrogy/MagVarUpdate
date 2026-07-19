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
} from '@/function/update/extra_model_api_profiles';
import { useDataStore } from '@/store';

const base_config = {
    api地址: 'http://localhost:1234/v1',
    密钥: 'secret-a',
    模型名称: 'model-a',
    api方案列表: [] as Array<{
        名称: string;
        api地址: string;
        密钥: string;
        模型名称: string;
    }>,
    当前api方案: '',
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
            metadata: { owner: 'player' },
        });
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
