jest.mock('@/function/update/pi/pi_gateway', () => ({
    ANTHROPIC_MODELS: {},
    GOOGLE_MODELS: {},
    OPENAI_CODEX_MODELS: {},
    OPENAI_MODELS: {},
    anthropicMessagesApi: jest.fn(),
    createModels: jest.fn(),
    createProvider: jest.fn(),
    googleGenerativeAIApi: jest.fn(),
    openAICodexResponsesApi: jest.fn(),
    openAICompletionsApi: jest.fn(),
    openAIResponsesApi: jest.fn(),
}));

import { i18n } from '@/i18n';
import { PiContextAdapterError } from '@/function/update/pi/context_adapter';
import { PiRequestAbortedError } from '@/function/update/pi/controller_registry';
import {
    getLocalizedPiErrorMessage,
    localizePiError,
} from '@/function/update/pi/error_localization';
import { PiModelResolutionError } from '@/function/update/pi/model_resolver';
import { PiOAuthError } from '@/function/update/pi/oauth';
import { PiResultAdapterError } from '@/function/update/pi/result_adapter';
import { PiRuntimeError } from '@/function/update/pi/runtime';

describe('Pi error localization boundary', () => {
    const original_locale = i18n.global.locale.value;

    afterEach(() => {
        i18n.global.locale.value = original_locale;
    });

    test.each([
        ['zh-CN' as const, '所选 Pi 来源不可用，请重新选择来源。'],
        ['en' as const, 'The selected Pi provider is unavailable. Select a provider again.'],
    ])(
        'localizes model-resolution errors in %s without changing identity or code',
        (locale, text) => {
            i18n.global.locale.value = locale;
            const error = new PiModelResolutionError(
                'unknown_provider',
                'Unknown provider; Authorization: Bearer upstream-secret'
            );

            expect(localizePiError(error)).toBe(error);
            expect(error).toBeInstanceOf(PiModelResolutionError);
            expect(error.code).toBe('unknown_provider');
            expect(error.message).toBe(text);
            expect(error.stack).toBe(`PiModelResolutionError: ${text}`);
            expect(`${error.message}\n${error.stack}`).not.toContain('upstream-secret');
        }
    );

    test.each([
        ['zh-CN' as const, 'Pi Provider 请求失败。'],
        ['en' as const, 'The Pi provider request failed.'],
    ])('sanitizes provider errors in %s while retaining retry metadata', (locale, text) => {
        i18n.global.locale.value = locale;
        const error = new PiRuntimeError(
            'provider',
            'upstream echoed x-api-key=provider-secret',
            true
        );

        expect(localizePiError(error)).toBe(error);
        expect(error).toBeInstanceOf(PiRuntimeError);
        expect(error.code).toBe('provider');
        expect(error.retryable).toBe(true);
        expect(error.message).toContain(text);
        expect(`${error.message}\n${error.stack}`).not.toContain('provider-secret');
    });

    test.each([
        ['zh-CN' as const, 'Pi 图片输入必须是'],
        ['en' as const, 'Pi image input must be'],
    ])('localizes context errors in %s and keeps their source metadata', (locale, text) => {
        i18n.global.locale.value = locale;
        const error = new PiContextAdapterError(
            'image contained secret callback query',
            'invalid-image',
            7
        );

        expect(localizePiError(error)).toBe(error);
        expect(error.code).toBe('invalid-image');
        expect(error.sourceIndex).toBe(7);
        expect(error.message).toContain(text);
        expect(error.message).not.toContain('secret callback');
    });

    test.each([
        ['zh-CN' as const, 'Pi 回复仅包含 thinking'],
        ['en' as const, 'The Pi response contained only thinking'],
    ])(
        'localizes result-adapter errors in %s without exposing the original text',
        (locale, text) => {
            i18n.global.locale.value = locale;
            const error = new PiResultAdapterError(
                'thinking only; response included provider-secret',
                'empty-response'
            );

            expect(localizePiError(error)).toBe(error);
            expect(error.code).toBe('empty-response');
            expect(error.message).toContain(text);
            expect(error.message).not.toContain('provider-secret');
        }
    );

    test.each([
        ['zh-CN' as const, '请求预计占用 900 个输入 token'],
        ['en' as const, 'The request is estimated to use 900 input tokens'],
    ])('renders token-budget details in %s using structured safe values', (locale, text) => {
        i18n.global.locale.value = locale;
        const error = new PiRuntimeError(
            'token_budget',
            'Pi prompt is too long: estimated 900 input tokens, limit 100 after reserving 200 reply tokens and 50 safety tokens'
        );

        localizePiError(error);

        expect(error.message).toContain(text);
        expect(error.message).toContain('350');
    });

    test('retains abort identity and generation id after localization', () => {
        i18n.global.locale.value = 'en';
        const error = new PiRequestAbortedError('generation-1', 'secret abort reason');

        expect(localizePiError(error)).toBe(error);
        expect(error).toBeInstanceOf(PiRequestAbortedError);
        expect(error.generationId).toBe('generation-1');
        expect(error.message).toBe('The Pi request was cancelled.');
        expect(error.stack).not.toContain('secret abort reason');
    });

    test.each([
        ['zh-CN' as const, 'OAuth callback URL 无效。'],
        ['en' as const, 'The OAuth callback URL is invalid.'],
    ])('provides UI-safe OAuth text in %s', (locale, text) => {
        i18n.global.locale.value = locale;
        const error = new PiOAuthError(
            'invalid_callback',
            'callback contained code=oauth-secret and state=state-secret'
        );

        expect(getLocalizedPiErrorMessage(error)).toContain(text);
        expect(error).toBeInstanceOf(PiOAuthError);
        expect(error.code).toBe('invalid_callback');
        expect(error.message).not.toContain('oauth-secret');
    });

    test('uses a generic localized Pi message for unknown UI failures', () => {
        i18n.global.locale.value = 'en';

        expect(getLocalizedPiErrorMessage(new Error('API key: unknown-secret'))).toBe(
            'The Pi provider request failed. Check the provider settings, credentials, and network, then retry.'
        );
    });
});
