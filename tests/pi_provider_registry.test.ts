jest.mock('@/function/update/pi/pi_gateway', () => {
    const streams = () => ({
        stream: jest.fn(),
        streamSimple: jest.fn(),
    });
    const model = (
        id: string,
        api: string,
        provider: string,
        baseUrl: string,
        contextWindow: number,
        maxTokens: number,
        compat: Record<string, unknown> = { supportsStrictMode: true }
    ) => ({
        id,
        name: `${id} display name`,
        api,
        provider,
        baseUrl,
        reasoning: false,
        input: ['text'],
        cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens,
        compat,
    });
    const openaiModel = (id: string) =>
        model(id, 'openai-responses', 'openai', 'https://api.openai.com/v1', 200_000, 100_000);
    const googleModel = (id: string) =>
        model(
            id,
            'google-generative-ai',
            'google',
            'https://generativelanguage.googleapis.com/v1beta',
            1_000_000,
            65_536
        );

    return {
        OPENAI_MODELS: {
            'gpt-known': model(
                'gpt-known',
                'openai-responses',
                'openai',
                'https://api.openai.com/v1',
                128_000,
                8192
            ),
            'gpt-4': model(
                'gpt-4',
                'openai-responses',
                'openai',
                'https://api.openai.com/v1',
                8192,
                8192
            ),
            'gpt-4.1': model(
                'gpt-4.1',
                'openai-responses',
                'openai',
                'https://api.openai.com/v1',
                1_047_576,
                32_768
            ),
            'gpt-4-turbo': openaiModel('gpt-4-turbo'),
            'gpt-4o-2024-05-13': openaiModel('gpt-4o-2024-05-13'),
            'gpt-5': {
                ...model(
                    'gpt-5',
                    'openai-responses',
                    'openai',
                    'https://api.openai.com/v1',
                    400_000,
                    128_000
                ),
                reasoning: true,
                thinkingLevelMap: { off: null },
            },
            'gpt-realtime-2.1': {
                ...model(
                    'gpt-realtime-2.1',
                    'openai-responses',
                    'openai',
                    'https://api.openai.com/v1',
                    128_000,
                    32_000
                ),
                reasoning: true,
                thinkingLevelMap: { off: null },
            },
            o1: openaiModel('o1'),
            o3: openaiModel('o3'),
            'o3-mini': openaiModel('o3-mini'),
            'o4-mini': openaiModel('o4-mini'),
            'o3-pro': openaiModel('o3-pro'),
            'gpt-5-pro': openaiModel('gpt-5-pro'),
            'gpt-5.2-pro': openaiModel('gpt-5.2-pro'),
            'gpt-5.4-pro': openaiModel('gpt-5.4-pro'),
            'gpt-5.5-pro': openaiModel('gpt-5.5-pro'),
        },
        OPENAI_CODEX_MODELS: {
            'codex-known': model(
                'codex-known',
                'openai-codex-responses',
                'openai-codex',
                'https://chatgpt.com/backend-api',
                200_000,
                32_000
            ),
        },
        ANTHROPIC_MODELS: {
            'claude-known': model(
                'claude-known',
                'anthropic-messages',
                'anthropic',
                'https://api.anthropic.com',
                200_000,
                8192,
                { supportsStrictTools: true, supportsTemperature: false }
            ),
            'claude-opus-4-6': model(
                'claude-opus-4-6',
                'anthropic-messages',
                'anthropic',
                'https://api.anthropic.com',
                200_000,
                8192,
                { supportsStrictTools: true }
            ),
            'claude-fable-5': model(
                'claude-fable-5',
                'anthropic-messages',
                'anthropic',
                'https://api.anthropic.com',
                200_000,
                8192,
                { supportsStrictTools: true }
            ),
        },
        GOOGLE_MODELS: {
            'gemini-known': model(
                'gemini-known',
                'google-generative-ai',
                'google',
                'https://generativelanguage.googleapis.com/v1beta',
                1_000_000,
                65_536
            ),
            'gemini-2.5-flash': model(
                'gemini-2.5-flash',
                'google-generative-ai',
                'google',
                'https://generativelanguage.googleapis.com/v1beta',
                1_000_000,
                65_536
            ),
            'deep-research-preview-04-2026': model(
                'deep-research-preview-04-2026',
                'google-generative-ai',
                'google',
                'https://generativelanguage.googleapis.com/v1beta',
                1_000_000,
                65_536
            ),
            'gemini-3-flash-preview': googleModel('gemini-3-flash-preview'),
            'gemini-3.5-flash-lite': googleModel('gemini-3.5-flash-lite'),
            'gemini-3.6-flash': googleModel('gemini-3.6-flash'),
            'gemini-3.7-flash': googleModel('gemini-3.7-flash'),
            'gemini-3.1-flash-lite-preview': googleModel('gemini-3.1-flash-lite-preview'),
            'gemini-3.1-pro-preview-customtools': googleModel('gemini-3.1-pro-preview-customtools'),
            'gemini-flash-latest': googleModel('gemini-flash-latest'),
            'gemini-flash-lite-latest': googleModel('gemini-flash-lite-latest'),
        },
        openAIResponsesApi: jest.fn(streams),
        openAICompletionsApi: jest.fn(streams),
        openAICodexResponsesApi: jest.fn(streams),
        anthropicMessagesApi: jest.fn(streams),
        googleGenerativeAIApi: jest.fn(streams),
    };
});

