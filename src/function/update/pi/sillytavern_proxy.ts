import type { FetchFunction } from './pi_gateway';

const PROXY_DISABLED_MESSAGE =
    'CORS proxy is disabled. Enable it in config.yaml or use the --corsProxy flag.';
const PROXY_PROBE_BODY = 'mvu-st-cors-proxy-probe';
const PROXY_PROBE_TARGET = `data:text/plain,${PROXY_PROBE_BODY}`;
const PROXY_PROBE_TIMEOUT_MS = 5_000;

export type SillyTavernProxyStatus =
    | 'unchecked'
    | 'checking'
    | 'enabled'
    | 'disabled'
    | 'unavailable';

export type SillyTavernProxyTerminalStatus = Extract<
    SillyTavernProxyStatus,
    'enabled' | 'disabled' | 'unavailable'
>;

export interface SillyTavernProxyProbeOptions {
    /** Defaults to the page's fetch implementation. */
    fetch?: FetchFunction;
    /** Defaults to the page origin. Exposed for deterministic tests. */
    origin?: string;
    /** Stops waiting for the shared probe without cancelling another caller's check. */
    signal?: AbortSignal;
    /** Ignore a cached terminal result and verify the live SillyTavern route again. */
    force?: boolean;
}

export interface SillyTavernProxyFetchOptions extends SillyTavernProxyProbeOptions {
    /**
     * Provider API base URL. Only this origin and this path (or descendants) may receive the
     * credentials carried by the returned fetch implementation.
     */
    baseUrl: string | URL;
}

export class PiProxyUnavailableError extends Error {
    readonly code = 'proxy_unavailable';
    readonly retryable = false;

    /** 区分代理未启用和不可用，并标记为发送前应终止的配置类失败。 */
    constructor(readonly status: Exclude<SillyTavernProxyTerminalStatus, 'enabled'>) {
        super(
            status === 'disabled'
                ? 'SillyTavern CORS proxy is not enabled'
                : 'SillyTavern CORS proxy is unavailable'
        );
        this.name = 'PiProxyUnavailableError';
    }
}

type FetchInput = Parameters<FetchFunction>[0];

type ProbeEntry = {
    status: SillyTavernProxyStatus;
    promise?: Promise<SillyTavernProxyTerminalStatus>;
};

let probe_cache = new WeakMap<FetchFunction, Map<string, ProbeEntry>>();

/** 读取注入或全局 fetch；浏览器缺少请求能力时返回 undefined。 */
function resolveFetch(fetch_override?: FetchFunction): FetchFunction | undefined {
    const candidate = fetch_override ?? globalThis.fetch;
    return typeof candidate === 'function' ? candidate : undefined;
}

/** 从覆盖值或文档基础地址解析酒馆源地址，兼容 origin 为 null 的 srcdoc 脚本。 */
function resolveOrigin(origin_override?: string): string | undefined {
    // Slash normally hosts scripts in srcdoc, where location.origin is "null" despite
    // inheriting the parent's origin. Use the same document base as relative browser fetch;
    // Slash's Blob mode also supplies a <base> pointing to SillyTavern.
    const value = origin_override ?? globalThis.document?.baseURI ?? globalThis.location?.origin;
    if (!value) {
        return undefined;
    }
    try {
        const origin = new URL(value).origin;
        return origin === 'null' ? undefined : origin;
    } catch {
        return undefined;
    }
}

/** 按 fetch 实现与酒馆源地址隔离探测缓存，复用同一目标的进行中检查。 */
function getProbeEntry(fetch_impl: FetchFunction, origin: string): ProbeEntry {
    let entries = probe_cache.get(fetch_impl);
    if (!entries) {
        entries = new Map();
        probe_cache.set(fetch_impl, entries);
    }
    let entry = entries.get(origin);
    if (!entry) {
        entry = { status: 'unchecked' };
        entries.set(origin, entry);
    }
    return entry;
}

