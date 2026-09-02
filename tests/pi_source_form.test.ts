jest.mock('@/function/update/pi/pi_gateway', () => {
    const streams = () => ({ stream: jest.fn(), streamSimple: jest.fn() });
    const model = (id: string, api: string, contextWindow: number) => {
        const provider =
            api === 'openai-codex-responses'
                ? 'openai-codex'
                : api.startsWith('openai')
                  ? 'openai'
                  : api === 'anthropic-messages'
                    ? 'anthropic'
                    : 'google';
        const baseUrl =
            provider === 'openai'
                ? 'https://api.openai.com/v1'
                : provider === 'openai-codex'
                  ? 'https://chatgpt.com/backend-api'
                  : provider === 'anthropic'
                    ? 'https://api.anthropic.com'
                    : 'https://generativelanguage.googleapis.com/v1beta';
        return {
            id,
            name: id,
            api,
            provider,
            baseUrl,
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow,
            maxTokens: 4096,
        };
    };

    return {
        OPENAI_MODELS: {
            'gpt-known': model('gpt-known', 'openai-responses', 128_000),
            'gpt-4.1': model('gpt-4.1', 'openai-responses', 1_047_576),
        },
        OPENAI_CODEX_MODELS: {
            'codex-known': model('codex-known', 'openai-codex-responses', 200_000),
        },
        ANTHROPIC_MODELS: {
            'claude-known': model('claude-known', 'anthropic-messages', 200_000),
        },
        GOOGLE_MODELS: {
            'gemini-known': model('gemini-known', 'google-generative-ai', 1_000_000),
        },
        openAIResponsesApi: jest.fn(streams),
        openAICompletionsApi: jest.fn(streams),
        openAICodexResponsesApi: jest.fn(streams),
        anthropicMessagesApi: jest.fn(streams),
        googleGenerativeAIApi: jest.fn(streams),
    };
});

import {
    findPiCatalogModel,
    includePersistedPiOption,
    isPiEndpointCatalogCompatible,
    isPiOAuthUiContextCurrent,
    isPiSourceFieldReadonly,
    parsePiContextWindowInput,
    resolvePiContextWindow,
    resolvePiApiKeyScope,
    resolvePiEndpointSelection,
    resolvePiRequestTargetIdentity,
    resolvePiSourceCapabilities,
    resolvePiSourceSelection,
    transitionPiApiKey,
    transitionPiRequestOverrides,
    validatePiTokenSettings,
} from '@/panel/update/pi_source_form';
import {
    getPiCatalogModels,
    getPiProviderDefinition,
    isPiCatalogModelApiCompatible,
    resolvePiCapabilities,
} from '@/function/update/pi/provider_registry';