import {
    createPiApiImplementations,
    getPiCatalogModels,
    getPiProviderDefinition,
    getPiProviderRegistration,
    listPiProviderDefinitions,
    resolvePiCapabilities,
} from '@/function/update/pi/provider_registry';
import {
    isPiDefaultProviderEndpoint,
    normalizePiEndpoint,
    PiModelResolutionError,
    resolvePiModel,
    resolvePiModelFromExtraModelSettings,
    type PiModelResolutionErrorCode,
    type ResolvePiModelInput,
} from '@/function/update/pi/model_resolver';

const OPENAI_CONFIG = {
    provider: 'openai',
    api: 'openai-responses',
    authType: 'api_key',
    endpoint: '',
    model: 'gpt-known',
    contextWindow: 0,
};

function pickAdvancedCapabilities(
    capabilities:
        | Readonly<{
              tools: boolean;
              structuredOutput: boolean;
              jsonObjectOutput: boolean;
          }>
        | undefined
) {
    return capabilities
        ? {
              tools: capabilities.tools,
              structuredOutput: capabilities.structuredOutput,
              jsonObjectOutput: capabilities.jsonObjectOutput,
          }
        : undefined;
}

function expectResolutionError(
    input: ResolvePiModelInput,
    expectedCode: PiModelResolutionErrorCode
): void {
    try {
        resolvePiModel(input);
        throw new Error('Expected pi model resolution to fail');
    } catch (error) {
        expect(error).toBeInstanceOf(PiModelResolutionError);
        expect((error as PiModelResolutionError).code).toBe(expectedCode);
    }
}

