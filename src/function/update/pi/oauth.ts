import { getPiCredentialStore } from './credential_store';
import { installPiAbortSignalPolyfills } from './abort_signal';
import type { CredentialStore, ModelAuth, OAuthAuth, OAuthCredential } from './pi_gateway';
import { getPiProviderRegistration, type PiOAuthDefinition } from './provider_registry';

const DEFAULT_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const CLOSED_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const MAX_CLOSED_ATTEMPTS = 128;
const REFRESH_TIMEOUT_MS = 15_000;
const OPENAI_CODEX_PROVIDER_ID = 'openai-codex';
const ANTHROPIC_PROVIDER_ID = 'anthropic';
const OPENAI_ACCOUNT_CLAIM = 'https://api.openai.com/auth';

/** 浏览器登录、回调校验、令牌交换及持久化的失败分类，供界面和取消逻辑使用。 */
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
    | 'missing_credential'
    | 'credential_store';

export class PiOAuthError extends Error {
    readonly code: PiOAuthErrorCode;

    /** 为浏览器 OAuth 失败保留稳定错误码，供界面和取消逻辑分类处理。 */
    constructor(code: PiOAuthErrorCode, message: string) {
        super(message);
        this.name = 'PiOAuthError';
        this.code = code;
    }
}

/** 可展示给界面的登录尝试信息，不包含 PKCE verifier 或令牌。 */
export type PiOAuthAttemptView = {
    id: string;
    providerId: string;
    authorizationUrl: string;
    /** 本次回调可被接受的截止时间，使用 Unix 毫秒时间戳。 */
    expiresAt: number;
};

/** 对外展示的 OAuth 凭证摘要；loggedIn 表示已存有凭证，过期凭证仍可尝试刷新。 */
export type PiOAuthCredentialStatus = {
    loggedIn: boolean;
    type?: 'oauth';
    /** 已保存访问令牌的过期时间，使用 Unix 毫秒时间戳。 */
    expiresAt?: number;
};

/** 令牌请求需要的最小 fetch 契约，便于注入测试传输。 */
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** 生成 state、PKCE verifier 和 SHA-256 challenge 所需的最小 Web Crypto 接口。 */
type CryptoLike = {
    getRandomValues<T extends ArrayBufferView>(array: T): T;
    subtle: {
        digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer>;
    };
};

/** 单次登录引用的只读服务商 OAuth 注册信息。 */
type OAuthMetadata = Readonly<PiOAuthDefinition>;

/** 可替换的浏览器与存储依赖，未传入时使用页面环境和共享凭证仓库。 */
type PiOAuthDependencies = {
    fetch?: FetchLike;
    crypto?: CryptoLike;
    /** 返回 Unix 毫秒时间戳，用于登录有效期和令牌过期计算。 */
    now?: () => number;
    credentialStore?: CredentialStore;
};

/** 发起登录时的依赖、取消信号及回调等待期限。 */
export type BeginPiOAuthOptions = PiOAuthDependencies & {
    signal?: AbortSignal;
    /** 从创建授权链接起计算的有效时长，单位为毫秒。 */
    attemptTtlMs?: number;
};

/** 完成回调校验和授权码交换时使用的依赖与取消信号。 */
export type CompletePiOAuthOptions = PiOAuthDependencies & {
    signal?: AbortSignal;
};

/** 凭证查询、删除等操作共享的取消与存储配置。 */
export type PiOAuthOperationOptions = {
    signal?: AbortSignal;
    credentialStore?: CredentialStore;
};

/** 刷新令牌所需的操作选项，只额外依赖网络和时钟，不需要重新生成 PKCE。 */
export type RefreshPiOAuthOptions = PiOAuthOperationOptions &
    Pick<PiOAuthDependencies, 'fetch' | 'now'>;

/** 构建 Pi OAuthAuth 桥接对象时注入的浏览器能力与登录有效时长。 */
export type BrowserOAuthAuthOptions = Pick<PiOAuthDependencies, 'fetch' | 'crypto' | 'now'> & {
    attemptTtlMs?: number;
};

