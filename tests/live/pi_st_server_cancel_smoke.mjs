/**
 * 测试场景：结合真实酒馆浏览器和本地回环流式服务器，验证停止 Pi 后网络连接确实关闭且主生成保持独立。
 * 主传输使用 ChatCompletionService 的独立 signal；原生发送/停止按钮生命周期由 feature smoke 验证。
 * 请求使用本地测试密钥，收集服务端和浏览器两侧取消证据。
 */
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const CAPTURE_MODEL_PREFIX = 'mvu-pi-prompt-capture:';
const PI_MODEL = 'gpt-4.1-mini';
const PI_KEY = 'MVU_LOCAL_CANCEL_FAKE_KEY';
const MAIN_MODEL = 'MVU_LOCAL_CANCEL_MAIN_MODEL';
const USER_MARKER = 'MVU_LOCAL_CANCEL_USER_MESSAGE';

class ServerCancelSmokeError extends Error {
    constructor(code) {
        super(code);
        this.name = 'ServerCancelSmokeError';
        this.code = code;
    }
}

/** 取消证据断言：用固定错误码报告浏览器或本地服务器观察到的异常。 */
function assertServerCancel(value, code) {
    if (!value) {
        throw new ServerCancelSmokeError(code);
    }
}

/** 服务端观测：为单一路由初始化请求、响应和连接关闭记录。 */
function createRouteEvidence() {
    return {
        preflights: 0,
        requests: 0,
        methodPost: false,
        requestBodyComplete: false,
        requestAborted: false,
        responseHeadersSent: false,
        responseFinished: false,
        responseClosed: false,
        responseCloseBeforeFinish: false,
        socketClosed: false,
        socketClosedWithError: false,
        authorizationMatched: false,
        modelMatched: false,
        writes: 0,
    };
}

