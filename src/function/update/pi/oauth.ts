import { getPiCredentialStore } from './credential_store';
import type { CredentialStore, ModelAuth, OAuthAuth, OAuthCredential } from './pi_gateway';
import { getPiProviderRegistration, type PiOAuthDefinition } from './provider_registry';

const DEFAULT_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const CLOSED_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const MAX_CLOSED_ATTEMPTS = 128;
const OPENAI_CODEX_PROVIDER_ID = 'openai-codex';
const ANTHROPIC_PROVIDER_ID = 'anthropic';
const OPENAI_ACCOUNT_CLAIM = 'https://api.openai.com/auth';

export type PiOAuthErrorCode =
    | 'unsupported_provider'
    | 'browser_unavailable'
    | 'invalid_callback'
    | 'state_mismatch'
    | 'authorization_failed'
    | 'attempt_expired'
    | 'attempt_used'
    | 'cancelled'
    | 'browser_network'
    | 'token_http'
    | 'token_response'
    | 'account_id'
    | 'credential_store';

export class PiOAuthError extends Error {
    readonly code: PiOAuthErrorCode;

    constructor(code: PiOAuthErrorCode, message: string) {
        super(message);
        this.name = 'PiOAuthError';
        this.code = code;
    }
}

export type PiOAuthAttemptView = {
    id: string;
    providerId: string;
    authorizationUrl: string;
    expiresAt: number;
};

export type PiOAuthCredentialStatus = {
    loggedIn: boolean;
    type?: 'oauth';
    expiresAt?: number;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type CryptoLike = {
    getRandomValues<T extends ArrayBufferView>(array: T): T;
    subtle: {
        digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer>;
    };
};

type OAuthMetadata = Readonly<PiOAuthDefinition>;

type PiOAuthDependencies = {
    fetch?: FetchLike;
    crypto?: CryptoLike;
    now?: () => number;
    credentialStore?: CredentialStore;
};

export type BeginPiOAuthOptions = PiOAuthDependencies & {
    signal?: AbortSignal;
    attemptTtlMs?: number;
};

export type CompletePiOAuthOptions = PiOAuthDependencies & {
    signal?: AbortSignal;
};

export type PiOAuthOperationOptions = {
    signal?: AbortSignal;
    credentialStore?: CredentialStore;
};

export type BrowserOAuthAuthOptions = Pick<PiOAuthDependencies, 'fetch' | 'crypto' | 'now'> & {
    attemptTtlMs?: number;
};

type PendingAttempt = {
    id: string;
    providerId: string;
    metadata: OAuthMetadata;
    verifier: string;
    state: string;
    expiresAt: number;
    phase: 'pending' | 'exchanging';
    controller: AbortController;
    timeout: ReturnType<typeof setTimeout>;
    detachCallerAbort?: () => void;
};

type ClosedAttemptReason = 'used' | 'expired' | 'cancelled';

const pendingAttempts = new Map<string, PendingAttempt>();
const closedAttempts = new Map<string, { reason: ClosedAttemptReason; removeAfter: number }>();

function oauthError(code: PiOAuthErrorCode, message: string): PiOAuthError {
    return new PiOAuthError(code, message);
}

function cancellationError(): PiOAuthError {
    return oauthError('cancelled', 'Pi OAuth login was cancelled.');
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw cancellationError();
    }
}

function getNow(options?: Pick<PiOAuthDependencies, 'now'>): () => number {
    return options?.now ?? Date.now;
}

function getFetch(options?: Pick<PiOAuthDependencies, 'fetch'>): FetchLike {
    const fetchImpl = options?.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        throw oauthError(
            'browser_unavailable',
            'Pi OAuth requires the browser Fetch API for token requests.'
        );
    }
    return fetchImpl.bind(globalThis) as FetchLike;
}

