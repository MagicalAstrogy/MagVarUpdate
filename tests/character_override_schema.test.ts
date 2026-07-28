import {
    CharacterSettingsOverrideSchema,
    getCharacterSettingsOverrideJsonSchema,
    hasActiveCharacterSettingsOverride,
    parseCharacterSettingsOverrideContent,
    recoverCharacterSettingsOverridePassthrough,
    serializeCharacterSettingsOverride,
} from '@/function/character_override/schema';
import { useDataStore } from '@/store';
import { nextTick } from 'vue';

describe('CharacterSettingsOverride schema', () => {
    test('accepts and preserves passthrough fields at every supported object level', () => {
        const parsed = CharacterSettingsOverrideSchema.parse({
            更新方式: '额外模型解析',
            custom_top_level: { version: 1 },
            额外模型解析配置: {
                启用自动请求: false,
                custom_extra_model: 'kept',
            },
            兼容性: {
                更新到聊天变量: true,
                custom_compatibility: 42,
            },
        });

        expect(parsed).toMatchObject({
            custom_top_level: { version: 1 },
            额外模型解析配置: {
                custom_extra_model: 'kept',
            },
            兼容性: {
                custom_compatibility: 42,
            },
        });
    });

    test('loads a valid document without requiring the embedded schema', () => {
        expect(
            parseCharacterSettingsOverrideContent(
                JSON.stringify({
                    更新方式: '额外模型解析',
                    兼容性: { sendas不视为user消息: true },
                })
            )
        ).toEqual({
            更新方式: '额外模型解析',
            兼容性: { sendas不视为user消息: true },
        });
    });

    test('rejects invalid JSON and invalid known fields', () => {
        expect(() => parseCharacterSettingsOverrideContent('{')).toThrow();
        expect(() =>
            parseCharacterSettingsOverrideContent(JSON.stringify({ 更新方式: 'invalid' }))
        ).toThrow();
    });

    test('recovers only passthrough fields from a document with invalid known fields', () => {
        expect(
            recoverCharacterSettingsOverridePassthrough(
                JSON.stringify({
                    更新方式: 'invalid',
                    custom_top_level: { kept: true },
                    额外模型解析配置: {
                        启用自动请求: 'invalid',
                        custom_extra_model: 'kept',
                    },
                    兼容性: {
                        更新到聊天变量: 'invalid',
                        custom_compatibility: 42,
                    },
                    schema: { stale: true },
                })
            )
        ).toEqual({
            custom_top_level: { kept: true },
            额外模型解析配置: { custom_extra_model: 'kept' },
            兼容性: { custom_compatibility: 42 },
        });
    });

    test('serializes schema last and removes empty known regex values', () => {
        const serialized = serializeCharacterSettingsOverride({
            passthrough: true,
            额外模型解析配置: {
                世界书条目白名单正则: '  ',
                custom: 'kept',
            },
        });
        const document = JSON.parse(serialized);

        expect(Object.keys(document).at(-1)).toBe('schema');
        expect(document.额外模型解析配置).toEqual({ custom: 'kept' });
        expect(document.schema.title).toBe('CharacterSettingsOverride');
    });

    test('replaces any passthrough schema value and still serializes schema last', () => {
        const document = JSON.parse(
            serializeCharacterSettingsOverride({
                更新方式: '随AI输出',
                schema: { stale: true },
            })
        );

        expect(document.schema).not.toHaveProperty('stale');
        expect(document.schema.title).toBe('CharacterSettingsOverride');
        expect(Object.keys(document).at(-1)).toBe('schema');
    });

    test('generates loose JSON Schema objects from the runtime schema', () => {
        const schema = getCharacterSettingsOverrideJsonSchema();

        expect(schema).toMatchObject({
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            title: 'CharacterSettingsOverride',
            type: 'object',
            additionalProperties: true,
        });
        expect(_.get(schema, 'properties.额外模型解析配置.additionalProperties')).toBe(true);
        expect(_.get(schema, 'properties.兼容性.additionalProperties')).toBe(true);
    });

    test('only valid non-empty character regex rules mark an otherwise empty config active', () => {
        expect(hasActiveCharacterSettingsOverride({})).toBe(false);
        expect(
            hasActiveCharacterSettingsOverride({
                额外模型解析配置: { 世界书条目白名单正则: '[' },
            })
        ).toBe(false);
        expect(
            hasActiveCharacterSettingsOverride({
                额外模型解析配置: { 世界书条目白名单正则: '角色|地点' },
            })
        ).toBe(true);
        expect(hasActiveCharacterSettingsOverride({ 更新方式: '随AI输出' })).toBe(true);
    });
});

