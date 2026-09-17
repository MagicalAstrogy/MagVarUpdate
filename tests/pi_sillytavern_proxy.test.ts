/**
 * 测试场景：通过模拟请求验证酒馆 CORS 代理探测、共享缓存、调用方取消，以及目标和 JSON 载荷约束。
 */
import { TextDecoder, TextEncoder } from 'node:util';
import {
    assertSillyTavernProxyAvailable,
    createSillyTavernProxyFetch,
    getSillyTavernProxyStatus,
    PiProxyUnavailableError,
    probeSillyTavernProxy,
    resetSillyTavernProxyStatusForTests,
} from '@/function/update/pi/sillytavern_proxy';

Object.assign(globalThis, { TextDecoder, TextEncoder });

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

// 代理传输契约：探测结果准确，凭证只转发到配置目标，取消不会污染其他调用方。
describe('SillyTavern CORS proxy transport', () => {
    let debugSpy: jest.SpyInstance;

    beforeEach(() => {
        resetSillyTavernProxyStatusForTests();
        debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    });

    afterEach(() => {
        debugSpy.mockRestore();
    });

    // 探测与缓存：兼容 srcdoc 基础地址，使用本地探测载荷并合并并发检查。
    it('resolves the proxy from the inherited document base in a srcdoc iframe', async () => {
        const { readFileSync } = jest.requireActual('node:fs') as typeof import('node:fs');
        const { runInNewContext } = jest.requireActual('node:vm') as typeof import('node:vm');
        const ts = jest.requireActual('typescript') as typeof import('typescript');
        const source = readFileSync('src/function/update/pi/sillytavern_proxy.ts', 'utf8');
        const compiled = ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText;
        const exported: Partial<typeof import('@/function/update/pi/sillytavern_proxy')> = {};
        // Slash's default script host is srcdoc: location.origin is "null", while relative
        // fetch resolves against the inherited document.baseURI of the SillyTavern page.
        runInNewContext(compiled, {
            exports: exported,
            URL,
            AbortController,
            setTimeout,
            clearTimeout,
            location: { origin: 'null', href: 'about:srcdoc' },
            document: { baseURI: `${ST_ORIGIN}/` },
        });
        const fetchMock: FetchMock = jest.fn().mockResolvedValue(textResponse(PROBE_BODY, 200));

        await expect(exported.probeSillyTavernProxy!({ fetch: fetchMock })).resolves.toBe(
            'enabled'
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(exported.getSillyTavernProxyStatus!({ fetch: fetchMock })).toBe('enabled');
        // An invalid explicit override must still fail closed.
        await expect(
            exported.probeSillyTavernProxy!({ fetch: fetchMock, origin: 'null' })
        ).resolves.toBe('unavailable');
        expect(fetchMock).toHaveBeenCalledTimes(1);
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
        expect(debugSpy).not.toHaveBeenCalled();
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

    // 探测终态：精确区分关闭与暂时不可用，可强制复查或单独取消等待。
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

    // 请求转发边界：保留完整地址与请求数据，拒绝目标越界和非 JSON 正文。
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

    // 响应及取消：只将酒馆精确关闭提示归类为代理错误，普通上游 404 保持原样。
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

    // 原始响应日志：覆盖成功、错误、流式分块和中断，保持调用方响应及取消语义。
    describe('raw response debug logging', () => {
        const target = 'https://api.example.test/v1/responses';

        function proxyReturning(response: Response) {
            return createSillyTavernProxyFetch({
                baseUrl: 'https://api.example.test/v1',
                origin: ST_ORIGIN,
                fetch: jest
                    .fn()
                    .mockResolvedValueOnce(textResponse(PROBE_BODY, 200))
                    .mockResolvedValueOnce(response),
            });
        }

        it.each([200, 400])('logs the untouched HTTP %s body at debug level', async status => {
            const body = '{\n  "message": "原始应答", "extra": [1, 2]\n}\n';
            const response = textResponse(body, status);

            await expect(
                proxyReturning(response)(`${target}?cursor=private-query`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: '{}',
                })
            ).resolves.toBe(response);

            expect(response.text).not.toHaveBeenCalled();
            expect(debugSpy).toHaveBeenCalledTimes(1);
            expect(debugSpy).toHaveBeenCalledWith(
                '[MVU Pi Proxy] raw response',
                { method: 'POST', url: target, status, complete: true },
                body
            );
            await expect(response.text()).resolves.toBe(body);
        });

        it('redacts echoed credentials while leaving the provider response intact', async () => {
            const body =
                'Bearer oauth-secret / oauth-secret / anthropic-secret / google-secret / query-secret';
            const response = textResponse(body, 401);

            await proxyReturning(response)(`${target}?key=query-secret`, {
                headers: {
                    Authorization: 'Bearer oauth-secret',
                    'x-api-key': 'anthropic-secret',
                    'x-goog-api-key': 'google-secret',
                },
            });

            expect(debugSpy).toHaveBeenCalledWith(
                '[MVU Pi Proxy] raw response',
                { method: 'GET', url: target, status: 401, complete: true },
                '[REDACTED] / [REDACTED] / [REDACTED] / [REDACTED] / [REDACTED]'
            );
            await expect(response.text()).resolves.toBe(body);
        });

        it('returns before SSE completion and preserves UTF-8 split across chunks', async () => {
            let controller!: ReadableStreamDefaultController<Uint8Array>;
            const stream = new ReadableStream<Uint8Array>({
                start(value) {
                    controller = value;
                },
            });
            const response = textResponse('SDK body', 200);
            jest.mocked(response.clone).mockReturnValue({ body: stream } as Response);
            const logged = deferred<unknown[]>();
            debugSpy.mockImplementation((...args) => logged.resolve(args));

            // 流尚未结束，fetch 已返回；SDK 自己的正文不被日志读取。
            await expect(proxyReturning(response)(target)).resolves.toBe(response);
            expect(debugSpy).not.toHaveBeenCalled();
            expect(response.text).not.toHaveBeenCalled();

            const body =
                'event: response.output_text.delta\ndata: {"delta":"你好"}\n\ndata: [DONE]\n\n';
            const bytes = new TextEncoder().encode(body);
            const split = bytes.findIndex(byte => byte > 127) + 1;
            controller.enqueue(bytes.slice(0, split));
            controller.enqueue(bytes.slice(split));
            controller.close();

            await expect(logged.promise).resolves.toEqual([
                '[MVU Pi Proxy] raw response',
                { method: 'GET', url: target, status: 200, complete: true },
                body,
            ]);
            expect(stream.locked).toBe(false);
        });

        it.each(['abort', 'read error'])(
            'logs partial SSE after %s without affecting fetch',
            async stop => {
                let controller!: ReadableStreamDefaultController<Uint8Array>;
                // 模拟 tee 的 cancel 等待另一分支，日志不能等待这个 Promise。
                const cancel = jest.fn(() => new Promise<void>(() => {}));
                const stream = new ReadableStream<Uint8Array>({
                    start(value) {
                        controller = value;
                    },
                    cancel,
                });
                const response = textResponse('SDK body', 200);
                jest.mocked(response.clone).mockReturnValue({ body: stream } as Response);
                const abort = new AbortController();
                const logged = deferred<unknown[]>();
                debugSpy.mockImplementation((...args) => logged.resolve(args));

                await expect(
                    proxyReturning(response)(target, { signal: abort.signal })
                ).resolves.toBe(response);
                const partial = 'data: {"delta":"部分应答"}\n\n';
                controller.enqueue(new TextEncoder().encode(partial));
                await Promise.resolve();
                if (stop === 'abort') {
                    abort.abort();
                } else {
                    controller.error(new Error('connection closed'));
                }

                await expect(logged.promise).resolves.toEqual([
                    '[MVU Pi Proxy] raw response',
                    { method: 'GET', url: target, status: 200, complete: false },
                    partial,
                ]);
                expect(cancel).toHaveBeenCalledTimes(stop === 'abort' ? 1 : 0);
                expect(stream.locked).toBe(false);
                expect(response.text).not.toHaveBeenCalled();
            }
        );

        it.each(['clone', 'console'])('does not fail the request when %s throws', async failure => {
            const response = textResponse('raw', 200);
            const fail = () => {
                throw new Error('debug unavailable');
            };
            if (failure === 'clone') {
                jest.mocked(response.clone).mockImplementation(fail);
            } else {
                debugSpy.mockImplementation(fail);
            }

            await expect(proxyReturning(response)(target)).resolves.toBe(response);
            await expect(response.text()).resolves.toBe('raw');
        });
    });
});