function getCrypto(options?: Pick<PiOAuthDependencies, 'crypto'>): CryptoLike {
    const cryptoImpl = options?.crypto ?? (globalThis.crypto as CryptoLike | undefined);
    if (
        !cryptoImpl ||
        typeof cryptoImpl.getRandomValues !== 'function' ||
        typeof cryptoImpl.subtle?.digest !== 'function'
    ) {
        throw oauthError(
            'browser_unavailable',
            'Pi OAuth requires Web Crypto with SHA-256 support.'
        );
    }
    return cryptoImpl;
}

function getCredentialStore(
    options?: Pick<PiOAuthDependencies, 'credentialStore'>
): CredentialStore {
    return options?.credentialStore ?? getPiCredentialStore();
}

function getOAuthMetadata(providerId: string): OAuthMetadata {
    const registration = getPiProviderRegistration(providerId);
    const metadata = registration?.oauth;
    if (!metadata || metadata.providerId !== providerId) {
        throw oauthError(
            'unsupported_provider',
            `Pi provider "${providerId}" does not support browser OAuth.`
        );
    }
    if (providerId !== ANTHROPIC_PROVIDER_ID && providerId !== OPENAI_CODEX_PROVIDER_ID) {
        throw oauthError(
            'unsupported_provider',
            `Pi provider "${providerId}" does not support browser OAuth.`
        );
    }
    return metadata;
}

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomBase64Url(cryptoImpl: CryptoLike, length: number): string {
    return bytesToBase64Url(cryptoImpl.getRandomValues(new Uint8Array(length)));
}

async function createPkce(cryptoImpl: CryptoLike): Promise<{
    verifier: string;
    challenge: string;
}> {
    const verifier = randomBase64Url(cryptoImpl, 32);
    const verifierBytes = Uint8Array.from(verifier, character => character.charCodeAt(0));
    const digest = await cryptoImpl.subtle.digest('SHA-256', verifierBytes);
    return {
        verifier,
        challenge: bytesToBase64Url(new Uint8Array(digest)),
    };
}

function createAuthorizationUrl(metadata: OAuthMetadata, challenge: string, state: string): string {
    const url = new URL(metadata.authorizeUrl);
    for (const [name, value] of Object.entries(metadata.authorizeParams)) {
        url.searchParams.set(name, value);
    }
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', metadata.clientId);
    url.searchParams.set('redirect_uri', metadata.redirectUri);
    url.searchParams.set('scope', metadata.scope);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    return url.toString();
}

function rememberClosedAttempt(id: string, reason: ClosedAttemptReason): void {
    const now = Date.now();
    for (const [closedId, closed] of closedAttempts) {
        if (closed.removeAfter <= now) {
            closedAttempts.delete(closedId);
        }
    }
    while (closedAttempts.size >= MAX_CLOSED_ATTEMPTS) {
        const oldestId = closedAttempts.keys().next().value as string | undefined;
        if (oldestId === undefined) {
            break;
        }
        closedAttempts.delete(oldestId);
    }
    closedAttempts.set(id, { reason, removeAfter: now + CLOSED_ATTEMPT_TTL_MS });
}

function closeAttempt(attempt: PendingAttempt, reason: ClosedAttemptReason, abort: boolean): void {
    if (pendingAttempts.get(attempt.id) !== attempt) {
        return;
    }
    pendingAttempts.delete(attempt.id);
    clearTimeout(attempt.timeout);
    attempt.detachCallerAbort?.();
    if (abort && !attempt.controller.signal.aborted) {
        attempt.controller.abort();
    }
    attempt.verifier = '';
    attempt.state = '';
    rememberClosedAttempt(attempt.id, reason);
}

function expireAttempt(attempt: PendingAttempt): void {
    closeAttempt(attempt, 'expired', true);
}

function linkAbortSignal(signal: AbortSignal | undefined, controller: AbortController): () => void {
    if (!signal) {
        return () => undefined;
    }
    const onAbort = () => controller.abort();
    if (signal.aborted) {
        onAbort();
    } else {
        signal.addEventListener('abort', onAbort, { once: true });
    }
    return () => signal.removeEventListener('abort', onAbort);
}