/** 仅保存在内存中的登录尝试，负责回调防重放、有效期和交换请求取消。 */
type PendingAttempt = {
    id: string;
    providerId: string;
    metadata: OAuthMetadata;
    /** PKCE 原始验证串，只在交换授权码时提交给令牌端点。 */
    verifier: string;
    /** 与回调严格匹配的随机 state，用于绑定本次授权请求。 */
    state: string;
    expiresAt: number;
    /** exchanging 表示授权码已被领取处理，阻止重复提交同一回调。 */
    phase: 'pending' | 'exchanging';
    controller: AbortController;
    timeout: ReturnType<typeof setTimeout>;
    /** 清理调用方取消监听，避免尝试结束后继续持有外部信号。 */
    detachCallerAbort?: () => void;
};

/** 短期保留已关闭尝试的原因，使迟到或重复回调得到明确错误。 */
type ClosedAttemptReason = 'used' | 'expired' | 'cancelled';

const pendingAttempts = new Map<string, PendingAttempt>();
const closedAttempts = new Map<string, { reason: ClosedAttemptReason; removeAfter: number }>();

/** 构造带稳定错误码的 OAuth 错误。 */
function oauthError(code: PiOAuthErrorCode, message: string): PiOAuthError {
    return new PiOAuthError(code, message);
}

/** 创建统一的登录取消错误，供各异步阶段使用。 */
function cancellationError(): PiOAuthError {
    return oauthError('cancelled', 'More source OAuth login was cancelled.');
}

/** 将已取消信号转换为 OAuth 取消错误，阻止继续交换或写入令牌。 */
function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw cancellationError();
    }
}

/** 解析可注入的时钟，使登录有效期和刷新测试可以精确控制时间。 */
function getNow(options?: Pick<PiOAuthDependencies, 'now'>): () => number {
    return options?.now ?? Date.now;
}

/** 解析浏览器令牌请求使用的 fetch，缺少能力时返回明确的环境错误。 */
function getFetch(options?: Pick<PiOAuthDependencies, 'fetch'>): FetchLike {
    const fetchImpl = options?.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        throw oauthError(
            'browser_unavailable',
            'More source OAuth requires the browser Fetch API for token requests.'
        );
    }
    return fetchImpl.bind(globalThis) as FetchLike;
}

/** 确认 Web Crypto 提供随机数和 SHA-256，满足 OAuth state 与 PKCE 的生成要求。 */
function getCrypto(options?: Pick<PiOAuthDependencies, 'crypto'>): CryptoLike {
    const cryptoImpl = options?.crypto ?? (globalThis.crypto as CryptoLike | undefined);
    if (
        !cryptoImpl ||
        typeof cryptoImpl.getRandomValues !== 'function' ||
        typeof cryptoImpl.subtle?.digest !== 'function'
    ) {
        throw oauthError(
            'browser_unavailable',
            'More source OAuth requires Web Crypto with SHA-256 support.'
        );
    }
    return cryptoImpl;
}

/** 优先使用注入的凭证仓库，否则复用运行时的共享仓库。 */
function getCredentialStore(
    options?: Pick<PiOAuthDependencies, 'credentialStore'>
): CredentialStore {
    return options?.credentialStore ?? getPiCredentialStore();
}

/** 只解析已注册且支持浏览器登录的 OAuth 服务商，拒绝其他授权流程。 */
function getOAuthMetadata(providerId: string): OAuthMetadata {
    const registration = getPiProviderRegistration(providerId);
    const metadata = registration?.oauth;
    if (!metadata || metadata.providerId !== providerId) {
        throw oauthError(
            'unsupported_provider',
            `More source provider "${providerId}" does not support browser OAuth.`
        );
    }
    if (providerId !== ANTHROPIC_PROVIDER_ID && providerId !== OPENAI_CODEX_PROVIDER_ID) {
        throw oauthError(
            'unsupported_provider',
            `More source provider "${providerId}" does not support browser OAuth.`
        );
    }
    return metadata;
}

/** 将随机字节或摘要编码为无填充的 Base64URL，供 PKCE 和 state 使用。 */
function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** 用密码学随机数生成指定字节长度的 Base64URL 标识。 */
function randomBase64Url(cryptoImpl: CryptoLike, length: number): string {
    return bytesToBase64Url(cryptoImpl.getRandomValues(new Uint8Array(length)));
}

