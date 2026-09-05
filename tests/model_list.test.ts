jest.mock('@/function/update/pi/pi_gateway', () => {
    const streams = () => ({ stream: jest.fn(), streamSimple: jest.fn() });
    const catalogModel = (provider: string, api: string, id: string, baseUrl: string) => ({
        id,
        name: id,
        provider,
        api,
        baseUrl,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 16_000,
    });
    return {
        createModels: jest.fn(),
        createProvider: jest.fn(),
        OPENAI_MODELS: {
            'responses-only': catalogModel(
                'openai',
                'openai-responses',
                'responses-only',
                'https://api.openai.com/v1'
            ),
        },
        OPENAI_CODEX_MODELS: {},
        ANTHROPIC_MODELS: {},
        GOOGLE_MODELS: {},
        FIREWORKS_MODELS: {},
        GITHUB_COPILOT_MODELS: {
            'copilot-anthropic': catalogModel(
                'github-copilot',
                'anthropic-messages',
                'copilot-anthropic',
                'https://api.individual.githubcopilot.com'
            ),
            'copilot-responses': catalogModel(
                'github-copilot',
                'openai-responses',
                'copilot-responses',
                'https://api.individual.githubcopilot.com'
            ),
        },
        MISTRAL_MODELS: {},
        OPENCODE_MODELS: {
            'opencode-anthropic': catalogModel(
                'opencode',
                'anthropic-messages',
                'opencode-anthropic',
                'https://opencode.ai/zen'
            ),
            'opencode-google': catalogModel(
                'opencode',
                'google-generative-ai',
                'opencode-google',
                'https://opencode.ai/zen/v1'
            ),
        },
        OPENCODE_GO_MODELS: {},
        VERCEL_AI_GATEWAY_MODELS: {},
        openAIResponsesApi: jest.fn(streams),
        openAICompletionsApi: jest.fn(streams),
        openAICodexResponsesApi: jest.fn(streams),
        anthropicMessagesApi: jest.fn(streams),
        googleGenerativeAIApi: jest.fn(streams),
        mistralConversationsApi: jest.fn(streams),
    };
});
jest.mock('@/function/update/pi/credential_store', () => ({
    getPiCredentialStore: jest.fn(),
}));
jest.mock('@/function/update/pi/oauth', () => ({
    getBrowserOAuthAuth: jest.fn(),
}));

import { getPiCredentialStore } from '@/function/update/pi/credential_store';
import {
    fetchOpenAICompatibleModelList,
    fetchPiModelList,
    ModelListFetchError,
    resolvePiModelListOAuthCredential,
} from '@/function/update/model_list';
import { getBrowserOAuthAuth } from '@/function/update/pi/oauth';
import { createModels, createProvider } from '@/function/update/pi/pi_gateway';
import { getPiProviderDefinition } from '@/function/update/pi/provider_registry';
import { PiProxyUnavailableError } from '@/function/update/pi/sillytavern_proxy';

type FetchMock = jest.Mock<Promise<Response>, [RequestInfo | URL, RequestInit?]>;

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: jest.fn().mockResolvedValue(body),
    } as unknown as Response;
}

function invalidJsonResponse(): Response {
    return {
        ok: true,
        status: 200,
        json: jest.fn().mockRejectedValue(new SyntaxError('invalid JSON with secret-value')),
    } as unknown as Response;
}

function textResponse(body: string, status: number): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: jest.fn().mockResolvedValue(body),
    } as unknown as Response;
}

function proxyEnabledResponse(): Response {
    return textResponse('mvu-st-cors-proxy-probe', 200);
}

function proxyDisabledResponse(): Response {
    return textResponse(
        'CORS proxy is disabled. Enable it in config.yaml or use the --corsProxy flag.',
        404
    );
}