function errorForClosedAttempt(reason: ClosedAttemptReason): PiOAuthError {
    if (reason === 'expired') {
        return oauthError('attempt_expired', 'This Pi OAuth login attempt has expired.');
    }
    if (reason === 'cancelled') {
        return cancellationError();
    }
    return oauthError('attempt_used', 'This Pi OAuth callback has already been used.');
}

function getPendingAttempt(attemptId: string, now: number): PendingAttempt {
    const attempt = pendingAttempts.get(attemptId);
    if (!attempt) {
        const closed = closedAttempts.get(attemptId);
        if (closed) {
            throw errorForClosedAttempt(closed.reason);
        }
        throw oauthError('attempt_used', 'No active Pi OAuth login attempt matches this callback.');
    }
    if (now >= attempt.expiresAt) {
        expireAttempt(attempt);
        throw oauthError('attempt_expired', 'This Pi OAuth login attempt has expired.');
    }
    if (attempt.phase !== 'pending') {
        throw oauthError('attempt_used', 'This Pi OAuth callback has already been used.');
    }
    if (attempt.controller.signal.aborted) {
        closeAttempt(attempt, 'cancelled', false);
        throw cancellationError();
    }
    return attempt;
}

type ParsedCallback = { code: string; state: string };

function normalizePort(url: URL): string {
    if (url.port) {
        return url.port;
    }
    return url.protocol === 'http:' ? '80' : url.protocol === 'https:' ? '443' : '';
}

function parseAndValidateCallback(callbackUrl: string, attempt: PendingAttempt): ParsedCallback {
    let callback: URL;
    let redirect: URL;
    try {
        callback = new URL(callbackUrl.trim());
        redirect = new URL(attempt.metadata.redirectUri);
    } catch {
        throw oauthError(
            'invalid_callback',
            'Paste the complete loopback callback URL from the browser address bar.'
        );
    }

    const allowedHosts = new Set(
        attempt.metadata.allowedCallbackHosts.map(host => host.toLowerCase())
    );
    allowedHosts.add(redirect.hostname.toLowerCase());
    if (
        callback.protocol !== 'http:' ||
        callback.username !== '' ||
        callback.password !== '' ||
        callback.hash !== '' ||
        !allowedHosts.has(callback.hostname.toLowerCase()) ||
        normalizePort(callback) !== normalizePort(redirect) ||
        callback.pathname !== redirect.pathname
    ) {
        throw oauthError(
            'invalid_callback',
            'The Pi OAuth callback does not match the registered loopback address.'
        );
    }

    const state = callback.searchParams.get('state') ?? '';
    if (!state || state !== attempt.state) {
        throw oauthError('state_mismatch', 'The Pi OAuth callback state does not match.');
    }
    if (callback.searchParams.has('error')) {
        throw oauthError(
            'authorization_failed',
            'The OAuth provider did not authorize this Pi login.'
        );
    }
    const code = callback.searchParams.get('code') ?? '';
    if (!code) {
        throw oauthError('invalid_callback', 'The Pi OAuth callback is missing its code.');
    }
    return { code, state };
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
    return signal.aborted || (error instanceof PiOAuthError && error.code === 'cancelled');
}

function normalizeFetchFailure(error: unknown, signal: AbortSignal): never {
    if (isCancellation(error, signal)) {
        throw cancellationError();
    }
    if (error instanceof TypeError) {
        throw oauthError(
            'browser_network',
            'The browser could not reach the Pi OAuth token endpoint. Check network access and whether the provider allows browser CORS requests.'
        );
    }
    throw oauthError('browser_network', 'The Pi OAuth token request failed in the browser.');
}

type TokenGrant =
    | { type: 'authorization_code'; code: string; verifier: string; state: string }
    | { type: 'refresh_token'; refreshToken: string };

type TokenData = {
    access: string;
    refresh: string;
    expiresInSeconds: number;
};

