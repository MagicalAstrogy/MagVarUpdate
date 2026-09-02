jest.mock('@/function/update/pi/pi_gateway', () => {
    const streams = () => ({ stream: jest.fn(), streamSimple: jest.fn() });
    return {
        createModels: jest.fn(),
        createProvider: jest.fn(),
        OPENAI_MODELS: {},
        OPENAI_CODEX_MODELS: {},
        ANTHROPIC_MODELS: {},
        GOOGLE_MODELS: {},
        openAIResponsesApi: jest.fn(streams),
        openAICompletionsApi: jest.fn(streams),
        openAICodexResponsesApi: jest.fn(streams),
        anthropicMessagesApi: jest.fn(streams),
        googleGenerativeAIApi: jest.fn(streams),
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
        const fetchMock: FetchMock = jest.fn().mockResolvedValue(
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

        const url = requestUrl(fetchMock.mock.calls[0]);
        expect(url.origin + url.pathname).toBe('https://chatgpt.com/backend-api/codex/models');
        expect(url.searchParams.get('client_version')).toBe('0.144.0');
        const init = requestInit(fetchMock.mock.calls[0]);
        expect(init.method).toBe('GET');
        expect(init.cache).toBe('no-store');
        expect(init.credentials).toBe('omit');
        expect(init.redirect).toBe('error');
        expect(init.referrerPolicy).toBe('no-referrer');
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