/** 本地流式环境：为 Pi 与主生成提供独立路由，并记录客户端取消造成的连接关闭。 */
function createLoopbackStreamingServer() {
    const evidence = {
        pi: createRouteEvidence(),
        main: createRouteEvidence(),
        unexpectedRequests: 0,
    };
    const intervals = new Set();

    const snapshot = () => ({
        pi: { ...evidence.pi },
        main: { ...evidence.main },
        unexpectedRequests: evidence.unexpectedRequests,
    });

    const server = http.createServer((request, response) => {
        let pathname = '';
        try {
            pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
        } catch {
            response.writeHead(400).end();
            return;
        }

        const route =
            pathname === '/v1/responses'
                ? evidence.pi
                : pathname === '/main-stream'
                  ? evidence.main
                  : null;
        const origin = typeof request.headers.origin === 'string' ? request.headers.origin : '*';
        const requestedHeaders =
            typeof request.headers['access-control-request-headers'] === 'string'
                ? request.headers['access-control-request-headers']
                : 'authorization,content-type';
        const corsHeaders = {
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Allow-Headers': requestedHeaders,
            'Access-Control-Allow-Methods': 'OPTIONS, POST',
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Private-Network': 'true',
            'Access-Control-Expose-Headers': 'content-type,x-request-id',
            'Cache-Control': 'no-store',
            Vary: 'Origin, Access-Control-Request-Headers',
        };

        if (!route) {
            evidence.unexpectedRequests += 1;
            response.writeHead(404, corsHeaders).end();
            return;
        }
        if (request.method === 'OPTIONS') {
            route.preflights += 1;
            response.writeHead(204, corsHeaders).end();
            return;
        }
        if (request.method !== 'POST') {
            response.writeHead(405, { ...corsHeaders, Allow: 'OPTIONS, POST' }).end();
            return;
        }

        route.requests += 1;
        route.methodPost = true;
        route.authorizationMatched =
            pathname !== '/v1/responses' || request.headers.authorization === `Bearer ${PI_KEY}`;

        const chunks = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('aborted', () => {
            route.requestAborted = true;
        });
        request.socket.once('close', hadError => {
            route.socketClosed = true;
            route.socketClosedWithError ||= Boolean(hadError);
        });
        response.on('finish', () => {
            route.responseFinished = true;
        });
        response.on('close', () => {
            route.responseClosed = true;
            route.responseCloseBeforeFinish ||= !route.responseFinished;
        });

        request.on('end', () => {
            route.requestBodyComplete = true;
            if (pathname === '/v1/responses') {
                try {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    route.modelMatched = body?.model === PI_MODEL;
                } catch {
                    route.modelMatched = false;
                }
                response.writeHead(200, {
                    ...corsHeaders,
                    Connection: 'keep-alive',
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Transfer-Encoding': 'chunked',
                    'x-request-id': 'mvu-local-cancel-pi',
                });
                response.flushHeaders();
                // A comment-only SSE frame makes the adapter enter its real pending body-read
                // without risking an early terminal/error transition from a synthetic event.
                response.write(': hold\n\n');
            } else {
                route.modelMatched = Buffer.concat(chunks).toString('utf8').includes(MAIN_MODEL);
                response.writeHead(200, {
                    ...corsHeaders,
                    Connection: 'keep-alive',
                    'Content-Type': 'application/json; charset=utf-8',
                    'Transfer-Encoding': 'chunked',
                });
                response.flushHeaders();
                response.write('{"choices":[');
            }
            route.responseHeadersSent = true;
            route.writes += 1;

            const interval = setInterval(() => {
                if (response.destroyed || response.writableEnded) {
                    clearInterval(interval);
                    intervals.delete(interval);
                    return;
                }
                response.write(pathname === '/v1/responses' ? ': keepalive\n\n' : ' ');
                route.writes += 1;
            }, 250);
            intervals.add(interval);
            response.once('close', () => {
                clearInterval(interval);
                intervals.delete(interval);
            });
        });
    });

    return {
        server,
        snapshot,
        async listen() {
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(0, '127.0.0.1', resolve);
            });
            const address = server.address();
            assertServerCancel(address && typeof address === 'object', 'loopback-listen-failed');
            return `http://127.0.0.1:${address.port}`;
        },
        async close() {
            for (const interval of intervals) {
                clearInterval(interval);
            }
            intervals.clear();
            if (!server.listening) return true;
            server.closeAllConnections?.();
            return new Promise(resolve => server.close(error => resolve(!error)));
        },
    };
}

/** 服务端同步：等待请求或连接进入指定状态，避免仅凭浏览器信号推断网络已取消。 */
async function waitForServer(harness, predicate, code, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    let current = harness.snapshot();
    while (Date.now() < deadline) {
        current = harness.snapshot();
        if (predicate(current)) return current;
        await delay(50);
    }
    throw new ServerCancelSmokeError(
        `${code}-pi-${current.pi.requests}-${Number(current.pi.responseCloseBeforeFinish)}-main-${current.main.requests}-${Number(current.main.responseCloseBeforeFinish)}`
    );
}