function createTokenFields(metadata: OAuthMetadata, grant: TokenGrant): Record<string, string> {
    const fields: Record<string, string> = { ...metadata.tokenParams };
    fields.client_id = metadata.clientId;
    if (grant.type === 'authorization_code') {
        fields.grant_type = 'authorization_code';
        fields.code = grant.code;
        fields.code_verifier = grant.verifier;
        fields.redirect_uri = metadata.redirectUri;
        if (metadata.includeStateInTokenRequest) {
            fields.state = grant.state;
        }
    } else {
        fields.grant_type = 'refresh_token';
        fields.refresh_token = grant.refreshToken;
    }
    return fields;
}

async function readTokenResponse(
    response: Response,
    fallbackRefreshToken?: string
): Promise<TokenData> {
    if (!response.ok) {
        throw oauthError(
            'token_http',
            `The Pi OAuth token endpoint rejected the request (HTTP ${response.status}).`
        );
    }

    let body: unknown;
    try {
        body = JSON.parse(await response.text());
    } catch {
        throw oauthError(
            'token_response',
            'The Pi OAuth token endpoint returned an invalid response.'
        );
    }
    if (!body || typeof body !== 'object') {
        throw oauthError(
            'token_response',
            'The Pi OAuth token endpoint returned an invalid response.'
        );
    }
    const token = body as Record<string, unknown>;
    const access = token.access_token;
    const refresh = token.refresh_token ?? fallbackRefreshToken;
    const expiresIn = token.expires_in;
    if (
        typeof access !== 'string' ||
        access.length === 0 ||
        typeof refresh !== 'string' ||
        refresh.length === 0 ||
        typeof expiresIn !== 'number' ||
        !Number.isFinite(expiresIn) ||
        expiresIn <= 0
    ) {
        throw oauthError(
            'token_response',
            'The Pi OAuth token endpoint response is missing required fields.'
        );
    }
    return { access, refresh, expiresInSeconds: expiresIn };
}

async function requestTokens(
    metadata: OAuthMetadata,
    grant: TokenGrant,
    signal: AbortSignal,
    options?: Pick<PiOAuthDependencies, 'fetch'>
): Promise<TokenData> {
    throwIfAborted(signal);
    const fields = createTokenFields(metadata, grant);
    const headers: Record<string, string> = { Accept: 'application/json' };
    let body: string;
    if (metadata.exchangeKind === 'json') {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(fields);
    } else {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(fields).toString();
    }

    let response: Response;
    try {
        response = await getFetch(options)(metadata.tokenUrl, {
            method: 'POST',
            headers,
            body,
            signal,
        });
    } catch (error) {
        normalizeFetchFailure(error, signal);
    }
    throwIfAborted(signal);
    return readTokenResponse(
        response!,
        grant.type === 'refresh_token' ? grant.refreshToken : undefined
    );
}

function decodeBase64UrlJson(value: string): unknown {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const json =
        typeof globalThis.TextDecoder === 'function'
            ? new globalThis.TextDecoder().decode(bytes)
            : decodeURIComponent(
                  [...bytes].map(byte => `%${byte.toString(16).padStart(2, '0')}`).join('')
              );
    return JSON.parse(json);
}

function extractOpenAIAccountId(accessToken: string): string {
    try {
        const parts = accessToken.split('.');
        if (parts.length !== 3) {
            throw new Error('invalid JWT');
        }
        const payload = decodeBase64UrlJson(parts[1]);
        if (!payload || typeof payload !== 'object') {
            throw new Error('invalid JWT payload');
        }
        const authClaim = (payload as Record<string, unknown>)[OPENAI_ACCOUNT_CLAIM];
        if (!authClaim || typeof authClaim !== 'object') {
            throw new Error('missing auth claim');
        }
        const accountId = (authClaim as Record<string, unknown>).chatgpt_account_id;
        if (typeof accountId !== 'string' || accountId.length === 0) {
            throw new Error('missing account ID');
        }
        return accountId;
    } catch {
        throw oauthError(
            'account_id',
            'The OpenAI Codex OAuth token does not contain a ChatGPT account ID.'
        );
    }
}