/** 将完整目标地址编码进酒馆通用 CORS 代理路径。 */
function proxyUrl(target: string): string {
    return `/proxy/${encodeURIComponent(target)}`;
}

/** 忽略首尾空白后精确核对探测正文，避免把其他页面误识别为代理结果。 */
function exactResponseText(actual: string, expected: string): boolean {
    return actual.trim() === expected;
}

/** 通过本地 data URL 和超时限制探测代理，区分启用、关闭和暂时不可达。 */
async function performProbe(fetch_impl: FetchFunction): Promise<SillyTavernProxyTerminalStatus> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROXY_PROBE_TIMEOUT_MS);
    try {
        // node-fetch resolves this data URL locally. Unlike a same-origin circular sentinel, it
        // remains reliable when SillyTavern is behind an HTTPS reverse proxy.
        const response = await fetch_impl(proxyUrl(PROXY_PROBE_TARGET), {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal,
        });
        const body = await response.text();
        if (response.status === 200 && exactResponseText(body, PROXY_PROBE_BODY)) {
            return 'enabled';
        }
        if (response.status === 404 && exactResponseText(body, PROXY_DISABLED_MESSAGE)) {
            return 'disabled';
        }
        return 'unavailable';
    } catch {
        return 'unavailable';
    } finally {
        clearTimeout(timeout);
    }
}

/** 保留信号原始取消原因，缺失时补齐标准 AbortError。 */
function abortReason(signal: AbortSignal): unknown {
    return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

/** 允许调用方取消对共享探测的等待，不中断其他调用方共用的探测请求。 */
function waitForProbe(
    promise: Promise<SillyTavernProxyTerminalStatus>,
    signal?: AbortSignal
): Promise<SillyTavernProxyTerminalStatus> {
    if (!signal) {
        return promise;
    }
    if (signal.aborted) {
        return Promise.reject(abortReason(signal));
    }
    return new Promise((resolve, reject) => {
        /** 解除当前等待者的监听并拒绝其 Promise，保留共享探测继续运行。 */
        const on_abort = () => {
            cleanup();
            reject(abortReason(signal));
        };
        /** 移除当前等待者的取消监听，避免探测结束后残留引用。 */
        const cleanup = () => signal.removeEventListener('abort', on_abort);
        signal.addEventListener('abort', on_abort, { once: true });
        promise.then(
            status => {
                cleanup();
                resolve(status);
            },
            error => {
                cleanup();
                reject(error);
            }
        );
    });
}

/** 只读取缓存中的代理状态，不触发新的网络探测。 */
export function getSillyTavernProxyStatus(
    options: SillyTavernProxyProbeOptions = {}
): SillyTavernProxyStatus {
    const fetch_impl = resolveFetch(options.fetch);
    const origin = resolveOrigin(options.origin);
    if (!fetch_impl || !origin) {
        return 'unavailable';
    }
    return getProbeEntry(fetch_impl, origin).status;
}

/**
 * 合并并发探测并缓存确定的启用或关闭状态，暂时失败允许重试。
 * force 可重新核对服务端状态；单个等待者取消不影响共享探测。
 */
export function probeSillyTavernProxy(
    options: SillyTavernProxyProbeOptions = {}
): Promise<SillyTavernProxyTerminalStatus> {
    const fetch_impl = resolveFetch(options.fetch);
    const origin = resolveOrigin(options.origin);
    if (!fetch_impl || !origin) {
        return Promise.resolve('unavailable');
    }

    const entry = getProbeEntry(fetch_impl, origin);
    if (entry.promise) {
        return waitForProbe(entry.promise, options.signal);
    }
    if (!options.force && (entry.status === 'enabled' || entry.status === 'disabled')) {
        return waitForProbe(Promise.resolve(entry.status), options.signal);
    }

    entry.status = 'checking';
    entry.promise = performProbe(fetch_impl).then(status => {
        entry.status = status;
        entry.promise = undefined;
        return status;
    });
    return waitForProbe(entry.promise, options.signal);
}

/** 在发送带凭证的服务商请求前确认代理可用，不可用时立即报错。 */
export async function assertSillyTavernProxyAvailable(
    options: SillyTavernProxyProbeOptions = {}
): Promise<void> {
    const status = await probeSillyTavernProxy(options);
    if (status !== 'enabled') {
        throw new PiProxyUnavailableError(status);
    }
}

/** 要求不含内嵌凭证的绝对 HTTP(S) 地址，作为代理目标的第一层校验。 */
function parseHttpUrl(value: string | URL, name: string): URL {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new TypeError(`${name} must be an absolute HTTP(S) URL`);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new TypeError(`${name} must be an absolute HTTP(S) URL without credentials`);
    }
    return url;
}