/** 生成仅保留在内存中的 verifier，并计算 S256 challenge。 */
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

/** 按服务商元数据组装授权地址，附带回调地址、scope、PKCE 和 state。 */
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

/** 短期记录已关闭尝试的原因，并限制记录数量，使重复回调可得到准确错误。 */
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

/** 关闭当前登录尝试，释放计时器和监听，清除 verifier 与 state，并记录关闭原因。 */
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

/** 使超时尝试失效并取消进行中的令牌交换。 */
function expireAttempt(attempt: PendingAttempt): void {
    closeAttempt(attempt, 'expired', true);
}

/** 将调用方取消传递给内部控制器，并返回解绑函数。 */
function linkAbortSignal(signal: AbortSignal | undefined, controller: AbortController): () => void {
    if (!signal) {
        return () => undefined;
    }
    /** 将外部取消转发给当前令牌操作。 */
    const onAbort = () => controller.abort();
    if (signal.aborted) {
        onAbort();
    } else {
        signal.addEventListener('abort', onAbort, { once: true });
    }
    return () => signal.removeEventListener('abort', onAbort);
}

/** 根据已关闭原因区分过期、取消和回调重复使用。 */
function errorForClosedAttempt(reason: ClosedAttemptReason): PiOAuthError {
    if (reason === 'expired') {
        return oauthError('attempt_expired', 'This More source OAuth login attempt has expired.');
    }
    if (reason === 'cancelled') {
        return cancellationError();
    }
    return oauthError('attempt_used', 'This More source OAuth callback has already been used.');
}

/** 取得仍处于待回调阶段的有效尝试，拒绝过期、已消费或已取消的记录。 */
function getPendingAttempt(attemptId: string, now: number): PendingAttempt {
    const attempt = pendingAttempts.get(attemptId);
    if (!attempt) {
        const closed = closedAttempts.get(attemptId);
        if (closed) {
            throw errorForClosedAttempt(closed.reason);
        }
        throw oauthError(
            'attempt_used',
            'No active More source OAuth login attempt matches this callback.'
        );
    }
    if (now >= attempt.expiresAt) {
        expireAttempt(attempt);
        throw oauthError('attempt_expired', 'This More source OAuth login attempt has expired.');
    }
    if (attempt.phase !== 'pending') {
        throw oauthError('attempt_used', 'This More source OAuth callback has already been used.');
    }
    if (attempt.controller.signal.aborted) {
        closeAttempt(attempt, 'cancelled', false);
        throw cancellationError();
    }
    return attempt;
}

/** 通过地址与 state 校验后提取的授权码回调，不再携带完整 URL。 */
type ParsedCallback = { code: string; state: string };

/** 补齐 URL 的默认端口，使回调地址校验不受显式端口写法影响。 */
function normalizePort(url: URL): string {
    if (url.port) {
        return url.port;
    }
    return url.protocol === 'http:' ? '80' : url.protocol === 'https:' ? '443' : '';
}

/**
 * 校验完整回环回调地址的协议、主机、端口、路径和 state，再提取授权码。
 * 回调必须属于当前尝试；服务商返回的授权错误也在此转换为固定错误。
 */
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
            'The More source OAuth callback does not match the registered loopback address.'
        );
    }

    const state = callback.searchParams.get('state') ?? '';
    if (!state || state !== attempt.state) {
        throw oauthError('state_mismatch', 'The More source OAuth callback state does not match.');
    }
    if (callback.searchParams.has('error')) {
        throw oauthError(
            'authorization_failed',
            'The OAuth provider did not authorize the More source login.'
        );
    }
    const code = callback.searchParams.get('code') ?? '';
    if (!code) {
        throw oauthError('invalid_callback', 'The More source OAuth callback is missing its code.');
    }
    return { code, state };
}

/** 综合信号和 OAuth 错误码识别取消，避免误报为网络或存储故障。 */
function isCancellation(error: unknown, signal: AbortSignal): boolean {
    return signal.aborted || (error instanceof PiOAuthError && error.code === 'cancelled');
}