function credentialFromTokens(
    metadata: OAuthMetadata,
    token: TokenData,
    now: number
): OAuthCredential {
    const credential: OAuthCredential = {
        type: 'oauth',
        access: token.access,
        refresh: token.refresh,
        expires: now + token.expiresInSeconds * 1000 - metadata.expirySkewMs,
    };
    if (metadata.providerId === OPENAI_CODEX_PROVIDER_ID) {
        credential.accountId = extractOpenAIAccountId(token.access);
    }
    return credential;
}

async function persistCredential(
    providerId: string,
    credential: OAuthCredential,
    signal: AbortSignal,
    options?: Pick<PiOAuthDependencies, 'credentialStore'>
): Promise<void> {
    throwIfAborted(signal);
    try {
        await getCredentialStore(options).modify(providerId, async () => credential, { signal });
    } catch (error) {
        if (isCancellation(error, signal)) {
            throw cancellationError();
        }
        throw oauthError(
            'credential_store',
            'Pi OAuth login succeeded, but the credential could not be saved.'
        );
    }
}

export async function beginPiOAuth(
    providerId: string,
    options: BeginPiOAuthOptions = {}
): Promise<PiOAuthAttemptView> {
    throwIfAborted(options.signal);
    const metadata = getOAuthMetadata(providerId);
    const ttl = options.attemptTtlMs ?? DEFAULT_ATTEMPT_TTL_MS;
    if (!Number.isFinite(ttl) || ttl <= 0) {
        throw new RangeError('Pi OAuth attemptTtlMs must be a positive number.');
    }
    const cryptoImpl = getCrypto(options);
    const { verifier, challenge } = await createPkce(cryptoImpl);
    throwIfAborted(options.signal);

    const state = randomBase64Url(cryptoImpl, 32);
    const id = randomBase64Url(cryptoImpl, 18);
    const expiresAt = getNow(options)() + ttl;
    const controller = new AbortController();
    const attempt: PendingAttempt = {
        id,
        providerId,
        metadata,
        verifier,
        state,
        expiresAt,
        phase: 'pending' as const,
        controller,
        timeout: undefined as unknown as ReturnType<typeof setTimeout>,
    };
    attempt.timeout = setTimeout(() => expireAttempt(attempt), ttl);
    pendingAttempts.set(id, attempt);
    if (options.signal) {
        const onAbort = () => closeAttempt(attempt, 'cancelled', true);
        options.signal.addEventListener('abort', onAbort, { once: true });
        attempt.detachCallerAbort = () => options.signal?.removeEventListener('abort', onAbort);
        if (options.signal.aborted) {
            onAbort();
            throw cancellationError();
        }
    }

    return {
        id,
        providerId,
        authorizationUrl: createAuthorizationUrl(metadata, challenge, state),
        expiresAt,
    };
}

export async function completePiOAuth(
    attemptId: string,
    callbackUrl: string,
    options: CompletePiOAuthOptions = {}
): Promise<OAuthCredential> {
    throwIfAborted(options.signal);
    const now = getNow(options);
    const attempt = getPendingAttempt(attemptId, now());
    let parsed: ParsedCallback;
    try {
        parsed = parseAndValidateCallback(callbackUrl, attempt);
    } catch (error) {
        if (error instanceof PiOAuthError && error.code === 'authorization_failed') {
            closeAttempt(attempt, 'used', true);
        }
        throw error;
    }
    attempt.phase = 'exchanging';
    const detachCompleteAbort = linkAbortSignal(options.signal, attempt.controller);

    try {
        throwIfAborted(attempt.controller.signal);
        const token = await requestTokens(
            attempt.metadata,
            {
                type: 'authorization_code',
                code: parsed.code,
                verifier: attempt.verifier,
                state: parsed.state,
            },
            attempt.controller.signal,
            options
        );
        const credential = credentialFromTokens(attempt.metadata, token, now());
        await persistCredential(attempt.providerId, credential, attempt.controller.signal, options);
        closeAttempt(attempt, 'used', false);
        return credential;
    } catch (error) {
        const cancelled = isCancellation(error, attempt.controller.signal);
        closeAttempt(attempt, cancelled ? 'cancelled' : 'used', true);
        if (cancelled) {
            throw cancellationError();
        }
        throw error;
    } finally {
        detachCompleteAbort();
    }
}