/** 去除基础路径末尾斜杠，便于严格比较目标路径边界。 */
function normalizeBasePath(pathname: string): string {
    return pathname === '/' ? '' : pathname.replace(/\/+$/, '');
}

/** 限制请求必须位于配置服务商的同源基础路径内，避免凭证随代理流向其他目标。 */
function assertTargetAllowed(target: URL, base: URL): void {
    const base_path = normalizeBasePath(base.pathname);
    const in_base_path =
        base_path === '' ||
        target.pathname === base_path ||
        target.pathname.startsWith(`${base_path}/`);
    if (target.origin !== base.origin || !in_base_path) {
        throw new TypeError('SillyTavern proxy target is outside the configured provider base URL');
    }
}

/** 识别 Request 输入，供后续按 fetch 语义合并 init 覆盖值。 */
function requestFromInput(input: FetchInput): Request | undefined {
    return typeof Request !== 'undefined' && input instanceof Request ? input : undefined;
}

/** 统一取得字符串、URL 或 Request 输入对应的目标地址。 */
function requestUrl(input: FetchInput, request: Request | undefined): string {
    return request?.url ?? input.toString();
}

/** 按 init 优先、Request 次之的顺序解析 HTTP 方法并统一大写。 */
function requestMethod(request: Request | undefined, init?: RequestInit): string {
    return (init?.method ?? request?.method ?? 'GET').toUpperCase();
}

/** 遵循 fetch 的覆盖顺序解析本次请求头。 */
function requestHeaders(request: Request | undefined, init?: RequestInit): HeadersInit | undefined {
    return init?.headers ?? request?.headers;
}

/** 保留 init 显式传入的取消信号或 null，否则继承 Request 的信号。 */
function requestSignal(
    request: Request | undefined,
    init?: RequestInit
): AbortSignal | null | undefined {
    if (init && 'signal' in init) {
        return init.signal;
    }
    return request?.signal;
}

/** 将可重放的请求体转换为文本，拒绝无法安全复用的流或其他载荷。 */
async function bodyToText(body: BodyInit): Promise<string> {
    if (typeof body === 'string') {
        return body;
    }
    if (body instanceof URLSearchParams) {
        return body.toString();
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
        return body.text();
    }
    if (body instanceof ArrayBuffer) {
        return new TextDecoder().decode(new Uint8Array(body));
    }
    if (ArrayBuffer.isView(body)) {
        return new TextDecoder().decode(
            new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
        );
    }
    throw new TypeError('SillyTavern proxy only supports replayable JSON request bodies');
}

/** 优先读取 init 请求体，必要时克隆 Request 读取，避免消费原始输入。 */
async function requestBodyText(
    request: Request | undefined,
    init?: RequestInit
): Promise<string | undefined> {
    if (init?.body !== undefined && init.body !== null) {
        return bodyToText(init.body);
    }
    if (init && 'body' in init && init.body === null) {
        return undefined;
    }
    if (request?.body !== null && request !== undefined) {
        return request.clone().text();
    }
    return undefined;
}