/** 连接准备：在浏览器中设置本次 Pi 来源、协议及所需应答选项。 */
async function configurePi(webDriver, scriptName, endpoint) {
    const result = await webDriver.executeAsync(
        `
        const [scriptName, endpoint, key, model] = arguments;
        const done = arguments[arguments.length - 1];
        (async () => {
            const iframe = [...document.querySelectorAll('iframe')].find(frame =>
                frame.id.startsWith('TH-script--' + scriptName)
            );
            if (!iframe?.contentDocument) return done({ ok: false, stage: 'iframe' });
            const candidateDocuments = [document, iframe.contentDocument];
            const tick = () => new Promise(resolve => iframe.contentWindow.setTimeout(resolve, 100));
            const choose = (requiredValues, value) => {
                const select = candidateDocuments.flatMap(owner => [...owner.querySelectorAll('select')]).find(candidate => {
                    const values = [...candidate.options].map(option => option.value);
                    return requiredValues.every(required => values.includes(required));
                });
                if (!select) throw new Error('select-' + value);
                select.value = value;
                const EventConstructor = select.ownerDocument.defaultView.Event;
                select.dispatchEvent(new EventConstructor('input', { bubbles: true }));
                select.dispatchEvent(new EventConstructor('change', { bubbles: true }));
                return select;
            };
            const setInput = (input, value) => {
                if (!input) throw new Error('input-missing');
                input.value = value;
                const EventConstructor = input.ownerDocument.defaultView.Event;
                input.dispatchEvent(new EventConstructor('input', { bubbles: true }));
                input.dispatchEvent(new EventConstructor('change', { bubbles: true }));
            };
            try {
                choose(['与插头相同', '自定义', '更多'], '更多');
                await tick();
                const sourceChoice = JSON.stringify(['openai', 'openai-responses', 'api_key']);
                choose([sourceChoice], sourceChoice);
                await tick();

                const grid = candidateDocuments.flatMap(owner => [...owner.querySelectorAll('.mvu-field-grid')]).find(candidate =>
                    candidate.querySelector('.mvu-pi-model-controls')
                );
                if (!grid) throw new Error('pi-grid');
                const modelInput = grid.querySelector('.mvu-pi-model-controls input[type="text"]');
                const endpointInput = [...grid.querySelectorAll('input[type="text"]')].find(
                    input => input !== modelInput
                );
                const keyInput = grid.querySelector('input[type="password"]');
                setInput(endpointInput, endpoint + '/v1');
                setInput(keyInput, key);
                setInput(modelInput, model);
                choose(['聊天消息', '工具调用', '格式化输出'], '聊天消息');
                await tick();
                done({
                    ok: endpointInput?.value === endpoint + '/v1' &&
                        keyInput?.value === key && modelInput?.value === model,
                    stage: 'done',
                });
            } catch (error) {
                done({ ok: false, stage: String(error?.message || 'configure') });
            }
        })();
        `,
        [scriptName, endpoint, PI_KEY, PI_MODEL],
        30_000
    );
    assertServerCancel(result?.ok, `configure-pi-${result?.stage ?? 'failed'}`);
}