describe('pi provider registry', () => {
    test('exposes exactly the browser-supported sources and their UI/runtime constraints', () => {
        const definitions = listPiProviderDefinitions();
        expect(definitions.map(definition => definition.key)).toEqual([
            'openai',
            'openai-codex',
            'anthropic',
            'google',
        ]);

        expect(getPiProviderDefinition('openai')).toMatchObject({
            providerId: 'openai',
            displayName: { 'zh-CN': 'OpenAI', en: 'OpenAI' },
            defaultApi: 'openai-responses',
            allowedApis: ['openai-responses', 'openai-completions'],
            allowedAuthTypes: ['api_key'],
            defaultBaseUrl: 'https://api.openai.com/v1',
            allowCustomEndpoint: true,
            fields: { api: 'select', authType: 'readonly', endpoint: 'editable' },
        });
        expect(getPiProviderDefinition('anthropic')).toMatchObject({
            allowedApis: ['anthropic-messages'],
            allowedAuthTypes: ['api_key', 'oauth'],
            allowCustomEndpoint: true,
            fields: { api: 'readonly', authType: 'select', endpoint: 'editable' },
        });
        expect(getPiProviderDefinition('openai-codex')).toMatchObject({
            allowedApis: ['openai-codex-responses'],
            allowedAuthTypes: ['oauth'],
            fields: { apiKey: 'hidden', oauth: 'when-oauth' },
        });
        expect(getPiProviderDefinition('google')).toMatchObject({
            allowedApis: ['google-generative-ai'],
            allowedAuthTypes: ['api_key'],
        });
        expect(getPiProviderDefinition('not-registered')).toBeUndefined();
        expect(getPiProviderRegistration).toBe(getPiProviderDefinition);
    });

    test.each([
        {
            label: 'OpenAI Responses',
            provider: 'openai',
            api: 'openai-responses',
            expected: { tools: true, structuredOutput: true, jsonObjectOutput: true },
        },
        {
            label: 'OpenAI Chat Completions',
            provider: 'openai',
            api: 'openai-completions',
            expected: { tools: true, structuredOutput: true, jsonObjectOutput: true },
        },
        {
            label: 'OpenAI Codex Responses',
            provider: 'openai-codex',
            api: 'openai-codex-responses',
            expected: { tools: true, structuredOutput: true, jsonObjectOutput: true },
        },
        {
            label: 'Anthropic Messages',
            provider: 'anthropic',
            api: 'anthropic-messages',
            expected: { tools: true, structuredOutput: true, jsonObjectOutput: false },
        },
        {
            label: 'Google Generative AI',
            provider: 'google',
            api: 'google-generative-ai',
            expected: { tools: true, structuredOutput: true, jsonObjectOutput: true },
        },
    ] as const)(
        'declares the exact advanced capability matrix for $label',
        ({ provider, api, expected }) => {
            expect(
                pickAdvancedCapabilities(getPiProviderDefinition(provider)!.apiCapabilities[api])
            ).toEqual(expected);
        }
    );

    test('derives model-aware capability gates from the shared registry', () => {
        const anthropic = getPiProviderDefinition('anthropic')!;
        const known = getPiCatalogModels('anthropic')[0];

        expect(
            resolvePiCapabilities(anthropic, 'anthropic-messages', {
                model: known,
                catalogHit: true,
            })
        ).toMatchObject({
            tools: true,
            structuredOutput: true,
            jsonObjectOutput: false,
            temperature: false,
            sampling: {
                topP: false,
                topK: false,
                frequencyPenalty: false,
                presencePenalty: false,
            },
        });
        expect(
            resolvePiCapabilities(anthropic, 'anthropic-messages', {
                catalogHit: false,
            })
        ).toMatchObject({
            tools: true,
            structuredOutput: true,
            jsonObjectOutput: false,
            imageInput: false,
        });
    });

    test('keeps OpenAI advanced capabilities optimistic while applying sampling and streaming gates', () => {
        const openai = getPiProviderDefinition('openai')!;
        const models = Object.fromEntries(
            getPiCatalogModels('openai').map(model => [model.id, model])
        );

        expect(
            resolvePiCapabilities(openai, 'openai-responses', {
                model: models['gpt-4'],
                catalogHit: true,
            })
        ).toMatchObject({ tools: true, structuredOutput: true, jsonObjectOutput: true });
        for (const id of ['gpt-4-turbo', 'gpt-4o-2024-05-13']) {
            expect(
                resolvePiCapabilities(openai, 'openai-responses', {
                    model: models[id],
                    catalogHit: true,
                })
            ).toMatchObject({ structuredOutput: true, jsonObjectOutput: true });
        }
        expect(
            resolvePiCapabilities(openai, 'openai-responses', {
                model: models['gpt-5'],
                catalogHit: true,
            })
        ).toMatchObject({
            temperature: false,
            sampling: {
                topP: false,
                topK: false,
                frequencyPenalty: false,
                presencePenalty: false,
            },
        });
        expect(
            resolvePiCapabilities(openai, 'openai-responses', {
                model: models['gpt-realtime-2.1'],
                catalogHit: true,
            })
        ).toMatchObject({ streaming: false });
        expect(
            resolvePiCapabilities(openai, 'openai-responses', {
                model: models['o3-pro'],
                catalogHit: true,
            })
        ).toMatchObject({ streaming: false });
        expect(
            resolvePiCapabilities(openai, 'openai-responses', {
                model: models['gpt-5-pro'],
                catalogHit: true,
            })
        ).toMatchObject({ structuredOutput: true, jsonObjectOutput: true });
        expect(
            resolvePiCapabilities(openai, 'openai-responses', {
                model: models['gpt-5.5-pro'],
                catalogHit: true,
            })
        ).toMatchObject({
            streaming: false,
            structuredOutput: true,
            jsonObjectOutput: true,
        });
        for (const id of ['gpt-5.2-pro', 'gpt-5.4-pro']) {
            expect(
                resolvePiCapabilities(openai, 'openai-responses', {
                    model: models[id],
                    catalogHit: true,
                })
            ).toMatchObject({ structuredOutput: true, jsonObjectOutput: true });
        }
        for (const id of ['o1', 'o3', 'o3-mini', 'o4-mini']) {
            expect(
                resolvePiCapabilities(openai, 'openai-completions', {
                    model: { ...structuredClone(models[id]), api: 'openai-completions' },
                    catalogHit: true,
                })
            ).toMatchObject({ tools: true, structuredOutput: true, jsonObjectOutput: true });
        }
    });

    test('re-verifies the catalog provider, original API, and default endpoint internally', () => {
        const openai = getPiProviderDefinition('openai')!;
        const catalogModel = getPiCatalogModels('openai')[0];

        expect(
            resolvePiCapabilities(openai, 'openai-responses', {
                model: structuredClone(catalogModel),
                catalogHit: true,
            })
        ).toMatchObject({ tools: true, structuredOutput: true, jsonObjectOutput: true });

        for (const model of [
            { ...structuredClone(catalogModel), baseUrl: 'https://proxy.example/v1' },
            { ...structuredClone(catalogModel), provider: 'anthropic' },
            { ...structuredClone(catalogModel), id: 'gpt-not-in-catalog' },
        ]) {
            expect(
                resolvePiCapabilities(openai, 'openai-responses', {
                    model,
                    catalogHit: true,
                })
            ).toMatchObject({
                tools: true,
                structuredOutput: true,
                jsonObjectOutput: true,
                imageInput: false,
            });
        }

        expect(
            resolvePiCapabilities(openai, 'openai-completions', {
                model: { ...structuredClone(catalogModel), api: 'openai-completions' },
                catalogHit: true,
            })
        ).toMatchObject({
            tools: true,
            structuredOutput: true,
            jsonObjectOutput: true,
            imageInput: false,
        });
    });

    test('disables all Anthropic sampling controls for 4.7+ and current unsupported models', () => {
        const anthropic = getPiProviderDefinition('anthropic')!;
        const catalogDisabled = getPiCatalogModels('anthropic').find(
            model => model.id === 'claude-known'
        )!;
        const supported = getPiCatalogModels('anthropic').find(
            model => model.id === 'claude-opus-4-6'
        )!;
        const unsupported = getPiCatalogModels('anthropic').find(
            model => model.id === 'claude-fable-5'
        )!;

        expect(
            resolvePiCapabilities(anthropic, 'anthropic-messages', {
                model: supported,
                catalogHit: true,
            })
        ).toMatchObject({ temperature: true, sampling: { topP: true, topK: true } });
        expect(
            resolvePiCapabilities(anthropic, 'anthropic-messages', {
                model: unsupported,
                catalogHit: true,
            })
        ).toMatchObject({ temperature: false, sampling: { topP: false, topK: false } });
        expect(
            resolvePiCapabilities(anthropic, 'anthropic-messages', {
                model: {
                    ...structuredClone(catalogDisabled),
                    compat: { supportsTemperature: true },
                },
                catalogHit: true,
            })
        ).toMatchObject({ temperature: false, sampling: { topP: false, topK: false } });
    });

    test('keeps Google tools and structured output at the wire API capability level', () => {
        const google = getPiProviderDefinition('google')!;
        const models = Object.fromEntries(
            getPiCatalogModels('google').map(model => [model.id, model])
        );
        const unsupported = models['deep-research-preview-04-2026'];

        for (const id of [
            'gemini-2.5-flash',
            'gemini-3-flash-preview',
            'gemini-3.5-flash-lite',
            'gemini-3.6-flash',
            'gemini-3.7-flash',
        ]) {
            expect(
                resolvePiCapabilities(google, 'google-generative-ai', {
                    model: models[id],
                    catalogHit: true,
                })
            ).toMatchObject({ tools: true, structuredOutput: true, jsonObjectOutput: true });
        }
        for (const id of [
            'gemini-3.1-pro-preview-customtools',
            'gemini-flash-latest',
            'gemini-flash-lite-latest',
        ]) {
            expect(
                resolvePiCapabilities(google, 'google-generative-ai', {
                    model: models[id],
                    catalogHit: true,
                })
            ).toMatchObject({ tools: true, structuredOutput: true, jsonObjectOutput: true });
        }
        expect(
            resolvePiCapabilities(google, 'google-generative-ai', {
                model: unsupported,
                catalogHit: true,
            })
        ).toMatchObject({ tools: true, structuredOutput: true, jsonObjectOutput: true });
    });

    test('disables sampling controls for the Codex subscription backend', () => {
        const codex = getPiProviderDefinition('openai-codex')!;
        const model = getPiCatalogModels('openai-codex').find(
            candidate => candidate.id === 'codex-known'
        )!;

        expect(
            resolvePiCapabilities(codex, 'openai-codex-responses', {
                model,
                catalogHit: true,
            })
        ).toMatchObject({
            structuredOutput: true,
            jsonObjectOutput: true,
            temperature: false,
            sampling: {
                topP: false,
                topK: false,
                frequencyPenalty: false,
                presencePenalty: false,
            },
        });
    });

    test('keeps Codex advanced capabilities optimistic for a manually entered model', () => {
        const codex = getPiProviderDefinition('openai-codex')!;
        const catalogModel = getPiCatalogModels('openai-codex').find(
            candidate => candidate.id === 'codex-known'
        )!;

        expect(
            pickAdvancedCapabilities(
                resolvePiCapabilities(codex, 'openai-codex-responses', {
                    model: { ...structuredClone(catalogModel), id: 'codex-manual' },
                    catalogHit: false,
                })
            )
        ).toEqual({ tools: true, structuredOutput: true, jsonObjectOutput: true });
    });

    test('filters the shut-down Google preview and treats a manual entry as API-level dynamic', () => {
        const google = getPiProviderDefinition('google')!;
        expect(getPiCatalogModels('google').map(model => model.id)).not.toContain(
            'gemini-3.1-flash-lite-preview'
        );

        const retired = resolvePiModel({
            piConfig: {
                provider: 'google',
                api: 'google-generative-ai',
                authType: 'api_key',
                endpoint: '',
                model: 'gemini-3.1-flash-lite-preview',
                contextWindow: 1_000_000,
            },
            maxTokens: 4096,
            apiKey: 'key',
        });
        expect(retired.catalogHit).toBe(false);
        expect(resolvePiCapabilities(google, 'google-generative-ai', retired)).toMatchObject({
            tools: true,
            structuredOutput: true,
            jsonObjectOutput: true,
            imageInput: false,
        });
    });

    test('publishes exact OAuth registrations without request-scoped secrets', () => {
        expect(getPiProviderDefinition('anthropic')!.oauth).toEqual({
            providerId: 'anthropic',
            api: 'anthropic-messages',
            clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
            authorizeUrl: 'https://claude.ai/oauth/authorize',
            tokenUrl: 'https://platform.claude.com/v1/oauth/token',
            redirectUri: 'http://localhost:53692/callback',
            allowedCallbackHosts: ['localhost', '127.0.0.1'],
            scope: 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload',
            exchangeKind: 'json',
            authorizeParams: { code: 'true' },
            tokenParams: {},
            includeStateInTokenRequest: true,
            expirySkewMs: 300_000,
        });
        expect(getPiProviderDefinition('openai-codex')!.oauth).toEqual({
            providerId: 'openai-codex',
            api: 'openai-codex-responses',
            clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
            authorizeUrl: 'https://auth.openai.com/oauth/authorize',
            tokenUrl: 'https://auth.openai.com/oauth/token',
            redirectUri: 'http://localhost:1455/auth/callback',
            allowedCallbackHosts: ['localhost', '127.0.0.1'],
            scope: 'openid profile email offline_access',
            exchangeKind: 'form',
            authorizeParams: {
                id_token_add_organizations: 'true',
                codex_cli_simplified_flow: 'true',
                originator: 'pi',
            },
            tokenParams: {},
            includeStateInTokenRequest: false,
            expirySkewMs: 0,
        });
        expect(JSON.stringify(listPiProviderDefinitions())).not.toMatch(
            /code_verifier|access_token|refresh_token|state/
        );
    });

    test('returns source-scoped catalogs and creates only explicitly allowed lazy APIs', () => {
        expect(getPiCatalogModels('openai').map(model => model.id)).toEqual([
            'gpt-known',
            'gpt-4',
            'gpt-4.1',
            'gpt-4-turbo',
            'gpt-4o-2024-05-13',
            'gpt-5',
            'gpt-realtime-2.1',
            'o1',
            'o3',
            'o3-mini',
            'o4-mini',
            'o3-pro',
            'gpt-5-pro',
            'gpt-5.2-pro',
            'gpt-5.4-pro',
            'gpt-5.5-pro',
        ]);
        expect(getPiCatalogModels('anthropic').map(model => model.id)).toEqual([
            'claude-known',
            'claude-opus-4-6',
            'claude-fable-5',
        ]);
        expect(getPiCatalogModels('google').map(model => model.id)).toEqual([
            'gemini-known',
            'gemini-2.5-flash',
            'deep-research-preview-04-2026',
            'gemini-3-flash-preview',
            'gemini-3.5-flash-lite',
            'gemini-3.6-flash',
            'gemini-3.7-flash',
            'gemini-3.1-pro-preview-customtools',
            'gemini-flash-latest',
            'gemini-flash-lite-latest',
        ]);
        expect(getPiCatalogModels('unknown')).toEqual([]);

        expect(Object.keys(createPiApiImplementations('openai')).sort()).toEqual([
            'openai-completions',
            'openai-responses',
        ]);
        expect(Object.keys(createPiApiImplementations('openai-codex'))).toEqual([
            'openai-codex-responses',
        ]);
        expect(Object.keys(createPiApiImplementations('anthropic'))).toEqual([
            'anthropic-messages',
        ]);
        expect(Object.keys(createPiApiImplementations('google'))).toEqual(['google-generative-ai']);
        expect(createPiApiImplementations('unknown')).toEqual({});
    });
});

