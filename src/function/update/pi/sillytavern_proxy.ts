import type { FetchFunction } from './pi_gateway';

const PROXY_DISABLED_MESSAGE =
    'CORS proxy is disabled. Enable it in config.yaml or use the --corsProxy flag.';
const PROXY_PROBE_BODY = 'mvu-st-cors-proxy-probe';
const PROXY_PROBE_TARGET = `data:text/plain,${PROXY_PROBE_BODY}`;
const PROXY_PROBE_TIMEOUT_MS = 5_000;

/** 酒馆 CORS 代理的探测状态，区分未检查、检查中和三种已完成结果。 */
export type SillyTavernProxyStatus =
    | 'unchecked'
    | 'checking'
    | 'enabled'
    | 'disabled'
    | 'unavailable';

/** 一次探测完成后可缓存的结果：已启用、明确关闭或当前不可用。 */
export type SillyTavernProxyTerminalStatus = Extract<
    SillyTavernProxyStatus,
    'enabled' | 'disabled' | 'unavailable'
>;

/** 代理探测的环境与缓存选项，允许测试注入传输和酒馆源地址。 */
export interface SillyTavernProxyProbeOptions {
    /** 默认使用页面的 fetch 实现。 */
    fetch?: FetchFunction;
    /** 默认从页面基础地址或 location 解析酒馆源地址。 */
    origin?: string;
    /** 仅取消当前调用方的等待，不中止其他调用方共用的探测。 */
    signal?: AbortSignal;
    /** 忽略已缓存的完成结果，重新检查酒馆代理路由。 */
    force?: boolean;
}

/** 创建代理 fetch 所需的配置，限定携带凭证请求能够访问的目标范围。 */
export interface SillyTavernProxyFetchOptions extends SillyTavernProxyProbeOptions {
    /**
     * 服务商 API 基础地址；返回的 fetch 仅允许向同源、同路径或下级路径转发凭证。
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

/** 与 Pi fetch 契约保持一致的请求目标，可为 URL、字符串或 Request。 */
type FetchInput = Parameters<FetchFunction>[0];

/** 按 fetch 实现及酒馆源地址共享的探测记录，用 promise 合并同时发起的检查。 */
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

/** 保留原始应答格式，仅遮盖上游可能在错误正文中回显的本次请求凭证。 */
function redactProxyResponseBody(
    body: string,
    headers: HeadersInit | undefined,
    target: URL
): string {
    const credentials = new Set<string>();
    for (const name of ['authorization', 'x-api-key', 'x-goog-api-key', 'api-key']) {
        const value = getHeader(headers, name)?.trim();
        if (value) {
            credentials.add(value);
            credentials.add(value.replace(/^Bearer\s+/i, ''));
        }
    }
    for (const [name, value] of target.searchParams) {
        if (/^(?:key|api[_-]?key|(?:access[_-]?)?token)$/i.test(name) && value) {
            credentials.add(value);
        }
    }
    for (const credential of [...credentials].filter(Boolean).sort((a, b) => b.length - a.length)) {
        body = body.split(credential).join('[REDACTED]');
    }
    return body;
}

/** 异步读取克隆应答，在流结束或中断后输出 debug 日志，不占用 SDK 的正文。 */
async function debugProxyResponse(
    response: Response,
    target: URL,
    method: string,
    headers: HeadersInit | undefined,
    signal: AbortSignal | null | undefined
): Promise<void> {
    const copy = response.clone();
    const reader = copy.body?.getReader();
    let body = '';
    let complete = false;
    // 不等待 tee 分支的 cancel：其 Promise 可能要等 SDK 也结束读取才完成。
    const on_abort = () => {
        void reader?.cancel().catch(() => {});
    };
    try {
        if (reader) {
            const decoder = new TextDecoder();
            signal?.addEventListener('abort', on_abort, { once: true });
            if (signal?.aborted) {
                on_abort();
            }
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) {
                    body += decoder.decode();
                    complete = !signal?.aborted;
                    break;
                }
                body += decoder.decode(chunk.value, { stream: true });
            }
        } else {
            body = await copy.text();
            complete = !signal?.aborted;
        }
    } catch {
        // 读取失败时仍记录已收到的部分；日志失败不能改变请求结果。
    } finally {
        signal?.removeEventListener('abort', on_abort);
        reader?.releaseLock();
    }
    console.debug(
        '[MVU Pi Proxy] raw response',
        { method, url: `${target.origin}${target.pathname}`, status: response.status, complete },
        redactProxyResponseBody(body, headers, target)
    );
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
        void debugProxyResponse(response, target, method, headers, signal).catch(() => {});
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