/** 从 Headers、键值数组或对象中按大小写不敏感名称查找请求头。 */
function getHeader(headers: HeadersInit | undefined, wanted_name: string): string | undefined {
    if (!headers) {
        return undefined;
    }
    const wanted = wanted_name.toLowerCase();
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        return headers.get(wanted_name) ?? undefined;
    }
    if (Array.isArray(headers)) {
        return headers.find(([name]) => name.toLowerCase() === wanted)?.[1];
    }
    const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === wanted);
    return entry?.[1] === undefined ? undefined : String(entry[1]);
}

/** 确认带正文的代理请求使用受支持的方法、JSON 类型和合法 JSON 内容。 */
function assertJsonBody(method: string, headers: HeadersInit | undefined, body?: string): void {
    if (body === undefined) {
        return;
    }
    if (!['POST', 'PUT', 'PATCH'].includes(method)) {
        throw new TypeError(`SillyTavern proxy does not forward request bodies for ${method}`);
    }
    const content_type = getHeader(headers, 'content-type') ?? '';
    if (!/^application\/json(?:\s*;|$)/i.test(content_type)) {
        throw new TypeError('SillyTavern proxy requires Content-Type: application/json');
    }
    try {
        JSON.parse(body);
    } catch {
        throw new TypeError('SillyTavern proxy request body must be valid JSON');
    }
}

/** 在准备和转发请求的边界检查取消状态，保留原始取消原因。 */
function throwIfAborted(signal: AbortSignal | null | undefined): void {
    if (signal?.aborted) {
        throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
    }
}

/** 检查返回值是否为酒馆明确的代理关闭提示，不把普通上游 404 误判为代理关闭。 */
async function isDisabledProxyResponse(response: Response): Promise<boolean> {
    if (response.status !== 404) {
        return false;
    }
    try {
        return exactResponseText(await response.clone().text(), PROXY_DISABLED_MESSAGE);
    } catch {
        return false;
    }
}

/** 将实际请求发现的代理终态写回对应探测缓存。 */
function cacheTerminalStatus(
    fetch_impl: FetchFunction,
    origin: string,
    status: SillyTavernProxyTerminalStatus
): void {
    const entry = getProbeEntry(fetch_impl, origin);
    entry.status = status;
    entry.promise = undefined;
}

/**
 * 创建受单一服务商基础地址约束的代理 fetch，转发认证头、JSON 正文和取消信号。
 * 发送前确认代理可用，目标越界或载荷不兼容时拒绝转发。
 */
export function createSillyTavernProxyFetch(options: SillyTavernProxyFetchOptions): FetchFunction {
    const base = parseHttpUrl(options.baseUrl, 'baseUrl');

    return async (input: FetchInput, init?: RequestInit): Promise<Response> => {
        const fetch_impl = resolveFetch(options.fetch);
        const origin = resolveOrigin(options.origin);
        if (!fetch_impl || !origin) {
            throw new PiProxyUnavailableError('unavailable');
        }

        const request = requestFromInput(input);
        const target = parseHttpUrl(requestUrl(input, request), 'proxy target');
        assertTargetAllowed(target, base);

        const method = requestMethod(request, init);
        const headers = requestHeaders(request, init);
        const signal = requestSignal(request, init);
        throwIfAborted(signal);
        const body = await requestBodyText(request, init);
        assertJsonBody(method, headers, body);

        await assertSillyTavernProxyAvailable({
            fetch: fetch_impl,
            origin,
            ...(signal == null ? {} : { signal }),
        });
        throwIfAborted(signal);

        const response = await fetch_impl(proxyUrl(target.href), {
            method,
            ...(headers === undefined ? {} : { headers }),
            ...(body === undefined ? {} : { body }),
            ...(signal === undefined ? {} : { signal }),
            credentials: 'same-origin',
        });
        if (await isDisabledProxyResponse(response)) {
            cacheTerminalStatus(fetch_impl, origin, 'disabled');
            throw new PiProxyUnavailableError('disabled');
        }
        return response;
    };
}

/** @internal 仅供测试清空模块级探测缓存，避免用例之间共享状态。 */
export function resetSillyTavernProxyStatusForTests(): void {
    probe_cache = new WeakMap();
}