/** 区分主动取消与浏览器网络失败，不透传可能含敏感请求数据的底层错误。 */
function normalizeFetchFailure(error: unknown, signal: AbortSignal): never {
    if (isCancellation(error, signal)) {
        throw cancellationError();
    }
    if (error instanceof TypeError) {
        throw oauthError(
            'browser_network',
            'The browser could not reach the More source OAuth token endpoint. Check network access and whether the provider allows browser CORS requests.'
        );
    }
    throw oauthError(
        'browser_network',
        'The More source OAuth token request failed in the browser.'
    );
}

/** 令牌交换的两种输入：首次登录使用授权码和 PKCE，续期使用刷新令牌。 */
type TokenGrant =
    | { type: 'authorization_code'; code: string; verifier: string; state: string }
    | { type: 'refresh_token'; refreshToken: string };

/** 已校验并统一字段名的令牌响应，持久化前还需计算过期时间和补齐账号信息。 */
type TokenData = {
    access: string;
    refresh: string;
    /** 服务商返回的有效时长，单位为秒，并非绝对时间戳。 */
    expiresInSeconds: number;
};

/** 按授权码或刷新令牌两种 grant 生成令牌请求字段，并遵循服务商的 state 约定。 */
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

/** 校验令牌接口状态和必需字段；刷新响应未返回 refresh_token 时保留原刷新令牌。 */
async function readTokenResponse(
    response: Response,
    fallbackRefreshToken?: string
): Promise<TokenData> {
    if (!response.ok) {
        throw oauthError(
            'token_http',
            `The More source OAuth token endpoint rejected the request (HTTP ${response.status}).`
        );
    }

    let body: unknown;
    try {
        body = JSON.parse(await response.text());
    } catch {
        throw oauthError(
            'token_response',
            'The More source OAuth token endpoint returned an invalid response.'
        );
    }
    if (!body || typeof body !== 'object') {
        throw oauthError(
            'token_response',
            'The More source OAuth token endpoint returned an invalid response.'
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
            'The More source OAuth token endpoint response is missing required fields.'
        );
    }
    return { access, refresh, expiresInSeconds: expiresIn };
}

/** 按服务商要求用 JSON 或表单交换令牌，并在请求前后检查取消。 */
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

/** 解码 JWT 中的 Base64URL JSON 数据，兼容缺少 TextDecoder 的浏览器。 */
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

/** 从访问令牌的账号声明中读取 Codex 所需账号标识；缺失时拒绝建立凭证。 */
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

/** 将令牌响应转换为 Pi OAuth 凭证，预留过期时间偏差，并补齐 Codex 账号标识。 */
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

/** 通过共享凭证队列保存登录结果，分别处理取消与存储失败。 */
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
            'More source OAuth login succeeded, but the credential could not be saved.'
        );
    }
}

/**
 * 创建带有效期的浏览器登录尝试，生成 PKCE 和 state，返回供界面打开的授权地址。
 * 秘密校验信息留在内存中，调用方取消或超时会关闭该尝试。
 */
export async function beginPiOAuth(
    providerId: string,
    options: BeginPiOAuthOptions = {}
): Promise<PiOAuthAttemptView> {
    throwIfAborted(options.signal);
    const metadata = getOAuthMetadata(providerId);
    const ttl = options.attemptTtlMs ?? DEFAULT_ATTEMPT_TTL_MS;
    if (!Number.isFinite(ttl) || ttl <= 0) {
        throw new RangeError('More source OAuth attemptTtlMs must be a positive number.');
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
        /** 关闭已取消的登录尝试，阻止随后到达的回调继续交换令牌。 */
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

/**
 * 校验并一次性消费回调，交换授权码后保存凭证，最终清理尝试状态。
 * 重复回调或交换期间取消都不能产生第二次有效登录。
 */
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

/** 按尝试编号取消登录，清除回调校验状态并中止未完成的交换。 */
export function cancelPiOAuth(attemptId: string): boolean {
    const attempt = pendingAttempts.get(attemptId);
    if (!attempt) {
        return false;
    }
    closeAttempt(attempt, 'cancelled', true);
    return true;
}

/** 取消全部待完成的登录尝试，供界面卸载和脚本清理使用。 */
export function cancelAllPiOAuth(): void {
    for (const attempt of [...pendingAttempts.values()]) {
        closeAttempt(attempt, 'cancelled', true);
    }
}

/** 先取消该服务商未完成的登录，再通过串行凭证仓库删除登录状态。 */
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
        throw oauthError(
            'credential_store',
            'The More source OAuth credential could not be removed.'
        );
    }
}

