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

function resolveFetch(fetch_override?: FetchFunction): FetchFunction | undefined {
    const candidate = fetch_override ?? globalThis.fetch;
    return typeof candidate === 'function' ? candidate : undefined;
}

function resolveOrigin(origin_override?: string): string | undefined {
    const value = origin_override ?? globalThis.location?.origin;
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

function proxyUrl(target: string): string {
    return `/proxy/${encodeURIComponent(target)}`;
}

function exactResponseText(actual: string, expected: string): boolean {
    return actual.trim() === expected;
}

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

function abortReason(signal: AbortSignal): unknown {
    return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

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
        const on_abort = () => {
            cleanup();
            reject(abortReason(signal));
        };
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

/** Read the cached state without starting a probe. */
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

/** Cache confirmed states, retry transient failures, and merge concurrent checks per fetch/origin. */
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

/** Fail before a provider request can be submitted when ST cannot provide the proxy route. */
export async function assertSillyTavernProxyAvailable(
    options: SillyTavernProxyProbeOptions = {}
): Promise<void> {
    const status = await probeSillyTavernProxy(options);
    if (status !== 'enabled') {
        throw new PiProxyUnavailableError(status);
    }
}

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

function normalizeBasePath(pathname: string): string {
    return pathname === '/' ? '' : pathname.replace(/\/+$/, '');
}

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

function requestFromInput(input: FetchInput): Request | undefined {
    return typeof Request !== 'undefined' && input instanceof Request ? input : undefined;
}

function requestUrl(input: FetchInput, request: Request | undefined): string {
    return request?.url ?? input.toString();
}

function requestMethod(request: Request | undefined, init?: RequestInit): string {
    return (init?.method ?? request?.method ?? 'GET').toUpperCase();
}

function requestHeaders(request: Request | undefined, init?: RequestInit): HeadersInit | undefined {
    return init?.headers ?? request?.headers;
}

function requestSignal(
    request: Request | undefined,
    init?: RequestInit
): AbortSignal | null | undefined {
    if (init && 'signal' in init) {
        return init.signal;
    }
    return request?.signal;
}

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

function throwIfAborted(signal: AbortSignal | null | undefined): void {
    if (signal?.aborted) {
        throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
    }
}

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
 * Create a credential-bearing fetch that is constrained to one provider base URL and relays
 * requests through SillyTavern's generic CORS proxy.
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

/** @internal Test-only reset for module-level probe state. */
export function resetSillyTavernProxyStatusForTests(): void {
    probe_cache = new WeakMap();
}