/** 浏览器观测：安装请求与停止探针，将界面动作关联到本地流式服务器。 */
async function installBrowserHarness(webDriver, scriptName, endpoint) {
    const result = await webDriver.execute(
        `
        const [scriptName, endpoint, capturePrefix] = arguments;
        let stage = 'context';
        try {
            const context = window.SillyTavern.getContext();
            const helper = window.TavernHelper;
            const iframe = [...document.querySelectorAll('iframe')].find(frame =>
                frame.id.startsWith('TH-script--' + scriptName)
            );
            if (!iframe?.contentWindow) return { ok: false, stage: 'iframe' };
            const retryEvent = iframe.contentWindow.getButtonEvent('重试额外模型解析');
            const retryHandlers = context.eventSource?.events?.[retryEvent];
            if (!retryHandlers?.length || typeof iframe.contentWindow.stopGenerationById !== 'function') {
                return { ok: false, stage: 'handlers' };
            }

            const state = {
                originalTopFetch: window.fetch,
                originalFrameFetch: iframe.contentWindow.fetch,
                frame: iframe.contentWindow,
                retryHandler: retryHandlers.at(-1),
                stopHandler: () => iframe.contentWindow.stopGenerationById(state.piGenerationId),
                captureRequests: 0,
                captureReadyCount: 0,
                piFetches: 0,
                mainFetches: 0,
                unexpectedExternal: 0,
                piSignal: null,
                mainSignal: null,
                piSignalAbortObserved: false,
                mainSignalAbortObserved: false,
            };
            const abortError = realm => new realm.DOMException('Aborted', 'AbortError');
            const jsonResponse = value => new Response(JSON.stringify(value), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });

            window.fetch = function(input, init = {}) {
                const rawUrl = typeof input === 'string' ? input : input?.url;
                let url;
                try { url = new URL(rawUrl, window.location.href); } catch {
                    return state.originalTopFetch.call(window, input, init);
                }
                if (url.pathname === '/api/backends/chat-completions/status') {
                    return Promise.resolve(jsonResponse({ data: [], bypass: true }));
                }
                if (url.pathname !== '/api/backends/chat-completions/generate') {
                    return state.originalTopFetch.call(window, input, init);
                }
                let body = {};
                try { body = JSON.parse(typeof init.body === 'string' ? init.body : '{}'); } catch {}
                if (typeof body.model === 'string' && body.model.startsWith(capturePrefix)) {
                    state.captureRequests += 1;
                    return Promise.reject(abortError(window));
                }
                const signal = init.signal || input?.signal;
                state.mainFetches += 1;
                state.mainSignal = signal;
                signal?.addEventListener('abort', () => {
                    state.mainSignalAbortObserved = true;
                }, { once: true });
                return state.originalTopFetch.call(window, endpoint + '/main-stream', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: typeof init.body === 'string' ? init.body : '{}',
                    signal,
                });
            };

            iframe.contentWindow.fetch = function(input, init = {}) {
                const rawUrl = typeof input === 'string' ? input : input?.url;
                let url;
                try { url = new iframe.contentWindow.URL(rawUrl, iframe.contentWindow.document.baseURI); } catch {
                    return state.originalFrameFetch.call(iframe.contentWindow, input, init);
                }
                if (url.origin === endpoint && url.pathname === '/v1/responses') {
                    const signal = init.signal || input?.signal;
                    state.piFetches += 1;
                    state.piSignal = signal;
                    signal?.addEventListener('abort', () => {
                        state.piSignalAbortObserved = true;
                    }, { once: true });
                    return state.originalFrameFetch.call(iframe.contentWindow, input, init);
                }
                const parentOrigin = new iframe.contentWindow.URL(iframe.contentWindow.document.baseURI).origin;
                if (url.origin !== parentOrigin) {
                    state.unexpectedExternal += 1;
                    return Promise.reject(new Error('unexpected-external-fetch'));
                }
                return state.originalFrameFetch.call(iframe.contentWindow, input, init);
            };

            state.readyEvent = helper.tavern_events?.CHAT_COMPLETION_SETTINGS_READY || 'chat_completion_settings_ready';
            state.readyListener = data => {
                if (typeof data?.model === 'string' && data.model.startsWith(capturePrefix)) {
                    state.captureReadyCount += 1;
                    state.piGenerationId = decodeURIComponent(data.model.slice(capturePrefix.length));
                }
            };
            context.eventSource.on(state.readyEvent, state.readyListener);
            window.__mvuServerCancelSmoke = state;
            return { ok: true, stage: 'done' };
        } catch (error) {
            return { ok: false, stage, errorName: String(error?.name || 'Error') };
        }
        `,
        [scriptName, endpoint, CAPTURE_MODEL_PREFIX]
    );
    assertServerCancel(
        result?.ok,
        `browser-harness-${result?.stage ?? 'failed'}-${result?.errorName ?? 'none'}`
    );
}

/** 启动 Pi：触发额外模型更新并保留其执行和取消状态。 */
async function startPiRequest(webDriver) {
    const started = await webDriver.execute(`
        const state = window.__mvuServerCancelSmoke;
        if (!state?.retryHandler) return false;
        state.piInvocation = Promise.resolve().then(() => state.retryHandler()).then(
            () => ({ settled: true, rejected: false }),
            error => ({
                settled: true,
                rejected: true,
                errorName: String(error?.name || 'Error'),
                aborted: /abort|cancel|stop|中止|取消/i.test(
                    String(error?.name || '') + ' ' + String(error?.message || '')
                ),
            })
        );
        return true;
    `);
    assertServerCancel(started, 'pi-invocation-not-started');
    const reached = await webDriver.executeAsync(
        `
        const done = arguments[arguments.length - 1];
        const state = window.__mvuServerCancelSmoke;
        const deadline = Date.now() + 30000;
        const poll = () => {
            if (state?.piFetches === 1 && state.piSignal) {
                return done({
                    reached: true,
                    captureRequests: state.captureRequests,
                    captureReadyCount: state.captureReadyCount,
                    piFetches: state.piFetches,
                });
            }
            if (Date.now() >= deadline) {
                return done({
                    reached: false,
                    captureRequests: state?.captureRequests ?? -1,
                    captureReadyCount: state?.captureReadyCount ?? -1,
                    piFetches: state?.piFetches ?? -1,
                });
            }
            setTimeout(poll, 50);
        };
        poll();
        `,
        [],
        35_000
    );
    assertServerCancel(
        reached?.reached && reached.captureReadyCount === 1,
        `pi-provider-not-reached-${reached?.captureReadyCount ?? -1}-${reached?.piFetches ?? -1}`
    );
}