/** 返回是否已登录及过期时间等界面状态，不暴露访问令牌和刷新令牌。 */
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
        throw oauthError(
            'credential_store',
            'The More source OAuth credential status could not be read.'
        );
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

/**
 * 由界面强制刷新现有 OAuth 凭证，与 Pi 自动刷新共用同一服务商修改锁。
 * 操作使用捕获的凭证仓库和取消信号，刷新完成后再提交新凭证。
 */
export async function refreshPiOAuth(
    providerId: string,
    options: RefreshPiOAuthOptions = {}
): Promise<PiOAuthCredentialStatus> {
    throwIfAborted(options.signal);
    const auth = getBrowserOAuthAuth(providerId, options);
    const store = getCredentialStore(options);
    installPiAbortSignalPolyfills();
    const signal = AbortSignal.any([
        ...(options.signal ? [options.signal] : []),
        AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    ]);
    /** 生成缺少可刷新 OAuth 凭证的错误，供刷新入口统一报告。 */
    const missingCredential = () =>
        oauthError('missing_credential', 'Sign in before refreshing OAuth credentials.');
    try {
        const observed = await store.read(providerId, { signal });
        if (observed?.type !== 'oauth') {
            throw missingCredential();
        }
        const refreshed = await store.modify(
            providerId,
            async current => {
                throwIfAborted(signal);
                if (current?.type !== 'oauth') {
                    throw missingCredential();
                }
                // An automatic refresh or another login may have completed while we queued.
                // Keep that result instead of reusing or rotating its token a second time.
                if (
                    current.access !== observed.access ||
                    current.refresh !== observed.refresh ||
                    current.expires !== observed.expires
                ) {
                    return undefined;
                }
                return auth.refresh(current, signal);
            },
            { signal }
        );
        if (refreshed?.type !== 'oauth') {
            throw missingCredential();
        }
        return { loggedIn: true, type: 'oauth', expiresAt: refreshed.expires };
    } catch (error) {
        if (options.signal?.aborted) {
            throw cancellationError();
        }
        if (signal.aborted) {
            throw oauthError('browser_network', 'The OAuth credential refresh timed out.');
        }
        if (error instanceof PiOAuthError) {
            throw error;
        }
        throw oauthError('credential_store', 'The refreshed OAuth credential could not be saved.');
    }
}

/**
 * 将浏览器授权、刷新和凭证转换接入 Pi 的 OAuthAuth 契约。
 * 登录通过授权地址与手动回调交互完成，不启动 Node 回环服务器。
 */
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
        /** 通过 Pi 认证交互展示授权地址、接收回调，并在结束时释放登录尝试。 */
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
                throw oauthError(
                    'invalid_callback',
                    'More source OAuth callback input was cancelled.'
                );
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
        /** 为 Pi 自动续期交换 refresh_token，保留请求的取消信号并更新过期时间。 */
        async refresh(credential, signal) {
            const token = await requestTokens(
                metadata,
                { type: 'refresh_token', refreshToken: credential.refresh },
                signal,
                options
            );
            return credentialFromTokens(metadata, token, getNow(options)());
        },
        /** 把持久化 OAuth 凭证转换为 Pi 请求认证信息，保留服务商需要的账号字段。 */
        async toAuth(credential): Promise<ModelAuth> {
            if (metadata.providerId === OPENAI_CODEX_PROVIDER_ID) {
                extractOpenAIAccountId(credential.access);
            }
            return { apiKey: credential.access };
        },
    };
}

/** 按服务商解析浏览器 OAuth 实现，并传入可替换的请求和时钟依赖。 */
export function getBrowserOAuthAuth(
    providerId: string,
    options: BrowserOAuthAuthOptions = {}
): OAuthAuth {
    return createBrowserOAuthAuth(getOAuthMetadata(providerId), options);
}