function proxiedTarget(call: unknown[]): URL {
    const value = String(call[0]);
    expect(value).toMatch(/^\/proxy\//);
    return new URL(decodeURIComponent(value.slice('/proxy/'.length)));
}

function requestUrl(call: unknown[]): URL {
    return new URL(String(call[0]));
}

function requestInit(call: unknown[]): RequestInit {
    return (call[1] ?? {}) as RequestInit;
}

describe('extra-model model-list discovery', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test.each([
        ['', ['new-model']],
        ['https://api.openai.com/v1/chat/completions/', ['new-model']],
        ['https://custom.example/v1', ['new-model', 'responses-only']],
    ])(
        'filters catalog API conflicts only at the registered endpoint: %s',
        async (endpoint, expected) => {
            const fetchMock: FetchMock = jest
                .fn()
                .mockResolvedValue(
                    jsonResponse({ data: [{ id: 'responses-only' }, { id: 'new-model' }] })
                );

            await expect(
                fetchPiModelList(
                    {
                        provider: 'openai',
                        api: 'openai-completions',
                        authType: 'api_key',
                        endpoint,
                        apiKey: 'test-key',
                    },
                    { fetch: fetchMock }
                )
            ).resolves.toEqual(expected);
        }
    );

    test('uses the Custom/ST discovery contract and normalizes returned ids', async () => {
        const signal = new AbortController().signal;
        const request_headers = { 'X-CSRF-Token': 'csrf-token' };
        const fetchMock: FetchMock = jest.fn().mockResolvedValue(
            jsonResponse({
                data: [
                    { id: ' model-z ' },
                    { name: 'model-a' },
                    { id: 'model-a' },
                    { id: '' },
                    null,
                ],
            })
        );

        await expect(
            fetchOpenAICompatibleModelList(
                ' https://proxy.example/v1/models/ ',
                'api-key-secret',
                signal,
                {
                    fetch: fetchMock,
                    sillyTavernRequestHeaders: () => request_headers,
                }
            )
        ).resolves.toEqual(['model-a', 'model-z']);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith('/api/backends/chat-completions/status', {
            method: 'POST',
            headers: request_headers,
            body: JSON.stringify({
                reverse_proxy: 'https://proxy.example/v1',
                proxy_password: 'api-key-secret',
                chat_completion_source: 'openai',
            }),
            cache: 'no-cache',
            signal,
        });
    });

    test('does not request Custom/ST discovery when the base URL is empty', async () => {
        const fetchMock: FetchMock = jest.fn();
        await expect(
            fetchOpenAICompatibleModelList('  ', 'unused', undefined, { fetch: fetchMock })
        ).resolves.toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test.each([
        ['openai-responses', 'https://proxy.example/v1/responses/'],
        ['openai-completions', 'https://proxy.example/v1/chat/completions'],
    ] as const)(
        'normalizes an OpenAI %s operation URL before passing it to ST',
        async (api, endpoint) => {
            const fetchMock: FetchMock = jest
                .fn()
                .mockResolvedValue(jsonResponse({ data: [{ id: 'gpt-test' }] }));

            await expect(
                fetchPiModelList(
                    {
                        provider: 'openai',
                        api,
                        authType: 'api_key',
                        endpoint,
                        apiKey: 'openai-secret',
                    },
                    { fetch: fetchMock }
                )
            ).resolves.toEqual(['gpt-test']);

            const body = JSON.parse(requestInit(fetchMock.mock.calls[0]).body as string);
            expect(body).toEqual({
                reverse_proxy: 'https://proxy.example/v1',
                proxy_password: 'openai-secret',
                chat_completion_source: 'openai',
            });
        }
    );

    test('uses the ST Custom status path when More-source request headers are configured', async () => {
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValue(jsonResponse({ data: [{ id: 'tenant-model' }] }));

        await expect(
            fetchPiModelList(
                {
                    provider: 'openai',
                    api: 'openai-responses',
                    authType: 'api_key',
                    endpoint: 'https://tenant.example/v1/responses',
                    apiKey: 'tenant-secret',
                    customHeaders: 'X-Tenant: alpha\nAccept: null',
                },
                { fetch: fetchMock }
            )
        ).resolves.toEqual(['tenant-model']);

        const body = JSON.parse(requestInit(fetchMock.mock.calls[0]).body as string);
        expect(body).toMatchObject({
            custom_url: 'https://tenant.example/v1',
            chat_completion_source: 'custom',
        });
        expect(JSON.parse(body.custom_include_headers)).toEqual({
            'X-Tenant': 'alpha',
            Authorization: 'Bearer tenant-secret',
        });
        expect(body).not.toHaveProperty('proxy_password');
    });

    test('routes a built-in OpenAI-compatible provider through its protocol-specific base URL', async () => {
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValue(jsonResponse({ data: [{ id: 'accounts/fireworks/model-a' }] }));

        await expect(
            fetchPiModelList(
                {
                    provider: 'fireworks',
                    api: 'openai-completions',
                    authType: 'api_key',
                    endpoint: '',
                    apiKey: 'fireworks-secret',
                    useProxy: true,
                },
                { fetch: fetchMock }
            )
        ).resolves.toEqual(['accounts/fireworks/model-a']);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/backends/chat-completions/status');
        expect(JSON.parse(requestInit(fetchMock.mock.calls[0]).body as string)).toEqual({
            reverse_proxy: 'https://api.fireworks.ai/inference/v1',
            proxy_password: 'fireworks-secret',
            chat_completion_source: 'openai',
        });
    });

    test('uses Fireworks OpenAI discovery even when generation uses Anthropic Messages', async () => {
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValueOnce(proxyEnabledResponse())
            .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'fireworks-model' }] }));

        await expect(
            fetchPiModelList(
                {
                    provider: 'fireworks',
                    api: 'anthropic-messages',
                    authType: 'api_key',
                    endpoint: '',
                    apiKey: 'fireworks-secret',
                    useProxy: false,
                },
                { fetch: fetchMock }
            )
        ).resolves.toEqual(['fireworks-model']);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toBe(
            `/proxy/${encodeURIComponent('data:text/plain,mvu-st-cors-proxy-probe')}`
        );
        expect(fetchMock.mock.calls[1][0]).toBe('/api/backends/chat-completions/status');
        expect(JSON.parse(requestInit(fetchMock.mock.calls[1]).body as string)).toEqual({
            reverse_proxy: 'https://api.fireworks.ai/inference/v1',
            proxy_password: 'fireworks-secret',
            chat_completion_source: 'openai',
        });
    });

    test('uses OpenAI-shaped discovery for OpenCode Google and filters known other-API ids', async () => {
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValueOnce(proxyEnabledResponse())
            .mockResolvedValueOnce(
                jsonResponse({
                    data: [
                        { id: 'opencode-anthropic' },
                        { id: 'opencode-google' },
                        { id: 'new-google-model' },
                    ],
                })
            );

        await expect(
            fetchPiModelList(
                {
                    provider: 'opencode',
                    api: 'google-generative-ai',
                    authType: 'api_key',
                    endpoint: '',
                    apiKey: 'opencode-secret',
                },
                { fetch: fetchMock }
            )
        ).resolves.toEqual(['new-google-model', 'opencode-google']);

        expect(fetchMock.mock.calls[1][0]).toBe('/api/backends/chat-completions/status');
        expect(JSON.parse(requestInit(fetchMock.mock.calls[1]).body as string)).toEqual({
            reverse_proxy: 'https://opencode.ai/zen/v1',
            proxy_password: 'opencode-secret',
            chat_completion_source: 'openai',
        });
    });

    test('uses the Copilot model route, bearer auth, and required client headers through ST', async () => {
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValueOnce(proxyEnabledResponse())
            .mockResolvedValueOnce(
                jsonResponse({
                    data: [
                        { id: 'copilot-anthropic' },
                        { id: 'copilot-responses' },
                        { id: 'new-copilot-model' },
                    ],
                })
            );

        await expect(
            fetchPiModelList(
                {
                    provider: 'github-copilot',
                    api: 'anthropic-messages',
                    authType: 'api_key',
                    endpoint: '',
                    apiKey: 'copilot-token',
                },
                { fetch: fetchMock }
            )
        ).resolves.toEqual(['copilot-anthropic', 'new-copilot-model']);

        expect(fetchMock.mock.calls[1][0]).toBe('/api/backends/chat-completions/status');
        const body = JSON.parse(requestInit(fetchMock.mock.calls[1]).body as string);
        expect(body).toMatchObject({
            custom_url: 'https://api.individual.githubcopilot.com',
            chat_completion_source: 'custom',
        });
        expect(JSON.parse(body.custom_include_headers)).toEqual({
            'User-Agent': 'GitHubCopilotChat/0.35.0',
            'Editor-Version': 'vscode/1.107.0',
            'Editor-Plugin-Version': 'copilot-chat/0.35.0',
            'Copilot-Integration-Id': 'vscode-chat',
            'X-GitHub-Api-Version': '2026-06-01',
            Authorization: 'Bearer copilot-token',
        });
    });

    test('uses the Vercel AI Gateway OpenAI model catalog through ST', async () => {
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValue(jsonResponse({ data: [{ id: 'provider/model' }] }));

        await expect(
            fetchPiModelList(
                {
                    provider: 'vercel-ai-gateway',
                    api: 'anthropic-messages',
                    authType: 'api_key',
                    endpoint: '',
                    apiKey: 'vercel-secret',
                },
                { fetch: fetchMock }
            )
        ).resolves.toEqual(['provider/model']);

        expect(JSON.parse(requestInit(fetchMock.mock.calls[0]).body as string)).toEqual({
            reverse_proxy: 'https://ai-gateway.vercel.sh/v1',
            proxy_password: 'vercel-secret',
            chat_completion_source: 'openai',
        });
    });

    test('fetches Mistral models directly with bearer authentication', async () => {
        const signal = new AbortController().signal;
        const fetchMock: FetchMock = jest.fn().mockResolvedValue(
            jsonResponse({
                data: [{ id: ' mistral-z ' }, { name: 'mistral-a' }, { id: 'mistral-a' }],
            })
        );

        await expect(
            fetchPiModelList(
                {
                    provider: 'mistral',
                    api: 'mistral-conversations',
                    authType: 'api_key',
                    endpoint: '',
                    apiKey: 'mistral-secret',
                    customHeaders: '{"X-Tenant":"alpha"}',
                    signal,
                },
                { fetch: fetchMock }
            )
        ).resolves.toEqual(['mistral-a', 'mistral-z']);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.mistral.ai/v1/models');
        const init = requestInit(fetchMock.mock.calls[0]);
        expect(init.method).toBe('GET');
        expect(init.cache).toBe('no-store');
        expect(init.credentials).toBe('omit');
        expect(init.redirect).toBe('error');
        expect(init.referrerPolicy).toBe('no-referrer');
        expect(init.signal).toBe(signal);
        expect(init.headers).toMatchObject({
            Accept: 'application/json',
            'X-Tenant': 'alpha',
            Authorization: 'Bearer mistral-secret',
        });
    });

    test('paginates the official Anthropic model endpoint with direct-browser API-key headers', async () => {
        const signal = new AbortController().signal;
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValueOnce(
                jsonResponse({
                    data: [{ id: 'claude-z' }, { name: 'claude-a' }],
                    has_more: true,
                    last_id: 'cursor-one',
                })
            )
            .mockResolvedValueOnce(
                jsonResponse({
                    data: [{ id: 'claude-a' }, { id: 'claude-m' }],
                    has_more: false,
                })
            );

        await expect(
            fetchPiModelList(
                {
                    provider: 'anthropic',
                    api: 'anthropic-messages',
                    authType: 'api_key',
                    endpoint: '',
                    apiKey: 'anthropic-secret',
                    signal,
                },
                { fetch: fetchMock }
            )
        ).resolves.toEqual(['claude-a', 'claude-m', 'claude-z']);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const first_url = requestUrl(fetchMock.mock.calls[0]);
        expect(first_url.origin + first_url.pathname).toBe('https://api.anthropic.com/v1/models');
        expect(first_url.searchParams.get('limit')).toBe('100');
        expect(first_url.searchParams.has('after_id')).toBe(false);
        const second_url = requestUrl(fetchMock.mock.calls[1]);
        expect(second_url.searchParams.get('after_id')).toBe('cursor-one');

        for (const call of fetchMock.mock.calls) {
            const init = requestInit(call);
            expect(init.method).toBe('GET');
            expect(init.cache).toBe('no-store');
            expect(init.credentials).toBe('omit');
            expect(init.redirect).toBe('error');
            expect(init.referrerPolicy).toBe('no-referrer');
            expect(init.signal).toBe(signal);
            expect(init.headers).toMatchObject({
                Accept: 'application/json',
                'x-api-key': 'anthropic-secret',
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            });
            expect(init.headers).not.toHaveProperty('Authorization');
        }
    });

    test('uses the generic ST proxy for direct discovery when a custom endpoint opts in', async () => {
        const signal = new AbortController().signal;
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValueOnce(proxyEnabledResponse())
            .mockResolvedValueOnce(
                jsonResponse({ data: [{ id: 'claude-tenant' }], has_more: false })
            );

        await expect(
            fetchPiModelList(
                {
                    provider: 'anthropic',
                    api: 'anthropic-messages',
                    authType: 'api_key',
                    endpoint: 'https://tenant.example/anthropic/v1/messages',
                    apiKey: 'tenant-secret',
                    useProxy: true,
                    signal,
                },
                { fetch: fetchMock }
            )
        ).resolves.toEqual(['claude-tenant']);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toBe(
            `/proxy/${encodeURIComponent('data:text/plain,mvu-st-cors-proxy-probe')}`
        );
        const target = proxiedTarget(fetchMock.mock.calls[1]);
        expect(target.origin + target.pathname).toBe('https://tenant.example/anthropic/v1/models');
        expect(target.searchParams.get('limit')).toBe('100');
        const init = requestInit(fetchMock.mock.calls[1]);
        expect(init.method).toBe('GET');
        expect(init.credentials).toBe('same-origin');
        expect(init.signal).toBe(signal);
        expect(init.headers).toMatchObject({
            'x-api-key': 'tenant-secret',
            'anthropic-version': '2023-06-01',
        });
    });

    test('throws PiProxyUnavailableError before model discovery when ST proxy is disabled', async () => {
        const fetchMock: FetchMock = jest.fn().mockResolvedValue(proxyDisabledResponse());

        await expect(
            fetchPiModelList(
                {
                    provider: 'anthropic',
                    api: 'anthropic-messages',
                    authType: 'api_key',
                    endpoint: 'https://tenant.example/anthropic/v1/messages',
                    apiKey: 'tenant-secret',
                    useProxy: true,
                },
                { fetch: fetchMock }
            )
        ).rejects.toEqual(expect.any(PiProxyUnavailableError));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe(
            `/proxy/${encodeURIComponent('data:text/plain,mvu-st-cors-proxy-probe')}`
        );
    });

    test('uses bearer and OAuth beta headers for official Anthropic OAuth discovery', async () => {
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValue(jsonResponse({ data: [], has_more: false }));

        await fetchPiModelList(
            {
                provider: 'anthropic',
                api: 'anthropic-messages',
                authType: 'oauth',
                endpoint: '',
                oauthCredential: {
                    accessToken: 'oauth-access-secret',
                    expiresAt: 1_800_000_000_000,
                },
            },
            { fetch: fetchMock }
        );

        expect(requestInit(fetchMock.mock.calls[0]).headers).toMatchObject({
            Authorization: 'Bearer oauth-access-secret',
            'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
            'anthropic-version': '2023-06-01',
            'x-app': 'cli',
        });
        expect(requestInit(fetchMock.mock.calls[0]).headers).not.toHaveProperty('x-api-key');
    });

    test('maps a full OpenRouter Anthropic messages URL to the ST OpenAI-compatible model base', async () => {
        const request_headers = { 'X-CSRF-Token': 'csrf-token' };
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValue(jsonResponse({ data: [{ id: 'anthropic/claude-test' }] }));

        await expect(
            fetchPiModelList(
                {
                    provider: 'anthropic',
                    api: 'anthropic-messages',
                    authType: 'api_key',
                    endpoint: 'https://openrouter.ai/api/v1/messages',
                    apiKey: 'openrouter-secret',
                },
                {
                    fetch: fetchMock,
                    sillyTavernRequestHeaders: () => request_headers,
                }
            )
        ).resolves.toEqual(['anthropic/claude-test']);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/backends/chat-completions/status');
        expect(requestInit(fetchMock.mock.calls[0]).headers).toBe(request_headers);
        expect(JSON.parse(requestInit(fetchMock.mock.calls[0]).body as string)).toEqual({
            reverse_proxy: 'https://openrouter.ai/api/v1',
            proxy_password: 'openrouter-secret',
            chat_completion_source: 'openai',
        });
    });

    test('paginates Google models, filters unsupported methods, and removes the models/ prefix', async () => {
        const signal = new AbortController().signal;
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValueOnce(
                jsonResponse({
                    models: [
                        {
                            name: 'models/gemini-z',
                            supportedGenerationMethods: ['generateContent'],
                        },
                        {
                            name: 'models/embedding-only',
                            supportedGenerationMethods: ['embedContent'],
                        },
                        { name: 'models/gemini-no-method-metadata' },
                    ],
                    nextPageToken: 'page-two',
                })
            )
            .mockResolvedValueOnce(
                jsonResponse({
                    models: [
                        {
                            name: ' models/gemini-a ',
                            supportedGenerationMethods: ['generateContent'],
                        },
                        {
                            name: 'models/gemini-z',
                            supportedGenerationMethods: ['generateContent'],
                        },
                    ],
                })
            );

        await expect(
            fetchPiModelList(
                {
                    provider: 'google',
                    api: 'google-generative-ai',
                    authType: 'api_key',
                    endpoint: '',
                    apiKey: 'google-secret',
                    signal,
                },
                { fetch: fetchMock }
            )
        ).resolves.toEqual(['gemini-a', 'gemini-no-method-metadata', 'gemini-z']);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const first_url = requestUrl(fetchMock.mock.calls[0]);
        expect(first_url.origin + first_url.pathname).toBe(
            'https://generativelanguage.googleapis.com/v1beta/models'
        );
        expect(first_url.searchParams.get('pageSize')).toBe('1000');
        expect(first_url.searchParams.has('pageToken')).toBe(false);
        expect(first_url.search).not.toContain('google-secret');
        expect(requestUrl(fetchMock.mock.calls[1]).searchParams.get('pageToken')).toBe('page-two');
        for (const call of fetchMock.mock.calls) {
            const init = requestInit(call);
            expect(init.method).toBe('GET');
            expect(init.cache).toBe('no-store');
            expect(init.credentials).toBe('omit');
            expect(init.redirect).toBe('error');
            expect(init.referrerPolicy).toBe('no-referrer');
            expect(init.signal).toBe(signal);
            expect(init.headers).toMatchObject({
                Accept: 'application/json',
                'x-goog-api-key': 'google-secret',
            });
        }
    });

    test('keeps only list-visible Codex subscription entries and sends OAuth account headers', async () => {
        const signal = new AbortController().signal;
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValueOnce(proxyEnabledResponse())
            .mockResolvedValueOnce(
                jsonResponse({
                    models: [
                        { slug: 'gpt-codex-z', supported_in_api: false, visibility: 'list' },
                        { id: 'gpt-codex-a', visibility: 'list' },
                        { slug: 'hidden', visibility: 'hide' },
                        { slug: 'internal', visibility: 'none' },
                        { slug: 'missing-visibility' },
                        null,
                    ],
                })
            );

        await expect(
            fetchPiModelList(
                {
                    provider: 'openai-codex',
                    api: 'openai-codex-responses',
                    authType: 'oauth',
                    endpoint: '',
                    oauthCredential: {
                        accessToken: 'codex-access-secret',
                        accountId: 'account-123',
                        expiresAt: 1_800_000_000_000,
                    },
                    signal,
                },
                { fetch: fetchMock }
            )
        ).resolves.toEqual(['gpt-codex-a', 'gpt-codex-z']);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const url = proxiedTarget(fetchMock.mock.calls[1]);
        expect(url.origin + url.pathname).toBe('https://chatgpt.com/backend-api/codex/models');
        expect(url.searchParams.get('client_version')).toBe('0.144.0');
        const init = requestInit(fetchMock.mock.calls[1]);
        expect(init.method).toBe('GET');
        expect(init.credentials).toBe('same-origin');
        expect(init.signal).toBe(signal);
        expect(init.headers).toMatchObject({
            Accept: 'application/json',
            Authorization: 'Bearer codex-access-secret',
            'chatgpt-account-id': 'account-123',
            originator: 'pi',
        });
    });

    test('rejects Codex discovery without both OAuth token and account id before fetching', async () => {
        const fetchMock: FetchMock = jest.fn();
        await expect(
            fetchPiModelList(
                {
                    provider: 'openai-codex',
                    api: 'openai-codex-responses',
                    authType: 'oauth',
                    endpoint: '',
                    oauthCredential: {
                        accessToken: 'token-without-account',
                        expiresAt: 1_800_000_000_000,
                    },
                },
                { fetch: fetchMock }
            )
        ).rejects.toMatchObject({
            name: 'ModelListFetchError',
            message: 'Sign in to OpenAI Codex before fetching the model list.',
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test.each([
        ['HTTP errors', jsonResponse({ error: 'response-secret' }, 401), /HTTP 401/],
        ['invalid JSON', invalidJsonResponse(), /not valid JSON/],
        ['a missing model array', jsonResponse({ data: {} }), /model array/],
    ])('fails safely on %s', async (_case, response, expected_message) => {
        const fetchMock: FetchMock = jest.fn().mockResolvedValue(response);
        await expect(
            fetchOpenAICompatibleModelList(
                'https://proxy.example/v1',
                'request-secret',
                undefined,
                {
                    fetch: fetchMock,
                }
            )
        ).rejects.toEqual(expect.any(ModelListFetchError));
        await expect(
            fetchOpenAICompatibleModelList(
                'https://proxy.example/v1',
                'request-secret',
                undefined,
                {
                    fetch: jest.fn().mockResolvedValue(response),
                }
            )
        ).rejects.toThrow(expected_message);
    });

    test('wraps low-level network failures without reflecting their details or credentials', async () => {
        const fetchMock: FetchMock = jest
            .fn()
            .mockRejectedValue(new TypeError('CORS failure for request-secret'));

        try {
            await fetchPiModelList(
                {
                    provider: 'openai',
                    api: 'openai-responses',
                    authType: 'api_key',
                    endpoint: '',
                    apiKey: 'request-secret',
                },
                { fetch: fetchMock }
            );
            throw new Error('expected model-list discovery to fail');
        } catch (error) {
            expect(error).toBeInstanceOf(ModelListFetchError);
            expect(String(error)).toContain('could not be completed');
            expect(String(error)).not.toContain('request-secret');
            expect(String(error)).not.toContain('CORS failure');
        }
    });

    test.each([
        [
            'Anthropic',
            {
                provider: 'anthropic',
                api: 'anthropic-messages',
                authType: 'api_key',
                endpoint: '',
                apiKey: 'key',
            },
            { data: [], has_more: true, last_id: 'same-cursor' },
            { data: [], has_more: true, last_id: 'same-cursor' },
        ],
        [
            'Google',
            {
                provider: 'google',
                api: 'google-generative-ai',
                authType: 'api_key',
                endpoint: '',
                apiKey: 'key',
            },
            { models: [], nextPageToken: 'same-cursor' },
            { models: [], nextPageToken: 'same-cursor' },
        ],
    ])('rejects repeated %s pagination cursors', async (_provider, input, first, second) => {
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValueOnce(jsonResponse(first))
            .mockResolvedValueOnce(jsonResponse(second));
        await expect(fetchPiModelList(input, { fetch: fetchMock })).rejects.toThrow(
            /invalid pagination/
        );
    });

    test('refreshes saved credentials without prior generation when AbortSignal statics are missing', async () => {
        const descriptors = Object.getOwnPropertyDescriptors(AbortSignal);
        jest.useFakeTimers();
        Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
        Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: undefined });
        const stored = {
            type: 'oauth',
            access: 'expired',
            refresh: 'saved-refresh',
            expires: 0,
        };
        const models = {
            setProvider: jest.fn(),
            getAuth: jest.fn(async (_provider, { signal }) => {
                // The pinned pi getAuth refresh path uses both primitives before refreshing.
                const refresh_signal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
                refresh_signal.throwIfAborted();
                stored.access = 'refreshed';
                stored.expires = Date.now() + 3_600_000;
            }),
        };
        jest.mocked(createModels).mockReturnValue(models as never);
        jest.mocked(createProvider).mockImplementation(options => options as never);
        jest.mocked(getBrowserOAuthAuth).mockReturnValue({} as never);
        jest.mocked(getPiCredentialStore).mockReturnValue({
            read: jest.fn(async () => stored),
        } as never);
        try {
            await expect(
                resolvePiModelListOAuthCredential(
                    getPiProviderDefinition('openai-codex')!,
                    new AbortController().signal
                )
            ).resolves.toEqual({ accessToken: 'refreshed', expiresAt: stored.expires });
            expect(models.getAuth).toHaveBeenCalledTimes(1);
        } finally {
            for (const key of ['any', 'timeout'] as const) {
                Reflect.deleteProperty(AbortSignal, key);
                if (descriptors[key]) Object.defineProperty(AbortSignal, key, descriptors[key]);
            }
            jest.clearAllTimers();
            jest.useRealTimers();
        }
    });

    test('reads the refreshed OAuth token and account id from one persisted snapshot', async () => {
        const signal = new AbortController().signal;
        const credential_store = {
            read: jest.fn().mockResolvedValue({
                type: 'oauth',
                access: 'snapshot-access',
                refresh: 'snapshot-refresh',
                expires: 1_900_000_000_000,
                accountId: 'snapshot-account',
            }),
        };
        const models = {
            setProvider: jest.fn(),
            getAuth: jest.fn().mockResolvedValue({
                auth: { apiKey: 'superseded-access' },
            }),
        };
        jest.mocked(getPiCredentialStore).mockReturnValue(credential_store as never);
        jest.mocked(createModels).mockReturnValue(models as never);
        jest.mocked(createProvider).mockImplementation(options => options as never);
        jest.mocked(getBrowserOAuthAuth).mockReturnValue({} as never);
        const definition = getPiProviderDefinition('openai-codex');
        expect(definition).toBeDefined();

        await expect(resolvePiModelListOAuthCredential(definition!, signal)).resolves.toEqual({
            accessToken: 'snapshot-access',
            accountId: 'snapshot-account',
            expiresAt: 1_900_000_000_000,
        });
        expect(models.getAuth).toHaveBeenCalledWith('openai-codex', { signal });
        expect(credential_store.read).toHaveBeenCalledTimes(1);
        expect(credential_store.read).toHaveBeenCalledWith('openai-codex', { signal });
    });
});