describe('Pi source form helpers', () => {
    test('isolates the visible API key across custom, Pi providers, and OAuth', () => {
        const custom = { source: '自定义', authType: 'api_key', keyScope: '' };
        const openai = {
            source: '更多',
            authType: 'api_key',
            keyScope: 'openai\nhttps://api.openai.com/v1',
        };
        const anthropic = {
            source: '更多',
            authType: 'api_key',
            keyScope: 'anthropic\nhttps://api.anthropic.com',
        };
        const anthropicOAuth = { ...anthropic, authType: 'oauth' };

        const toOpenAi = transitionPiApiKey(custom, openai, 'custom-secret', {
            customApiKey: '',
            apiKeys: {
                [openai.keyScope]: 'openai-secret',
                [anthropic.keyScope]: 'anthropic-secret',
            },
        });
        expect(toOpenAi).toEqual({
            activeApiKey: 'openai-secret',
            customApiKey: 'custom-secret',
            apiKeys: {
                [openai.keyScope]: 'openai-secret',
                [anthropic.keyScope]: 'anthropic-secret',
            },
        });

        const toAnthropic = transitionPiApiKey(openai, anthropic, 'edited-openai-secret', toOpenAi);
        expect(toAnthropic.activeApiKey).toBe('anthropic-secret');
        expect(toAnthropic.apiKeys[openai.keyScope]).toBe('edited-openai-secret');

        const toOAuth = transitionPiApiKey(
            anthropic,
            anthropicOAuth,
            'edited-anthropic-secret',
            toAnthropic
        );
        expect(toOAuth.activeApiKey).toBe('');
        expect(toOAuth.apiKeys[anthropic.keyScope]).toBe('edited-anthropic-secret');

        const backToAnthropic = transitionPiApiKey(anthropicOAuth, anthropic, '', toOAuth);
        expect(backToAnthropic.activeApiKey).toBe('edited-anthropic-secret');

        const backToCustom = transitionPiApiKey(
            anthropic,
            custom,
            backToAnthropic.activeApiKey,
            backToAnthropic
        );
        expect(backToCustom.activeApiKey).toBe('custom-secret');
    });

    test('fails closed when the destination key slot has never been configured', () => {
        expect(
            transitionPiApiKey(
                { source: '自定义', authType: 'api_key', keyScope: '' },
                {
                    source: '更多',
                    authType: 'api_key',
                    keyScope: 'google\nhttps://generativelanguage.googleapis.com/v1beta',
                },
                'must-not-leak',
                { customApiKey: '', apiKeys: {} }
            )
        ).toMatchObject({
            activeApiKey: '',
            customApiKey: 'must-not-leak',
            apiKeys: {},
        });
    });

    test('isolates API keys by normalized effective endpoint and fails closed for invalid targets', () => {
        const openai = getPiProviderDefinition('openai')!;
        const anthropic = getPiProviderDefinition('anthropic')!;
        const google = getPiProviderDefinition('google')!;

        const official = resolvePiApiKeyScope(openai, 'openai-responses', 'api_key', '');
        expect(official).toBe('openai\nhttps://api.openai.com/v1');
        expect(
            resolvePiApiKeyScope(
                openai,
                'openai-completions',
                'api_key',
                ' https://api.openai.com/v1/// '
            )
        ).toBe(official);

        const proxy = resolvePiApiKeyScope(
            openai,
            'openai-responses',
            'api_key',
            'https://proxy.example/v1/'
        );
        expect(proxy).toBe('openai\nhttps://proxy.example/v1');
        expect(proxy).not.toBe(official);
        expect(
            resolvePiApiKeyScope(
                openai,
                'openai-responses',
                'api_key',
                'https://proxy.example/v1/responses/'
            )
        ).toBe(proxy);
        expect(
            resolvePiApiKeyScope(
                openai,
                'openai-completions',
                'api_key',
                'https://proxy.example/v1/chat/completions'
            )
        ).toBe(proxy);

        expect(resolvePiApiKeyScope(openai, 'openai-responses', 'api_key', 'not a URL')).toBe('');
        expect(resolvePiApiKeyScope(openai, 'unknown-api', 'api_key', '')).toBe('');
        expect(resolvePiApiKeyScope(openai, 'openai-responses', 'oauth', '')).toBe('');
        expect(
            resolvePiApiKeyScope(anthropic, 'anthropic-messages', 'api_key', 'https://x.test')
        ).toBe('anthropic\nhttps://x.test');
        expect(
            resolvePiApiKeyScope(
                anthropic,
                'anthropic-messages',
                'api_key',
                'https://x.test/v1/messages'
            )
        ).toBe('anthropic\nhttps://x.test');
        expect(
            resolvePiApiKeyScope(google, 'google-generative-ai', 'api_key', 'https://x.test')
        ).toBe('');
    });

    test('does not reuse an official endpoint key at a custom endpoint', () => {
        const official = {
            source: '更多',
            authType: 'api_key',
            keyScope: 'openai\nhttps://api.openai.com/v1',
        };
        const proxy = {
            ...official,
            keyScope: 'openai\nhttps://proxy.example/v1',
        };

        const switched = transitionPiApiKey(official, proxy, 'official-secret', {
            customApiKey: '',
            apiKeys: {},
        });
        expect(switched.activeApiKey).toBe('');
        expect(switched.apiKeys[official.keyScope]).toBe('official-secret');

        const restored = transitionPiApiKey(proxy, official, 'proxy-secret', switched);
        expect(restored.activeApiKey).toBe('official-secret');
        expect(restored.apiKeys[proxy.keyScope]).toBe('proxy-secret');
    });

    test('uses an applied profile key only for its exact API-key slot', () => {
        const apiKeyProfile = {
            source: '更多',
            authType: 'api_key',
            keyScope: 'openai\nhttps://proxy.example/v1',
        };
        expect(
            transitionPiApiKey(apiKeyProfile, apiKeyProfile, 'profile-secret', {
                customApiKey: 'custom-secret',
                apiKeys: {},
            })
        ).toEqual({
            activeApiKey: 'profile-secret',
            customApiKey: 'custom-secret',
            apiKeys: { [apiKeyProfile.keyScope]: 'profile-secret' },
        });

        const oauthProfile = { ...apiKeyProfile, authType: 'oauth', keyScope: '' };
        expect(
            transitionPiApiKey(oauthProfile, oauthProfile, 'misplaced-profile-secret', {
                customApiKey: 'custom-secret',
                apiKeys: { [apiKeyProfile.keyScope]: 'cached-provider-secret' },
            })
        ).toEqual({
            activeApiKey: '',
            customApiKey: 'custom-secret',
            apiKeys: { [apiKeyProfile.keyScope]: 'cached-provider-secret' },
        });
    });

    test('uses a normalized target identity to decide when request overrides must clear', () => {
        const openai = getPiProviderDefinition('openai')!;
        const official = resolvePiRequestTargetIdentity(
            openai,
            'openai',
            'openai-responses',
            'api_key',
            ''
        );
        expect(
            resolvePiRequestTargetIdentity(
                openai,
                'openai',
                'openai-responses',
                'api_key',
                ' https://api.openai.com/v1/// '
            )
        ).toBe(official);
        expect(
            resolvePiRequestTargetIdentity(
                openai,
                'openai',
                'openai-responses',
                'api_key',
                'https://api.openai.com/v1/responses'
            )
        ).toBe(official);
        expect(
            resolvePiRequestTargetIdentity(
                openai,
                'openai',
                'openai-responses',
                'api_key',
                'https://proxy.example/v1'
            )
        ).not.toBe(official);
        expect(
            resolvePiRequestTargetIdentity(openai, 'openai', 'openai-completions', 'api_key', '')
        ).not.toBe(official);
        expect(
            resolvePiRequestTargetIdentity(openai, 'openai', 'openai-responses', 'oauth', '')
        ).not.toBe(official);
        expect(
            resolvePiRequestTargetIdentity(
                undefined,
                'future-provider',
                'future-api',
                'api_key',
                'bad endpoint a'
            )
        ).not.toBe(
            resolvePiRequestTargetIdentity(
                undefined,
                'future-provider',
                'future-api',
                'api_key',
                'bad endpoint b'
            )
        );

        const overrides = {
            customHeaders: 'X-Internal-Token: secret',
            customIncludeBody: 'metadata:\n  private: secret',
            customExcludeBody: '- store',
        };
        expect(transitionPiRequestOverrides(official, official, overrides)).toEqual(overrides);
        expect(
            transitionPiRequestOverrides(
                official,
                resolvePiRequestTargetIdentity(
                    openai,
                    'openai',
                    'openai-responses',
                    'api_key',
                    'https://proxy.example/v1'
                ),
                overrides
            )
        ).toEqual({ customHeaders: '', customIncludeBody: '', customExcludeBody: '' });
    });

    test('invalidates OAuth confirmation work for lifecycle and selection changes', () => {
        const captured = {
            generation: 7,
            providerId: 'anthropic',
            profileName: 'Claude',
        };
        const current = {
            ...captured,
            mounted: true,
            active: true,
        };

        expect(isPiOAuthUiContextCurrent(captured, current)).toBe(true);
        expect(isPiOAuthUiContextCurrent(captured, { ...current, generation: 8 })).toBe(false);
        expect(
            isPiOAuthUiContextCurrent(captured, { ...current, providerId: 'openai-codex' })
        ).toBe(false);
        expect(isPiOAuthUiContextCurrent(captured, { ...current, profileName: 'Codex' })).toBe(
            false
        );
        expect(isPiOAuthUiContextCurrent(captured, { ...current, active: false })).toBe(false);
        expect(isPiOAuthUiContextCurrent(captured, { ...current, mounted: false })).toBe(false);
    });

    test('keeps unsupported persisted IDs visible without normalizing them', () => {
        const allowed = ['openai-responses', 'openai-completions'] as const;

        expect(includePersistedPiOption(allowed, 'future-openai-api')).toEqual([
            'future-openai-api',
            ...allowed,
        ]);
        expect(includePersistedPiOption(allowed, 'openai-responses')).toBe(allowed);
        expect(includePersistedPiOption(allowed, '')).toBe(allowed);
    });

    test('unlocks a fixed field only to let the user explicitly repair an invalid value', () => {
        const allowed = ['anthropic-messages'] as const;

        expect(isPiSourceFieldReadonly('readonly', allowed, 'anthropic-messages')).toBe(true);
        expect(isPiSourceFieldReadonly('readonly', allowed, 'future-anthropic-api')).toBe(false);
        expect(isPiSourceFieldReadonly('select', ['api_key', 'oauth'], 'api_key')).toBe(false);
        expect(isPiSourceFieldReadonly(undefined, [], 'unknown')).toBe(true);
    });

    test('keeps valid configurable API and auth selections', () => {
        const openai = getPiProviderDefinition('openai')!;
        expect(resolvePiSourceSelection(openai, 'openai-completions', 'api_key')).toEqual({
            api: 'openai-completions',
            authType: 'api_key',
        });
    });

    test('locks OAuth and fixed providers to their registered API', () => {
        const anthropic = getPiProviderDefinition('anthropic')!;
        expect(resolvePiSourceSelection(anthropic, 'openai-responses', 'oauth')).toEqual({
            api: 'anthropic-messages',
            authType: 'oauth',
        });

        const codex = getPiProviderDefinition('openai-codex')!;
        expect(resolvePiSourceSelection(codex, 'openai-completions', 'api_key')).toEqual({
            api: 'openai-codex-responses',
            authType: 'oauth',
        });
    });

    test('keeps custom endpoints only for API-key providers that explicitly allow them', () => {
        const openai = getPiProviderDefinition('openai')!;
        const anthropic = getPiProviderDefinition('anthropic')!;

        expect(resolvePiEndpointSelection(openai, 'api_key', 'https://proxy.example/v1')).toBe(
            'https://proxy.example/v1'
        );
        expect(resolvePiEndpointSelection(anthropic, 'api_key', 'https://proxy.example/api')).toBe(
            'https://proxy.example/api'
        );
        expect(resolvePiEndpointSelection(anthropic, 'oauth', 'https://stale.example')).toBe('');
    });

    test('inherits catalog capabilities only for empty or canonical default endpoints', () => {
        const openai = getPiProviderDefinition('openai')!;
        const catalogModel = getPiCatalogModels('openai')[0];

        expect(isPiEndpointCatalogCompatible(openai, '')).toBe(true);
        expect(isPiEndpointCatalogCompatible(openai, ' https://api.openai.com/v1/// ')).toBe(true);
        expect(isPiEndpointCatalogCompatible(openai, 'https://api.openai.com/v1/responses')).toBe(
            true
        );
        expect(isPiEndpointCatalogCompatible(openai, 'https://proxy.example/v1')).toBe(false);
        expect(isPiEndpointCatalogCompatible(openai, 'http://proxy.example/v1')).toBe(false);
        expect(isPiEndpointCatalogCompatible(openai, 'not a URL')).toBe(false);

        expect(
            resolvePiSourceCapabilities(openai, 'openai-responses', '', catalogModel)
        ).toMatchObject({ tools: true, structuredOutput: true, jsonObjectOutput: true });
        for (const endpoint of [
            'https://proxy.example/v1',
            'http://proxy.example/v1',
            'not a URL',
        ]) {
            expect(
                resolvePiSourceCapabilities(openai, 'openai-responses', endpoint, catalogModel)
            ).toMatchObject({
                tools: false,
                structuredOutput: false,
                jsonObjectOutput: false,
                imageInput: false,
            });
        }
    });

    test('uses per-field sampling capabilities and fails closed for unknown model features', () => {
        const openai = getPiProviderDefinition('openai')!;
        const catalog_model = getPiCatalogModels('openai')[0];
        const responses = resolvePiCapabilities(openai, 'openai-responses', {
            model: catalog_model,
            catalogHit: true,
        })!;
        const completions = resolvePiCapabilities(openai, 'openai-completions', {
            model: catalog_model,
            catalogHit: true,
        })!;
        const unknown = resolvePiCapabilities(openai, 'openai-responses', {
            catalogHit: false,
        })!;

        expect(responses.sampling).toEqual({
            topP: true,
            topK: false,
            frequencyPenalty: false,
            presencePenalty: false,
        });
        expect(completions.sampling).toEqual({
            topP: true,
            topK: false,
            frequencyPenalty: true,
            presencePenalty: true,
        });
        expect(unknown).toMatchObject({
            tools: false,
            structuredOutput: false,
            imageInput: false,
        });
    });

    test('uses a positive user context-window override before the catalog value', () => {
        expect(resolvePiContextWindow(32_000, 128_000)).toBe(32_000);
        expect(resolvePiContextWindow(0, 128_000)).toBe(128_000);
        expect(resolvePiContextWindow(0, undefined)).toBe(0);
        expect(resolvePiContextWindow(1.5, 128_000)).toBe(0);
        expect(resolvePiContextWindow('invalid', 128_000)).toBe(0);
    });

    test('clearing the context-window input removes the override', () => {
        expect(parsePiContextWindowInput('')).toBe(0);
        expect(parsePiContextWindowInput('  ')).toBe(0);
        expect(parsePiContextWindowInput('16384')).toBe(16_384);
        expect(parsePiContextWindowInput('1.5')).toBe('1.5');
        expect(parsePiContextWindowInput('-1')).toBe('-1');
        expect(parsePiContextWindowInput('', true)).toBe('__invalid_context_window__');
    });

    test('finds catalog metadata only for the selected wire API', () => {
        const models = getPiCatalogModels('openai');
        const model = models[0];
        expect(findPiCatalogModel(models, model.id)).toBe(model);
        expect(findPiCatalogModel(models, 'missing-model')).toBeUndefined();
        expect(
            isPiCatalogModelApiCompatible(
                getPiProviderDefinition('openai')!,
                models.find(candidate => candidate.id === 'gpt-4.1')!,
                'openai-completions'
            )
        ).toBe(true);
        expect(
            isPiCatalogModelApiCompatible(
                getPiProviderDefinition('openai')!,
                model,
                'openai-completions'
            )
        ).toBe(false);
    });

    test('validates positive integers and the reply-to-context relationship', () => {
        expect(validatePiTokenSettings(128_000, 4096)).toEqual([]);
        expect(validatePiTokenSettings(0, 0)).toEqual([
            'context-window-required',
            'max-tokens-positive-integer',
        ]);
        expect(validatePiTokenSettings(0, 4096)).toEqual(['context-window-required']);
        expect(validatePiTokenSettings(4096, 8192)).toEqual(['max-tokens-exceed-context-window']);
        expect(validatePiTokenSettings(4096.5, 1024.5)).toEqual([
            'context-window-required',
            'max-tokens-positive-integer',
        ]);
    });
});