describe('pi model resolver', () => {
    test('canonicalizes HTTPS and permits HTTP only for loopback endpoints', () => {
        expect(normalizePiEndpoint(' https://Compatible.Example:443/v1/// ')).toBe(
            'https://compatible.example/v1'
        );
        expect(normalizePiEndpoint('http://localhost:8080/v1/')).toBe('http://localhost:8080/v1');
        expect(normalizePiEndpoint('http://127.0.0.1:8080/v1/')).toBe('http://127.0.0.1:8080/v1');
        expect(normalizePiEndpoint('http://[::1]:8080/v1/')).toBe('http://[::1]:8080/v1');

        for (const endpoint of [
            'http://compatible.example/v1',
            'http://localhost.example/v1',
            'http://192.168.1.10/v1',
            'http://[::2]/v1',
        ]) {
            expect(() => normalizePiEndpoint(endpoint)).toThrow(PiModelResolutionError);
            try {
                normalizePiEndpoint(endpoint);
            } catch (error) {
                expect((error as PiModelResolutionError).code).toBe('invalid_endpoint');
            }
        }
    });

    test('treats an explicitly configured canonical default endpoint as a catalog route', () => {
        const definition = getPiProviderDefinition('openai')!;
        const endpoint = ' HTTPS://API.OPENAI.COM:443/v1/// ';

        expect(isPiDefaultProviderEndpoint(definition, '')).toBe(true);
        expect(isPiDefaultProviderEndpoint(definition, endpoint)).toBe(true);
        expect(
            isPiDefaultProviderEndpoint(
                definition,
                'https://api.openai.com/v1/responses/',
                'openai-responses'
            )
        ).toBe(true);
        expect(isPiDefaultProviderEndpoint(definition, 'https://proxy.example/v1')).toBe(false);
        expect(isPiDefaultProviderEndpoint(definition, 'http://proxy.example/v1')).toBe(false);

        const resolved = resolvePiModel({
            piConfig: { ...OPENAI_CONFIG, endpoint },
            maxTokens: 4096,
            apiKey: 'secret-key',
        });
        expect(resolved.catalogHit).toBe(true);
        expect(resolved.model.baseUrl).toBe('https://api.openai.com/v1');
    });

    test('clones catalog metadata and applies the configured reply-token ceiling', () => {
        const catalogModel = getPiCatalogModels('openai')[0];
        const resolved = resolvePiModel({
            piConfig: OPENAI_CONFIG,
            maxTokens: 10_000,
            apiKey: 'secret-key',
        });

        expect(resolved.catalogHit).toBe(true);
        expect(resolved.model).not.toBe(catalogModel);
        expect(resolved.model).toMatchObject({
            id: 'gpt-known',
            api: 'openai-responses',
            provider: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            contextWindow: 128_000,
            maxTokens: 8192,
        });
        expect(resolved.effectiveContextWindow).toBe(128_000);
        expect(resolved.effectiveMaxTokens).toBe(8192);
        expect(resolved.apiKey).toBe('secret-key');
        expect(catalogModel.maxTokens).toBe(8192);
    });

    test('lets a manual window, selected API, and normalized custom endpoint override a catalog hit', () => {
        const resolved = resolvePiModel({
            piConfig: {
                ...OPENAI_CONFIG,
                api: 'openai-completions',
                endpoint: 'https://compatible.example/v1///',
                contextWindow: 20_000,
            },
            maxTokens: 4000,
            apiKey: 'secret-key',
        });

        expect(resolved.model).toMatchObject({
            id: 'gpt-known',
            api: 'openai-completions',
            provider: 'openai',
            baseUrl: 'https://compatible.example/v1',
            contextWindow: 20_000,
            maxTokens: 4000,
        });
        expect(resolved.model.compat).toBeUndefined();
        expect(resolved.catalogHit).toBe(false);
        expect(resolved.effectiveContextWindow).toBe(20_000);
    });

    test.each([
        [
            'OpenAI Responses',
            'openai-responses',
            'https://openrouter.ai/api/v1/ReSpOnSeS///',
            'https://openrouter.ai/api/v1',
        ],
        [
            'OpenAI Chat Completions',
            'openai-completions',
            'https://openrouter.ai/api/v1/chat/completions/',
            'https://openrouter.ai/api/v1',
        ],
        [
            'legacy OpenAI Completions',
            'openai-completions',
            'https://compatible.example/v1/completions',
            'https://compatible.example/v1',
        ],
        [
            'Anthropic Messages',
            'anthropic-messages',
            'https://compatible.example/v1/messages///',
            'https://compatible.example',
        ],
        [
            'nested Anthropic Messages',
            'anthropic-messages',
            'https://compatible.example/api/v1/messages',
            'https://compatible.example/api',
        ],
        [
            'bare Anthropic Messages',
            'anthropic-messages',
            'https://compatible.example/api/messages',
            'https://compatible.example/api',
        ],
    ] as const)(
        'normalizes a custom %s operation URL to its API base',
        (_label, api, endpoint, expectedBaseUrl) => {
            const provider = api === 'anthropic-messages' ? 'anthropic' : 'openai';
            const resolved = resolvePiModel({
                piConfig: {
                    provider,
                    api,
                    authType: 'api_key',
                    endpoint,
                    model: 'custom-model',
                    contextWindow: 20_000,
                },
                maxTokens: 4000,
                apiKey: 'test-api-key',
            });

            expect(resolved.model.baseUrl).toBe(expectedBaseUrl);
        }
    );

    test('strips only one trailing operation route', () => {
        const resolved = resolvePiModel({
            piConfig: {
                provider: 'openai',
                api: 'openai-responses',
                authType: 'api_key',
                endpoint: 'https://compatible.example/v1/responses/responses',
                model: 'custom-model',
                contextWindow: 20_000,
            },
            maxTokens: 4000,
            apiKey: 'test-api-key',
        });

        expect(resolved.model.baseUrl).toBe('https://compatible.example/v1/responses');
    });

    test.each([
        ['openai-responses', 'openai', 'https://openrouter.ai/api/v1'],
        ['openai-responses', 'openai', 'https://compatible.example/responses-proxy'],
        ['openai-completions', 'openai', 'https://compatible.example/v1'],
        ['anthropic-messages', 'anthropic', 'https://compatible.example/api'],
    ] as const)('accepts a custom %s API base URL', (api, provider, endpoint) => {
        const resolved = resolvePiModel({
            piConfig: {
                provider,
                api,
                authType: 'api_key',
                endpoint,
                model: 'custom-model',
                contextWindow: 20_000,
            },
            maxTokens: 4000,
            apiKey: 'test-api-key',
        });

        expect(resolved.model.baseUrl).toBe(endpoint);
    });

    test('requires manual metadata for a catalog-named model on a custom endpoint', () => {
        expectResolutionError(
            {
                piConfig: {
                    ...OPENAI_CONFIG,
                    endpoint: 'https://compatible.example/v1',
                    contextWindow: 0,
                },
                maxTokens: 4000,
                apiKey: 'secret-key',
            },
            'missing_context_window'
        );

        const resolved = resolvePiModel({
            piConfig: {
                ...OPENAI_CONFIG,
                endpoint: 'https://compatible.example/v1',
                contextWindow: 20_000,
            },
            maxTokens: 4000,
            apiKey: 'secret-key',
        });

        expect(resolved.catalogHit).toBe(false);
        expect(resolved.model).toMatchObject({
            id: 'gpt-known',
            baseUrl: 'https://compatible.example/v1',
            contextWindow: 20_000,
            maxTokens: 4000,
        });
    });

    test('supports an Anthropic-compatible API-key endpoint without relaxing OAuth endpoints', () => {
        const resolved = resolvePiModel({
            piConfig: {
                provider: 'anthropic',
                api: 'anthropic-messages',
                authType: 'api_key',
                endpoint: 'https://openrouter.ai/api///',
                model: 'openrouter/free',
                contextWindow: 200_000,
            },
            maxTokens: 256,
            apiKey: 'secret-key',
        });

        expect(resolved).toMatchObject({
            authType: 'api_key',
            catalogHit: false,
            definition: { key: 'anthropic' },
        });
        expect(resolved.model).toMatchObject({
            id: 'openrouter/free',
            api: 'anthropic-messages',
            provider: 'anthropic',
            baseUrl: 'https://openrouter.ai/api',
            contextWindow: 200_000,
            maxTokens: 256,
        });
    });

    test('rejects a catalog model on a different API at the provider default endpoint', () => {
        expectResolutionError(
            {
                piConfig: {
                    ...OPENAI_CONFIG,
                    api: 'openai-completions',
                    contextWindow: 20_000,
                },
                maxTokens: 4000,
                apiKey: 'secret-key',
            },
            'unsupported_api'
        );
    });

    test('reuses catalog window metadata for an explicitly supported Chat Completions model', () => {
        const resolved = resolvePiModel({
            piConfig: {
                ...OPENAI_CONFIG,
                api: 'openai-completions',
                model: 'gpt-4.1',
            },
            maxTokens: 4096,
            apiKey: 'secret-key',
        });

        expect(resolved.catalogHit).toBe(true);
        expect(resolved.model).toMatchObject({
            id: 'gpt-4.1',
            api: 'openai-completions',
            baseUrl: 'https://api.openai.com/v1',
            contextWindow: 1_047_576,
            maxTokens: 4096,
        });
    });

    test.each(['o1', 'o3', 'o3-mini', 'o4-mini'])(
        'recognizes %s as an explicitly supported Chat Completions catalog model',
        modelId => {
            const resolved = resolvePiModel({
                piConfig: {
                    ...OPENAI_CONFIG,
                    api: 'openai-completions',
                    model: modelId,
                },
                maxTokens: 4096,
                apiKey: 'secret-key',
            });

            expect(resolved.catalogHit).toBe(true);
            expect(resolved.model).toMatchObject({
                id: modelId,
                api: 'openai-completions',
                baseUrl: 'https://api.openai.com/v1',
                contextWindow: 200_000,
                maxTokens: 4096,
            });
        }
    );

    test('builds an explicit zero-cost model for an unknown OpenAI-compatible model', () => {
        const resolved = resolvePiModel({
            piConfig: {
                ...OPENAI_CONFIG,
                endpoint: 'http://127.0.0.1:8080/v1/',
                model: 'local-model',
                contextWindow: 16_384,
            },
            maxTokens: 4096,
            apiKey: 'local-key',
        });

        expect(resolved.catalogHit).toBe(false);
        expect(resolved.model).toEqual({
            id: 'local-model',
            name: 'local-model',
            api: 'openai-responses',
            provider: 'openai',
            baseUrl: 'http://127.0.0.1:8080/v1',
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 16_384,
            maxTokens: 4096,
        });
    });

    test('allows only the registered OAuth API and never requires an API key for it', () => {
        const resolved = resolvePiModel({
            piConfig: {
                provider: 'openai-codex',
                api: 'openai-codex-responses',
                authType: 'oauth',
                endpoint: '',
                model: 'codex-known',
                contextWindow: 0,
            },
            maxTokens: 8192,
        });

        expect(resolved.authType).toBe('oauth');
        expect(resolved.apiKey).toBeUndefined();
        expect(resolved.model).toMatchObject({
            provider: 'openai-codex',
            api: 'openai-codex-responses',
            baseUrl: 'https://chatgpt.com/backend-api',
        });
    });

    test.each<
        [string, Partial<typeof OPENAI_CONFIG>, unknown, unknown, PiModelResolutionErrorCode]
    >([
        ['unknown provider', { provider: 'other' }, 1024, 'key', 'unknown_provider'],
        ['unsupported API', { api: 'anthropic-messages' }, 1024, 'key', 'unsupported_api'],
        ['unsupported auth', { authType: 'oauth' }, 1024, undefined, 'unsupported_auth'],
        ['missing model', { model: '' }, 1024, 'key', 'missing_model'],
        ['fractional context', { contextWindow: 1.5 }, 1024, 'key', 'invalid_context_window'],
        [
            'unknown model without context',
            { model: 'unknown', contextWindow: 0 },
            1024,
            'key',
            'missing_context_window',
        ],
        ['zero max tokens', {}, 0, 'key', 'invalid_max_tokens'],
        ['fractional max tokens', {}, 1.5, 'key', 'invalid_max_tokens'],
        [
            'reply tokens above context',
            { contextWindow: 1000 },
            1001,
            'key',
            'max_tokens_exceed_context',
        ],
        ['missing API key', {}, 1024, '   ', 'missing_api_key'],
        [
            'invalid endpoint scheme',
            { endpoint: 'ftp://compatible.example/v1' },
            1024,
            'key',
            'invalid_endpoint',
        ],
        [
            'endpoint query',
            { endpoint: 'https://compatible.example/v1?secret=no' },
            1024,
            'key',
            'invalid_endpoint',
        ],
        [
            'remote plaintext endpoint',
            { endpoint: 'http://compatible.example/v1' },
            1024,
            'key',
            'invalid_endpoint',
        ],
    ])('rejects %s before dispatch', (_label, overrides, maxTokens, apiKey, expectedCode) => {
        expectResolutionError(
            { piConfig: { ...OPENAI_CONFIG, ...overrides }, maxTokens, apiKey },
            expectedCode
        );
    });

    test('rejects fixed-provider endpoints and OAuth endpoint/API substitutions', () => {
        expectResolutionError(
            {
                piConfig: {
                    provider: 'google',
                    api: 'google-generative-ai',
                    authType: 'api_key',
                    endpoint: 'https://proxy.example',
                    model: 'gemini-known',
                    contextWindow: 0,
                },
                maxTokens: 4096,
                apiKey: 'key',
            },
            'custom_endpoint_not_allowed'
        );
        expectResolutionError(
            {
                piConfig: {
                    provider: 'anthropic',
                    api: 'anthropic-messages',
                    authType: 'oauth',
                    endpoint: 'https://proxy.example',
                    model: 'claude-known',
                    contextWindow: 0,
                },
                maxTokens: 4096,
            },
            'oauth_endpoint_not_allowed'
        );
        expectResolutionError(
            {
                piConfig: {
                    provider: 'openai-codex',
                    api: 'openai-responses',
                    authType: 'oauth',
                    endpoint: '',
                    model: 'codex-known',
                    contextWindow: 0,
                },
                maxTokens: 4096,
            },
            'unsupported_api'
        );
    });

    test('reads only the nested pi block plus the existing key and reply-token settings', () => {
        const resolved = resolvePiModelFromExtraModelSettings({
            密钥: 'nested-adapter-key',
            最大回复token数: 2048,
            pi: OPENAI_CONFIG,
            unrelated: { provider: 'anthropic', key: 'must-not-be-read' },
        });

        expect(resolved.model.id).toBe('gpt-known');
        expect(resolved.effectiveMaxTokens).toBe(2048);
        expect(resolved.apiKey).toBe('nested-adapter-key');
    });
});