/** 使用酒馆的 ChatCompletionService 建立独立主传输，避免 Pi 活跃期间点击被禁用的发送按钮。 */
async function startMainTransport(webDriver) {
    const result = await webDriver.executeAsync(
        `
        const [mainModel, userMarker] = arguments;
        const done = arguments[arguments.length - 1];
        (async () => {
            const state = window.__mvuServerCancelSmoke;
            const context = window.SillyTavern.getContext();
            state.mainController = new AbortController();
            state.mainInvocation = context.ChatCompletionService.sendRequest({
                stream: false,
                messages: [{ role: 'user', content: userMarker }],
                model: mainModel,
                chat_completion_source: 'custom',
                custom_url: 'http://127.0.0.1/mvu-local-main',
            }, false, state.mainController.signal).then(
                () => ({ settled: true, rejected: false }),
                () => ({ settled: true, rejected: true })
            );
            const deadline = Date.now() + 30000;
            while (state.mainFetches !== 1 && Date.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            done({
                reached: state.mainFetches === 1,
                independentSignal: Boolean(state.mainSignal) && !state.mainSignal.aborted,
            });
        })().catch(() => done({ reached: false }));
    `,
        [MAIN_MODEL, USER_MARKER],
        35000
    );
    assertServerCancel(result?.reached && result.independentSignal, 'main-transport-not-reached');
    return result;
}

/** 定向停止：取消 Pi 更新并观察主生成仍处于活动状态。 */
async function stopPiAndObserveIsolation(webDriver) {
    const stopped = await webDriver.execute(`
        const state = window.__mvuServerCancelSmoke;
        if (!state?.stopHandler || typeof state.piGenerationId !== 'string') return false;
        return state.stopHandler();
    `);
    assertServerCancel(stopped, 'pi-stop-not-dispatched');
}

/** 浏览器证据：读取 Pi 与主生成各自的信号、执行结果和请求计数。 */
async function readBrowserIsolation(webDriver) {
    return webDriver.executeAsync(
        `
        const done = arguments[arguments.length - 1];
        const state = window.__mvuServerCancelSmoke;
        Promise.race([
            state.piInvocation,
            new Promise(resolve => setTimeout(() => resolve({ settled: false }), 10000)),
        ]).then(piInvocation => done({
            piInvocation,
            piSignalAborted: state.piSignal?.aborted === true,
            piSignalAbortObserved: state.piSignalAbortObserved,
            mainSignalAborted: state.mainSignal?.aborted === true,
            mainSignalAbortObserved: state.mainSignalAbortObserved,
            mainFetches: state.mainFetches,
            piFetches: state.piFetches,
        }));
        `,
        [],
        15_000
    );
}

/** 独立停止主生成：确认其取消不额外触发或重启 Pi 请求。 */
async function stopMain(webDriver) {
    const result = await webDriver.executeAsync(
        `
        const done = arguments[arguments.length - 1];
        const state = window.__mvuServerCancelSmoke;
        state.mainController.abort();
        Promise.race([
            state.mainInvocation,
            new Promise(resolve => setTimeout(() => resolve({ settled: false }), 10000)),
        ]).then(invocation => done({
            settled: invocation.settled,
            mainSignalAborted: state.mainSignal?.aborted === true,
            mainSignalAbortObserved: state.mainSignalAbortObserved,
            piFetches: state.piFetches,
        }));
    `,
        [],
        15000
    );
    assertServerCancel(
        result.settled && result.mainSignalAborted && result.mainSignalAbortObserved,
        'main-stop-signal'
    );
    return result;
}