export function cancelPiOAuth(attemptId: string): boolean {
    const attempt = pendingAttempts.get(attemptId);
    if (!attempt) {
        return false;
    }
    closeAttempt(attempt, 'cancelled', true);
    return true;
}

export function cancelAllPiOAuth(): void {
    for (const attempt of [...pendingAttempts.values()]) {
        closeAttempt(attempt, 'cancelled', true);
    }
}

export async function logoutPiOAuth(
    providerId: string,
    options: PiOAuthOperationOptions = {}
): Promise<void> {
    throwIfAborted(options.signal);
    getOAuthMetadata(providerId);
    try {
        await getCredentialStore(options).delete(providerId, { signal: options.signal });
    } catch (error) {
        if (options.signal?.aborted) {
            throw cancellationError();
        }
        throw oauthError('credential_store', 'The Pi OAuth credential could not be removed.');
    }
}

export async function getPiOAuthCredentialStatus(
    providerId: string,
    options: PiOAuthOperationOptions = {}
): Promise<PiOAuthCredentialStatus> {
    throwIfAborted(options.signal);
    getOAuthMetadata(providerId);
    let credential;
    try {
        credential = await getCredentialStore(options).read(providerId, { signal: options.signal });
    } catch (error) {
        if (options.signal?.aborted) {
            throw cancellationError();
        }
        throw oauthError('credential_store', 'The Pi OAuth credential status could not be read.');
    }
    if (!credential || credential.type !== 'oauth') {
        return { loggedIn: false };
    }
    return {
        loggedIn: true,
        type: 'oauth',
        expiresAt: credential.expires,
    };
}

function createBrowserOAuthAuth(
    metadata: OAuthMetadata,
    options: BrowserOAuthAuthOptions
): OAuthAuth {
    const providerName =
        metadata.providerId === ANTHROPIC_PROVIDER_ID
            ? 'Anthropic (Claude Pro/Max)'
            : 'OpenAI (ChatGPT Plus/Pro)';
    return {
        name: providerName,
        isSubscription: true,
        async login(interaction) {
            const attempt = await beginPiOAuth(metadata.providerId, {
                ...options,
                signal: interaction.signal,
            });
            interaction.notify({
                type: 'auth_url',
                url: attempt.authorizationUrl,
                instructions: 'Complete login, then paste the complete loopback callback URL here.',
            });
            let callbackUrl: string;
            try {
                callbackUrl = await interaction.prompt({
                    type: 'manual_code',
                    message: 'Paste the complete loopback callback URL:',
                    placeholder: metadata.redirectUri.replace('localhost', '127.0.0.1'),
                    signal: interaction.signal,
                });
            } catch (error) {
                cancelPiOAuth(attempt.id);
                if (interaction.signal.aborted) {
                    throw cancellationError();
                }
                throw oauthError('invalid_callback', 'Pi OAuth callback input was cancelled.');
            }
            try {
                return await completePiOAuth(attempt.id, callbackUrl, {
                    ...options,
                    signal: interaction.signal,
                });
            } catch (error) {
                cancelPiOAuth(attempt.id);
                throw error;
            }
        },
        async refresh(credential, signal) {
            const token = await requestTokens(
                metadata,
                { type: 'refresh_token', refreshToken: credential.refresh },
                signal,
                options
            );
            return credentialFromTokens(metadata, token, getNow(options)());
        },
        async toAuth(credential): Promise<ModelAuth> {
            if (metadata.providerId === OPENAI_CODEX_PROVIDER_ID) {
                extractOpenAIAccountId(credential.access);
            }
            return { apiKey: credential.access };
        },
    };
}

export function getBrowserOAuthAuth(
    providerId: string,
    options: BrowserOAuthAuthOptions = {}
): OAuthAuth {
    return createBrowserOAuthAuth(getOAuthMetadata(providerId), options);
}