describe('global settings migration and effective settings', () => {
    beforeEach(() => {
        (SillyTavern as any).extensionSettings = {};
    });

    test('migrates the historical sandas key to canonical sendas', () => {
        (SillyTavern as any).extensionSettings = {
            mvu_settings: {
                兼容性: {
                    sandas不视为user消息: true,
                    unknown: 'kept',
                },
            },
        };
        const store = useDataStore();

        expect(store.settings.兼容性.sendas不视为user消息).toBe(true);
        expect(store.settings.兼容性).not.toHaveProperty('sandas不视为user消息');
        expect(store.settings.兼容性).toHaveProperty('unknown', 'kept');
    });

    test('prefers the canonical sendas key when both spellings exist', () => {
        (SillyTavern as any).extensionSettings = {
            mvu_settings: {
                兼容性: {
                    sendas不视为user消息: false,
                    sandas不视为user消息: true,
                },
            },
        };
        const store = useDataStore();

        expect(store.settings.兼容性.sendas不视为user消息).toBe(false);
        expect(store.settings.兼容性).not.toHaveProperty('sandas不视为user消息');
    });

    test('persists only the canonical sendas key after the next settings change', async () => {
        (SillyTavern as any).extensionSettings = {
            mvu_settings: {
                兼容性: {
                    sandas不视为user消息: true,
                },
            },
        };
        const store = useDataStore();

        store.settings.通知.MVU框架加载成功 = false;
        await nextTick();

        expect(SillyTavern.extensionSettings.mvu_settings.兼容性).toMatchObject({
            sendas不视为user消息: true,
        });
        expect(SillyTavern.extensionSettings.mvu_settings.兼容性).not.toHaveProperty(
            'sandas不视为user消息'
        );
    });

    test('merges only supported ordinary character fields into effective settings', () => {
        const store = useDataStore();
        store.settings.更新方式 = '随AI输出';
        store.settings.额外模型解析配置.启用自动请求 = true;
        store.settings.兼容性.更新到聊天变量 = false;
        store.settings.兼容性.sendas不视为user消息 = false;
        store.character_settings.draft = {
            更新方式: '额外模型解析',
            额外模型解析配置: {
                启用自动请求: false,
                世界书条目白名单正则: 'character-only',
            },
            兼容性: {
                更新到聊天变量: true,
                sendas不视为user消息: true,
            },
            unsupported: 'ignored at runtime',
        };

        expect(store.effective_settings.更新方式).toBe('额外模型解析');
        expect(store.effective_settings.额外模型解析配置.启用自动请求).toBe(false);
        expect(store.effective_settings.兼容性.更新到聊天变量).toBe(true);
        expect(store.effective_settings.兼容性.sendas不视为user消息).toBe(true);
        expect(store.effective_settings.额外模型解析配置.世界书条目白名单正则).toBe('');
        expect(store.effective_settings).not.toHaveProperty('unsupported');
    });

    test('presence, rather than value difference, controls override badges', () => {
        const store = useDataStore();
        store.settings.更新方式 = '随AI输出';
        store.character_settings.draft = { 更新方式: '随AI输出' };

        expect(store.has_character_settings_override('更新方式')).toBe(true);
        expect(store.is_character_settings_override_active).toBe(true);
    });
});