/** 浏览器恢复：撤销测试探针并恢复被替换的请求和事件入口。 */
async function cleanupBrowserHarness(webDriver) {
    return webDriver.execute(`
        const state = window.__mvuServerCancelSmoke;
        if (!state) return { ok: false };
        const context = window.SillyTavern.getContext();
        context.eventSource.removeListener(state.readyEvent, state.readyListener);
        window.fetch = state.originalTopFetch;
        state.frame.fetch = state.originalFrameFetch;
        const result = {
            ok: true,
            topFetchRestored: window.fetch === state.originalTopFetch,
            frameFetchRestored: state.frame.fetch === state.originalFrameFetch,
            captureRequests: state.captureRequests,
            captureReadyCount: state.captureReadyCount,
            piFetches: state.piFetches,
            mainFetches: state.mainFetches,
            unexpectedExternal: state.unexpectedExternal,
            extraAnalysisEnded: window.Mvu?.isDuringExtraAnalysis?.() === false,
        };
        delete window.__mvuServerCancelSmoke;
        return result;
    `);
}

/** 端到端取消：同时建立两条本地流，分别停止并交叉核对浏览器和服务器证据。 */
export async function runPiStServerCancelSmoke({
    webDriver,
    scriptName,
    artifactBundleRequests,
    artifactHashStable,
    firefoxProfileTemporary,
}) {
    const harness = createLoopbackStreamingServer();
    let browserCleanup;
    let serverCleanup = true;
    let result;
    try {
        const endpoint = await harness.listen();
        await configurePi(webDriver, scriptName, endpoint);
        await installBrowserHarness(webDriver, scriptName, endpoint);
        // Pi 流建立：先确认服务端收到请求并发送响应头，再启动并行主生成。
        await startPiRequest(webDriver);
        await waitForServer(
            harness,
            current => current.pi.requests === 1 && current.pi.responseHeadersSent,
            'pi-server-not-streaming'
        );

        // 双流并行：主生成开始后，两条服务端响应都应保持打开。
        const mainSend = await startMainTransport(webDriver);
        const bothStreaming = await waitForServer(
            harness,
            current => current.main.requests === 1 && current.main.responseHeadersSent,
            'main-server-not-streaming'
        );
        assertServerCancel(!bothStreaming.pi.responseClosed, 'pi-stream-closed-before-stop');
        assertServerCancel(!bothStreaming.main.responseClosed, 'main-stream-closed-before-stop');

        // 定向停止 Pi：服务端观察到客户端关闭，主生成信号与连接仍保持活动。
        await stopPiAndObserveIsolation(webDriver);
        const afterPiStop = await waitForServer(
            harness,
            current => current.pi.responseCloseBeforeFinish,
            'pi-server-cancel-not-observed'
        );
        const browserAfterPiStop = await readBrowserIsolation(webDriver);
        assertServerCancel(browserAfterPiStop.piInvocation?.settled, 'pi-invocation-unsettled');
        assertServerCancel(
            browserAfterPiStop.piSignalAborted && browserAfterPiStop.piSignalAbortObserved,
            'pi-browser-signal-not-aborted'
        );
        assertServerCancel(
            !browserAfterPiStop.mainSignalAborted &&
                !browserAfterPiStop.mainSignalAbortObserved &&
                !afterPiStop.main.responseClosed,
            'pi-stop-hit-main-stream'
        );

        // 独立停止主生成：主连接随后关闭，期间没有额外派发或重启 Pi 请求。
        const mainStop = await stopMain(webDriver);
        const afterMainStop = await waitForServer(
            harness,
            current => current.main.responseCloseBeforeFinish,
            'main-server-cancel-not-observed'
        );
        assertServerCancel(mainStop.piFetches === 1, 'main-stop-dispatched-pi-request');
        assertServerCancel(afterMainStop.pi.requests === 1, 'pi-request-count-changed');
        assertServerCancel(afterMainStop.main.requests === 1, 'main-request-count-changed');

        browserCleanup = await cleanupBrowserHarness(webDriver);
        assertServerCancel(browserCleanup?.ok, 'browser-cleanup-missing');
        const checks = {
            piRequestReachedLoopback:
                afterMainStop.pi.requests === 1 && afterMainStop.pi.methodPost,
            piRequestShape:
                afterMainStop.pi.requestBodyComplete &&
                afterMainStop.pi.authorizationMatched &&
                afterMainStop.pi.modelMatched,
            piServerObservedClientCancel:
                afterMainStop.pi.responseClosed &&
                afterMainStop.pi.responseCloseBeforeFinish &&
                !afterMainStop.pi.responseFinished,
            piBrowserSignalAborted:
                browserAfterPiStop.piSignalAborted && browserAfterPiStop.piSignalAbortObserved,
            mainRequestReachedLoopback:
                afterMainStop.main.requests === 1 && afterMainStop.main.methodPost,
            mainRequestShape:
                afterMainStop.main.requestBodyComplete && afterMainStop.main.modelMatched,
            piStopLeftMainAlive:
                !browserAfterPiStop.mainSignalAborted &&
                !browserAfterPiStop.mainSignalAbortObserved &&
                !afterPiStop.main.responseClosed,
            mainServerObservedOwnCancel:
                afterMainStop.main.responseClosed &&
                afterMainStop.main.responseCloseBeforeFinish &&
                !afterMainStop.main.responseFinished,
            independentRequestCounts:
                afterMainStop.pi.requests === 1 && afterMainStop.main.requests === 1,
            independentMainTransportStarted: mainSend.reached && mainSend.independentSignal,
            independentMainTransportStopped: mainStop.settled && mainStop.mainSignalAborted,
            noUnexpectedExternalFetch: browserCleanup.unexpectedExternal === 0,
            // 提示词捕获可在 backend fetch 前停止，以 ready 事件确认恰好捕获一次。
            captureUsedOnce: browserCleanup.captureReadyCount === 1,
            fetchRestored: browserCleanup.topFetchRestored && browserCleanup.frameFetchRestored,
            extraAnalysisEnded: browserCleanup.extraAnalysisEnded,
            artifactLoaded: artifactBundleRequests >= 1,
            artifactHashStable,
            firefoxProfileTemporary,
        };
        for (const [name, passed] of Object.entries(checks)) {
            assertServerCancel(passed, `assertion-${name}`);
        }

        result = {
            ok: true,
            counts: {
                piPreflights: afterMainStop.pi.preflights,
                piRequests: afterMainStop.pi.requests,
                piWritesBeforeCancel: afterMainStop.pi.writes,
                mainPreflights: afterMainStop.main.preflights,
                mainRequests: afterMainStop.main.requests,
                mainWritesBeforeCancel: afterMainStop.main.writes,
            },
            checks,
            observations: {
                piIncomingRequestAbortedEvent: afterMainStop.pi.requestAborted,
                piSocketClosed: afterMainStop.pi.socketClosed,
                mainIncomingRequestAbortedEvent: afterMainStop.main.requestAborted,
                mainSocketClosed: afterMainStop.main.socketClosed,
                piInvocationRejected: browserAfterPiStop.piInvocation?.rejected === true,
            },
        };
    } finally {
        if (!browserCleanup) {
            browserCleanup = await cleanupBrowserHarness(webDriver).catch(() => ({ ok: false }));
        }
        serverCleanup = await harness.close().catch(() => false);
    }
    assertServerCancel(serverCleanup, 'loopback-server-cleanup-failed');
    return result;
}
