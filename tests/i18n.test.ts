import { serializeCharacterSettingsOverride } from '@/function/character_override/schema';
import { i18n, resolveMvuLocale, tr } from '@/i18n';
import type { MessageKey } from '@/i18n';
import { commonMessages } from '@/i18n/messages/common';
import { panelMessages } from '@/i18n/messages/panel';
import { runtimeMessages } from '@/i18n/messages/runtime';
import { APP_LOCALES } from '@/i18n/messages/types';
import type { MessageModule } from '@/i18n/messages/types';

const message_modules = {
    common: commonMessages,
    panel: panelMessages,
    runtime: runtimeMessages,
} satisfies Record<string, MessageModule>;

function extractPlaceholders(message: string): string[] {
    return Array.from(message.matchAll(/\{([\w.-]+)\}/g), match => match[1]).sort();
}

describe('MVU localization', () => {
    const locale_ref = i18n.global.locale;
    const initial_locale = locale_ref.value;

    afterEach(() => {
        locale_ref.value = initial_locale;
    });

    test('initializes from the SillyTavern current-locale API', () => {
        expect(SillyTavern.getCurrentLocale).toHaveBeenCalled();
        expect(SillyTavern.getCurrentLocale()).toBe('zh-CN');
        expect(locale_ref.value).toBe('zh-CN');
    });

    test.each([
        ['zh-CN', 'zh-CN'],
        ['zh-TW', 'zh-CN'],
        ['en-US', 'en'],
        ['fr-FR', 'en'],
    ] as const)('maps host locale %s to %s', (host_locale, expected_locale) => {
        expect(resolveMvuLocale(host_locale)).toBe(expected_locale);
    });

    test('tr follows the active locale and forwards named interpolation parameters', () => {
        locale_ref.value = 'zh-CN';
        expect(tr('common.enabled')).toBe('启用');

        locale_ref.value = 'en';
        expect(tr('common.enabled')).toBe('Enabled');

        const original_zh_messages = structuredClone(i18n.global.getLocaleMessage('zh-CN'));
        const original_en_messages = structuredClone(i18n.global.getLocaleMessage('en'));

        try {
            i18n.global.mergeLocaleMessage('zh-CN', {
                common: { enabled: '启用 {feature}' },
            });
            i18n.global.mergeLocaleMessage('en', {
                common: { enabled: 'Enable {feature}' },
            });

            locale_ref.value = 'zh-CN';
            expect(tr('common.enabled', { feature: 'MVU' })).toBe('启用 MVU');

            locale_ref.value = 'en';
            expect(tr('common.enabled', { feature: 'MVU' })).toBe('Enable MVU');
        } finally {
            i18n.global.setLocaleMessage('zh-CN', original_zh_messages);
            i18n.global.setLocaleMessage('en', original_en_messages);
        }
    });

    test('formats character-card override badges with the effective state', () => {
        locale_ref.value = 'zh-CN';
        expect(tr('panel.badge.overrideWithValue', { value: tr('common.enabled') })).toBe(
            '角色卡覆盖：启用'
        );

        locale_ref.value = 'en';
        expect(tr('panel.badge.overrideWithValue', { value: tr('common.enabled') })).toBe(
            'Character-card override: Enabled'
        );
    });

    test('keeps the Pi API field label separate from its nested option translations', () => {
        locale_ref.value = 'zh-CN';
        expect(tr('panel.source.pi.apiLabel')).toBe('API 接口');
        expect(tr('panel.source.pi.api.anthropicMessages')).toBe('Anthropic Messages');

        locale_ref.value = 'en';
        expect(tr('panel.source.pi.apiLabel')).toBe('API protocol');
        expect(tr('panel.source.pi.api.openaiResponses')).toBe('OpenAI Responses');
    });

    test('every resource key has non-empty translations with matching placeholders', () => {
        const seen_keys = new Set<string>();
        let message_count = 0;

        for (const [module_name, messages] of Object.entries(message_modules)) {
            for (const [key, translations] of Object.entries(messages)) {
                message_count += 1;
                expect(seen_keys.has(key)).toBe(false);
                seen_keys.add(key);
                expect(Object.keys(translations).sort()).toEqual([...APP_LOCALES].sort());

                for (const locale of APP_LOCALES) {
                    expect({
                        module: module_name,
                        key,
                        locale,
                        message: translations[locale],
                    }).toEqual(
                        expect.objectContaining({
                            message: expect.any(String),
                        })
                    );
                    expect(translations[locale].trim()).not.toBe('');
                }

                expect(extractPlaceholders(translations.en)).toEqual(
                    extractPlaceholders(translations['zh-CN'])
                );

                const params = Object.fromEntries(
                    extractPlaceholders(translations.en).map(placeholder => [
                        placeholder,
                        `[${placeholder}]`,
                    ])
                );
                for (const locale of APP_LOCALES) {
                    locale_ref.value = locale;
                    let translated: string;
                    try {
                        translated = tr(key as MessageKey, params);
                    } catch (error) {
                        throw new Error(
                            `Failed to compile translation ${module_name}:${key} (${locale})`,
                            { cause: error }
                        );
                    }
                    expect(translated.trim()).not.toBe('');
                }
            }
        }

        expect(message_count).toBeGreaterThan(0);
    });

    test('changing UI locale does not translate persisted override enum values', () => {
        const override = {
            更新方式: '额外模型解析' as const,
            额外模型解析配置: {
                启用自动请求: true,
            },
            兼容性: {
                更新到聊天变量: true,
                sendas不视为user消息: false,
            },
        };

        locale_ref.value = 'zh-CN';
        const serialized_zh = serializeCharacterSettingsOverride(override);

        locale_ref.value = 'en';
        const serialized_en = serializeCharacterSettingsOverride(override);

        expect(serialized_en).toBe(serialized_zh);
        expect(JSON.parse(serialized_en)).toMatchObject({
            更新方式: '额外模型解析',
            额外模型解析配置: {
                启用自动请求: true,
            },
            兼容性: {
                更新到聊天变量: true,
                sendas不视为user消息: false,
            },
        });
    });
});
