import { webcrypto } from 'node:crypto';

jest.mock('@/function/update/pi/pi_gateway', () => ({
    OPENAI_MODELS: {},
    OPENAI_CODEX_MODELS: {},
    ANTHROPIC_MODELS: {},
    GOOGLE_MODELS: {},
    openAIResponsesApi: jest.fn(),
    openAICompletionsApi: jest.fn(),
    openAICodexResponsesApi: jest.fn(),
    anthropicMessagesApi: jest.fn(),
    googleGenerativeAIApi: jest.fn(),
}));

import type {
    AuthOperationOptions,
    Credential,
    CredentialInfo,
    CredentialStore,
    OAuthCredential,
} from '@/function/update/pi/pi_gateway';
import {
    PiOAuthError,
    beginPiOAuth,
    cancelAllPiOAuth,
    cancelPiOAuth,
    completePiOAuth,
    getBrowserOAuthAuth,
    getPiOAuthCredentialStatus,
    logoutPiOAuth,
} from '@/function/update/pi/oauth';

class TestCredentialStore implements CredentialStore {
    readonly credentials = new Map<string, Credential>();

    async read(
        providerId: string,
        options?: AuthOperationOptions
    ): Promise<Credential | undefined> {
        options?.signal?.throwIfAborted();
        const credential = this.credentials.get(providerId);
        return credential ? { ...credential } : undefined;
    }

    async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
        options?.signal?.throwIfAborted();
        return [...this.credentials].map(([providerId, credential]) => ({
            providerId,
            type: credential.type,
        }));
    }

    async modify(
        providerId: string,
        fn: (current: Credential | undefined) => Promise<Credential | undefined>,
        options?: AuthOperationOptions
    ): Promise<Credential | undefined> {
        options?.signal?.throwIfAborted();
        const current = this.credentials.get(providerId);
        const next = await fn(current ? { ...current } : undefined);
        options?.signal?.throwIfAborted();
        if (next !== undefined) {
            this.credentials.set(providerId, { ...next });
        }
        return next ? { ...next } : current ? { ...current } : undefined;
    }

    async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
        options?.signal?.throwIfAborted();
        this.credentials.delete(providerId);
    }
}

const cryptoImpl = webcrypto as unknown as Crypto;

function response(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        text: jest.fn().mockResolvedValue(JSON.stringify(body)),
    } as unknown as Response;
}

function oauthCredential(overrides: Partial<OAuthCredential> = {}): OAuthCredential {
    return {
        type: 'oauth',
        access: 'old-access',
        refresh: 'old-refresh',
        expires: 123,
        ...overrides,
    };
}

