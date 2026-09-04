import {
    assertSillyTavernProxyAvailable,
    createSillyTavernProxyFetch,
    getSillyTavernProxyStatus,
    PiProxyUnavailableError,
    probeSillyTavernProxy,
    resetSillyTavernProxyStatusForTests,
} from '@/function/update/pi/sillytavern_proxy';

type FetchMock = jest.Mock<Promise<Response>, [RequestInfo | URL, RequestInit?]>;

const ST_ORIGIN = 'http://st.local:8000';
const PROBE_BODY = 'mvu-st-cors-proxy-probe';
const PROBE_TARGET = `data:text/plain,${PROBE_BODY}`;
const DISABLED_MESSAGE =
    'CORS proxy is disabled. Enable it in config.yaml or use the --corsProxy flag.';

function textResponse(body: string, status: number): Response {
    const response = {
        ok: status >= 200 && status < 300,
        status,
        text: jest.fn().mockResolvedValue(body),
        clone: jest.fn(() => textResponse(body, status)),
    };
    return response as unknown as Response;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(fulfil => {
        resolve = fulfil;
    });
    return { promise, resolve };
}

describe('SillyTavern CORS proxy transport', () => {
    beforeEach(() => {
        resetSillyTavernProxyStatusForTests();
    });

    it('uses a local data sentinel and caches an enabled result', async () => {
        const fetchMock: FetchMock = jest.fn().mockResolvedValue(textResponse(PROBE_BODY, 200));
        const options = { fetch: fetchMock, origin: ST_ORIGIN };

        expect(getSillyTavernProxyStatus(options)).toBe('unchecked');
        await expect(probeSillyTavernProxy(options)).resolves.toBe('enabled');
        await expect(probeSillyTavernProxy(options)).resolves.toBe('enabled');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            `/proxy/${encodeURIComponent(PROBE_TARGET)}`,
            expect.objectContaining({
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
                signal: expect.any(AbortSignal),
            })
        );
        expect(getSillyTavernProxyStatus(options)).toBe('enabled');
    });

    it('merges concurrent probes for the same fetch and origin', async () => {
        const pending = deferred<Response>();
        const fetchMock: FetchMock = jest.fn().mockReturnValue(pending.promise);
        const options = { fetch: fetchMock, origin: ST_ORIGIN };

        const first = probeSillyTavernProxy(options);
        const second = probeSillyTavernProxy(options);

        expect(first).toBe(second);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(getSillyTavernProxyStatus(options)).toBe('checking');

        pending.resolve(textResponse(PROBE_BODY, 200));
        await expect(Promise.all([first, second])).resolves.toEqual(['enabled', 'enabled']);
    });

    it('recognizes the exact disabled response and assert throws a non-retryable error', async () => {
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValue(textResponse(DISABLED_MESSAGE, 404));
        const options = { fetch: fetchMock, origin: ST_ORIGIN };

        await expect(assertSillyTavernProxyAvailable(options)).rejects.toMatchObject({
            name: 'PiProxyUnavailableError',
            code: 'proxy_unavailable',
            retryable: false,
            status: 'disabled',
        });
        expect(getSillyTavernProxyStatus(options)).toBe('disabled');
        await expect(probeSillyTavernProxy(options)).resolves.toBe('disabled');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('treats an unexpected probe response as unavailable', async () => {
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValue(textResponse('Cannot GET /proxy/example', 404));
        const options = { fetch: fetchMock, origin: ST_ORIGIN };

        await expect(probeSillyTavernProxy(options)).resolves.toBe('unavailable');
        await expect(assertSillyTavernProxyAvailable(options)).rejects.toBeInstanceOf(
            PiProxyUnavailableError
        );
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('can force a fresh route check after a cached terminal result', async () => {
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValueOnce(textResponse(PROBE_BODY, 200))
            .mockResolvedValueOnce(textResponse(DISABLED_MESSAGE, 404));
        const options = { fetch: fetchMock, origin: ST_ORIGIN };

        await expect(probeSillyTavernProxy(options)).resolves.toBe('enabled');
        await expect(probeSillyTavernProxy(options)).resolves.toBe('enabled');
        await expect(probeSillyTavernProxy({ ...options, force: true })).resolves.toBe('disabled');

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(getSillyTavernProxyStatus(options)).toBe('disabled');
    });

    it('lets a caller stop waiting without poisoning the shared probe result', async () => {
        const pending = deferred<Response>();
        const fetchMock: FetchMock = jest.fn().mockReturnValue(pending.promise);
        const options = { fetch: fetchMock, origin: ST_ORIGIN };
        const controller = new AbortController();
        const reason = new Error('stop waiting');

        const waiting = probeSillyTavernProxy({ ...options, signal: controller.signal });
        controller.abort(reason);
        await expect(waiting).rejects.toBe(reason);

        pending.resolve(textResponse(PROBE_BODY, 200));
        await expect(probeSillyTavernProxy(options)).resolves.toBe('enabled');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('encodes the complete target and preserves request data', async () => {
        const providerResponse = textResponse('provider stream', 200);
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValueOnce(textResponse(PROBE_BODY, 200))
            .mockResolvedValueOnce(providerResponse);
        const proxyFetch = createSillyTavernProxyFetch({
            baseUrl: 'https://api.example.test/v1',
            fetch: fetchMock,
            origin: ST_ORIGIN,
        });
        const target = 'https://api.example.test/v1/responses?beta=a%2Fb&cursor=one+two';
        const headers = {
            authorization: 'Bearer test-key',
            'content-type': 'application/json; charset=utf-8',
            'x-provider-header': 'keep-me',
        };
        const body = '{"model":"test","stream":true}';
        const controller = new AbortController();

        await expect(
            proxyFetch(target, {
                method: 'POST',
                headers,
                body,
                signal: controller.signal,
            })
        ).resolves.toBe(providerResponse);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1]).toEqual([
            `/proxy/${encodeURIComponent(target)}`,
            {
                method: 'POST',
                headers,
                body,
                signal: controller.signal,
                credentials: 'same-origin',
            },
        ]);
    });

    it.each([
        'https://other.example.test/v1/responses',
        'https://api.example.test/v10/responses',
        'https://api.example.test/other',
    ])('rejects a target outside the provider base URL: %s', async target => {
        const fetchMock: FetchMock = jest.fn();
        const proxyFetch = createSillyTavernProxyFetch({
            baseUrl: 'https://api.example.test/v1',
            fetch: fetchMock,
            origin: ST_ORIGIN,
        });

        await expect(
            proxyFetch(target, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
            })
        ).rejects.toThrow('outside the configured provider base URL');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects non-JSON bodies before probing or submitting a request', async () => {
        const fetchMock: FetchMock = jest.fn();
        const proxyFetch = createSillyTavernProxyFetch({
            baseUrl: 'https://api.example.test/v1',
            fetch: fetchMock,
            origin: ST_ORIGIN,
        });

        await expect(
            proxyFetch('https://api.example.test/v1/messages', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: 'not-json',
            })
        ).rejects.toThrow('must be valid JSON');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('turns only the exact disabled fallback into PiProxyUnavailableError', async () => {
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValueOnce(textResponse(PROBE_BODY, 200))
            .mockResolvedValueOnce(textResponse(DISABLED_MESSAGE, 404));
        const options = { fetch: fetchMock, origin: ST_ORIGIN };
        const proxyFetch = createSillyTavernProxyFetch({
            ...options,
            baseUrl: 'https://api.example.test/v1',
        });

        await expect(proxyFetch('https://api.example.test/v1/models')).rejects.toMatchObject({
            name: 'PiProxyUnavailableError',
            status: 'disabled',
        });
        expect(getSillyTavernProxyStatus(options)).toBe('disabled');
    });

    it('preserves an ordinary upstream 404 response', async () => {
        const upstream404 = textResponse('{"error":"model not found"}', 404);
        const fetchMock: FetchMock = jest
            .fn()
            .mockResolvedValueOnce(textResponse(PROBE_BODY, 200))
            .mockResolvedValueOnce(upstream404);
        const proxyFetch = createSillyTavernProxyFetch({
            baseUrl: 'https://api.example.test/v1',
            fetch: fetchMock,
            origin: ST_ORIGIN,
        });

        await expect(proxyFetch('https://api.example.test/v1/models')).resolves.toBe(upstream404);
    });

    it('does not probe or submit when the provider signal is already aborted', async () => {
        const fetchMock: FetchMock = jest.fn();
        const proxyFetch = createSillyTavernProxyFetch({
            baseUrl: 'https://api.example.test/v1',
            fetch: fetchMock,
            origin: ST_ORIGIN,
        });
        const controller = new AbortController();
        const reason = new Error('cancelled');
        controller.abort(reason);

        await expect(
            proxyFetch('https://api.example.test/v1/responses', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
                signal: controller.signal,
            })
        ).rejects.toBe(reason);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