function base64Url(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function codexJwt(accountId: string, extra: string): string {
    return `${base64Url({ alg: 'none' })}.${base64Url({
        'https://api.openai.com/auth': { chatgpt_account_id: accountId },
        extra,
    })}.signature`;
}

function callbackUrl(attempt: { authorizationUrl: string }, host = '127.0.0.1'): string {
    const authorizationUrl = new URL(attempt.authorizationUrl);
    const redirect = new URL(authorizationUrl.searchParams.get('redirect_uri')!);
    redirect.hostname = host;
    redirect.searchParams.set('code', 'authorization-code-secret');
    redirect.searchParams.set('state', authorizationUrl.searchParams.get('state')!);
    return redirect.toString();
}

function expectPiOAuthErrorCode(error: unknown, code: PiOAuthError['code']): void {
    expect(error).toBeInstanceOf(PiOAuthError);
    expect((error as PiOAuthError).code).toBe(code);
}

afterEach(() => {
    cancelAllPiOAuth();
    jest.restoreAllMocks();
});

describe('browser-safe Pi OAuth', () => {
    test('builds Anthropic PKCE authorization and accepts the 127.0.0.1 callback without changing redirect_uri', async () => {
        const now = 1_800_000_000_000;
        const store = new TestCredentialStore();
        store.credentials.set('anthropic', oauthCredential());
        const fetchMock = jest.fn().mockResolvedValue(
            response({
                access_token: 'anthropic-access-secret',
                refresh_token: 'anthropic-refresh-secret',
                expires_in: 3600,
            })
        );

        const attempt = await beginPiOAuth('anthropic', { crypto: cryptoImpl, now: () => now });
        const authorize = new URL(attempt.authorizationUrl);
        expect(authorize.origin + authorize.pathname).toBe('https://claude.ai/oauth/authorize');
        expect(authorize.searchParams.get('response_type')).toBe('code');
        expect(authorize.searchParams.get('redirect_uri')).toBe('http://localhost:53692/callback');
        expect(authorize.searchParams.get('code')).toBe('true');
        expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
        expect(authorize.searchParams.get('state')).toBeTruthy();
        expect(authorize.searchParams.get('state')).not.toBe(
            authorize.searchParams.get('code_challenge')
        );

        const credential = await completePiOAuth(attempt.id, callbackUrl(attempt), {
            fetch: fetchMock,
            credentialStore: store,
            now: () => now,
        });

        expect(credential).toEqual({
            type: 'oauth',
            access: 'anthropic-access-secret',
            refresh: 'anthropic-refresh-secret',
            expires: now + 3_600_000 - 300_000,
        });
        expect(store.credentials.get('anthropic')).toEqual(credential);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [tokenUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(tokenUrl).toBe('https://platform.claude.com/v1/oauth/token');
        expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
        const tokenBody = JSON.parse(init.body as string);
        expect(tokenBody).toMatchObject({
            grant_type: 'authorization_code',
            client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
            code: 'authorization-code-secret',
            redirect_uri: 'http://localhost:53692/callback',
            state: authorize.searchParams.get('state'),
        });
        expect(tokenBody.code_verifier).toEqual(expect.any(String));
        expect(tokenBody.code_verifier).not.toBe(tokenBody.state);
    });

    test('uses form exchange for OpenAI Codex and stores the JWT account ID', async () => {
        const now = 1_900_000_000_000;
        const access = codexJwt('account-123', 'login');
        const store = new TestCredentialStore();
        const fetchMock = jest.fn().mockResolvedValue(
            response({
                access_token: access,
                refresh_token: 'codex-refresh-secret',
                expires_in: 7200,
            })
        );

        const attempt = await beginPiOAuth('openai-codex', {
            crypto: cryptoImpl,
            now: () => now,
        });
        const authorize = new URL(attempt.authorizationUrl);
        expect(authorize.origin + authorize.pathname).toBe(
            'https://auth.openai.com/oauth/authorize'
        );
        expect(authorize.searchParams.get('redirect_uri')).toBe(
            'http://localhost:1455/auth/callback'
        );
        expect(authorize.searchParams.get('id_token_add_organizations')).toBe('true');
        expect(authorize.searchParams.get('codex_cli_simplified_flow')).toBe('true');
        expect(authorize.searchParams.get('originator')).toBe('pi');

        const credential = await completePiOAuth(attempt.id, callbackUrl(attempt, 'localhost'), {
            fetch: fetchMock,
            credentialStore: store,
            now: () => now,
        });
        expect(credential).toEqual({
            type: 'oauth',
            access,
            refresh: 'codex-refresh-secret',
            expires: now + 7_200_000,
            accountId: 'account-123',
        });

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.headers).toMatchObject({
            'Content-Type': 'application/x-www-form-urlencoded',
        });
        const tokenBody = new URLSearchParams(init.body as string);
        expect(tokenBody.get('grant_type')).toBe('authorization_code');
        expect(tokenBody.get('redirect_uri')).toBe('http://localhost:1455/auth/callback');
        expect(tokenBody.get('state')).toBeNull();
    });

    test.each([
        ['wrong host', (url: URL) => (url.hostname = 'example.com')],
        ['wrong port', (url: URL) => (url.port = '1234')],
        ['wrong path', (url: URL) => (url.pathname = '/wrong')],
        ['wrong protocol', (url: URL) => (url.protocol = 'https:')],
    ])('rejects a callback with %s before making a request', async (_name, mutate) => {
        const fetchMock = jest.fn();
        const attempt = await beginPiOAuth('anthropic', { crypto: cryptoImpl });
        const callback = new URL(callbackUrl(attempt));
        mutate(callback);

        await expect(
            completePiOAuth(attempt.id, callback.toString(), { fetch: fetchMock })
        ).rejects.toMatchObject({ code: 'invalid_callback' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('rejects state mismatch and an authorization error without reflecting sensitive callback data', async () => {
        const attempt = await beginPiOAuth('anthropic', { crypto: cryptoImpl });
        const wrongState = new URL(callbackUrl(attempt));
        wrongState.searchParams.set('state', 'cross-request-secret');
        await expect(completePiOAuth(attempt.id, wrongState.toString())).rejects.toMatchObject({
            code: 'state_mismatch',
        });

        const denied = new URL(callbackUrl(attempt));
        denied.searchParams.delete('code');
        denied.searchParams.set('error', 'access_denied-secret-value');
        try {
            await completePiOAuth(attempt.id, denied.toString());
            throw new Error('expected OAuth authorization failure');
        } catch (error) {
            expectPiOAuthErrorCode(error, 'authorization_failed');
            expect(String(error)).not.toContain('access_denied-secret-value');
            expect(String(error)).not.toContain('cross-request-secret');
        }
        await expect(completePiOAuth(attempt.id, denied.toString())).rejects.toMatchObject({
            code: 'attempt_used',
        });
    });

    test('isolates concurrent attempts and rejects replay after a successful exchange', async () => {
        const store = new TestCredentialStore();
        const fetchMock = jest
            .fn()
            .mockResolvedValue(
                response({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 })
            );
        const first = await beginPiOAuth('anthropic', { crypto: cryptoImpl });
        const second = await beginPiOAuth('anthropic', { crypto: cryptoImpl });

        await expect(
            completePiOAuth(second.id, callbackUrl(first), {
                fetch: fetchMock,
                credentialStore: store,
            })
        ).rejects.toMatchObject({ code: 'state_mismatch' });
        expect(fetchMock).not.toHaveBeenCalled();

        await completePiOAuth(first.id, callbackUrl(first), {
            fetch: fetchMock,
            credentialStore: store,
        });
        await expect(
            completePiOAuth(first.id, callbackUrl(first), {
                fetch: fetchMock,
                credentialStore: store,
            })
        ).rejects.toMatchObject({ code: 'attempt_used' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('expires attempts based on their deadline', async () => {
        let now = 1000;
        const attempt = await beginPiOAuth('anthropic', {
            crypto: cryptoImpl,
            now: () => now,
            attemptTtlMs: 50,
        });
        now = 1050;
        await expect(
            completePiOAuth(attempt.id, callbackUrl(attempt), { now: () => now })
        ).rejects.toMatchObject({ code: 'attempt_expired' });
    });

    test('cancel aborts an in-flight exchange and preserves the previous credential', async () => {
        const store = new TestCredentialStore();
        const oldCredential = oauthCredential();
        store.credentials.set('anthropic', oldCredential);
        const fetchMock = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener(
                    'abort',
                    () => reject(new TypeError('failed fetch with authorization-code-secret')),
                    { once: true }
                );
            });
        });
        const attempt = await beginPiOAuth('anthropic', { crypto: cryptoImpl });
        const completion = completePiOAuth(attempt.id, callbackUrl(attempt), {
            fetch: fetchMock,
            credentialStore: store,
        });
        await Promise.resolve();
        expect(cancelPiOAuth(attempt.id)).toBe(true);

        await expect(completion).rejects.toMatchObject({ code: 'cancelled' });
        expect(store.credentials.get('anthropic')).toEqual(oldCredential);
        expect(cancelPiOAuth(attempt.id)).toBe(false);
    });

    test('an AbortSignal cancels a pending attempt before token exchange', async () => {
        const controller = new AbortController();
        const fetchMock = jest.fn();
        const attempt = await beginPiOAuth('anthropic', {
            crypto: cryptoImpl,
            signal: controller.signal,
        });
        controller.abort();

        await expect(
            completePiOAuth(attempt.id, callbackUrl(attempt), { fetch: fetchMock })
        ).rejects.toMatchObject({ code: 'cancelled' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('normalizes CORS/network and token errors without leaking request or response secrets', async () => {
        const store = new TestCredentialStore();
        store.credentials.set('anthropic', oauthCredential());
        const attempt = await beginPiOAuth('anthropic', { crypto: cryptoImpl });
        const corsFetch = jest
            .fn()
            .mockRejectedValue(new TypeError('authorization-code-secret blocked'));
        try {
            await completePiOAuth(attempt.id, callbackUrl(attempt), {
                fetch: corsFetch,
                credentialStore: store,
            });
            throw new Error('expected CORS error');
        } catch (error) {
            expectPiOAuthErrorCode(error, 'browser_network');
            expect(String(error)).toContain('CORS');
            expect(String(error)).not.toContain('authorization-code-secret');
        }
        expect(store.credentials.get('anthropic')).toEqual(oauthCredential());

        const second = await beginPiOAuth('anthropic', { crypto: cryptoImpl });
        const errorFetch = jest.fn().mockResolvedValue(
            response(
                {
                    error: 'invalid_grant',
                    access_token: 'response-access-secret',
                    refresh_token: 'response-refresh-secret',
                },
                400
            )
        );
        try {
            await completePiOAuth(second.id, callbackUrl(second), {
                fetch: errorFetch,
                credentialStore: store,
            });
            throw new Error('expected token endpoint error');
        } catch (error) {
            expectPiOAuthErrorCode(error, 'token_http');
            expect(String(error)).not.toContain('response-access-secret');
            expect(String(error)).not.toContain('response-refresh-secret');
        }
        expect(store.credentials.get('anthropic')).toEqual(oauthCredential());
    });

    test('validates required token response fields without reflecting response values', async () => {
        const store = new TestCredentialStore();
        store.credentials.set('anthropic', oauthCredential());
        const attempt = await beginPiOAuth('anthropic', { crypto: cryptoImpl });
        const fetchMock = jest.fn().mockResolvedValue(
            response({
                access_token: 'incomplete-access-secret',
                refresh_token: '',
                expires_in: '3600',
            })
        );

        try {
            await completePiOAuth(attempt.id, callbackUrl(attempt), {
                fetch: fetchMock,
                credentialStore: store,
            });
            throw new Error('expected token response validation error');
        } catch (error) {
            expectPiOAuthErrorCode(error, 'token_response');
            expect(String(error)).not.toContain('incomplete-access-secret');
        }
        expect(store.credentials.get('anthropic')).toEqual(oauthCredential());
    });

    test('refreshes both browser OAuth implementations and derives request auth', async () => {
        const now = 2_000_000_000_000;
        const anthropicFetch = jest.fn().mockResolvedValue(
            response({
                access_token: 'anthropic-new-access',
                refresh_token: 'anthropic-new-refresh',
                expires_in: 3600,
            })
        );
        const anthropic = getBrowserOAuthAuth('anthropic', {
            fetch: anthropicFetch,
            now: () => now,
        });
        const anthropicCredential = await anthropic.refresh(
            oauthCredential(),
            new AbortController().signal
        );
        expect(anthropicCredential.expires).toBe(now + 3_600_000 - 300_000);
        expect(await anthropic.toAuth(anthropicCredential)).toEqual({
            apiKey: 'anthropic-new-access',
        });
        expect(JSON.parse(anthropicFetch.mock.calls[0][1].body)).toMatchObject({
            grant_type: 'refresh_token',
            refresh_token: 'old-refresh',
        });

        const codexAccess = codexJwt('refreshed-account', 'refresh');
        const codexFetch = jest
            .fn()
            .mockResolvedValue(
                response({ access_token: codexAccess, refresh_token: 'rotated', expires_in: 1800 })
            );
        const codex = getBrowserOAuthAuth('openai-codex', {
            fetch: codexFetch,
            now: () => now,
        });
        const codexCredential = await codex.refresh(
            oauthCredential(),
            new AbortController().signal
        );
        expect(codexCredential).toMatchObject({
            access: codexAccess,
            refresh: 'rotated',
            expires: now + 1_800_000,
            accountId: 'refreshed-account',
        });
        expect(await codex.toAuth(codexCredential)).toEqual({ apiKey: codexAccess });
        expect(new URLSearchParams(codexFetch.mock.calls[0][1].body).get('grant_type')).toBe(
            'refresh_token'
        );
    });

    test('status and logout expose no secrets', async () => {
        const store = new TestCredentialStore();
        store.credentials.set(
            'anthropic',
            oauthCredential({
                access: 'status-access-secret',
                refresh: 'status-refresh-secret',
                expires: 456,
            })
        );
        const status = await getPiOAuthCredentialStatus('anthropic', {
            credentialStore: store,
        });
        expect(status).toEqual({ loggedIn: true, type: 'oauth', expiresAt: 456 });
        expect(JSON.stringify(status)).not.toContain('secret');

        await logoutPiOAuth('anthropic', { credentialStore: store });
        expect(await getPiOAuthCredentialStatus('anthropic', { credentialStore: store })).toEqual({
            loggedIn: false,
        });
    });

    test('rejects malformed Codex JWTs without exposing the token', async () => {
        const store = new TestCredentialStore();
        const token = 'malformed-access-token-secret';
        const fetchMock = jest
            .fn()
            .mockResolvedValue(
                response({ access_token: token, refresh_token: 'refresh', expires_in: 3600 })
            );
        const attempt = await beginPiOAuth('openai-codex', { crypto: cryptoImpl });
        try {
            await completePiOAuth(attempt.id, callbackUrl(attempt), {
                fetch: fetchMock,
                credentialStore: store,
            });
            throw new Error('expected account ID error');
        } catch (error) {
            expectPiOAuthErrorCode(error, 'account_id');
            expect(String(error)).not.toContain(token);
        }
        expect(store.credentials.has('openai-codex')).toBe(false);
    });
});
