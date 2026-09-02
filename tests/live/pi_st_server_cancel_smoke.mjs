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

function assertServerCancel(value, code) {
    if (!value) {
        throw new ServerCancelSmokeError(code);
    }
}

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
                choose(['openai', 'openai-codex', 'anthropic', 'google'], 'openai');
                await tick();
                choose(['openai-responses', 'openai-completions'], 'openai-responses');
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

async function installBrowserHarness(webDriver, scriptName, endpoint) {
    const result = await webDriver.execute(
        `
        const [scriptName, endpoint, capturePrefix, mainModel, userMarker] = arguments;
        let stage = 'context';
        try {
            const context = window.SillyTavern.getContext();
            const helper = window.TavernHelper;
            const iframe = [...document.querySelectorAll('iframe')].find(frame =>
                frame.id.startsWith('TH-script--' + scriptName)
            );
            if (!iframe?.contentWindow) return { ok: false, stage: 'iframe' };
            const retryEvent = iframe.contentWindow.getButtonEvent('重试额外模型解析');
            const stopEvent = iframe.contentWindow.getButtonEvent('停止“更多”额外模型解析');
            const retryHandlers = context.eventSource?.events?.[retryEvent];
            const stopHandlers = context.eventSource?.events?.[stopEvent];
            if (!retryHandlers?.length || !stopHandlers?.length) return { ok: false, stage: 'handlers' };

            const state = {
                originalTopFetch: window.fetch,
                originalFrameFetch: iframe.contentWindow.fetch,
                frame: iframe.contentWindow,
                retryHandler: retryHandlers.at(-1),
                stopHandler: stopHandlers.at(-1),
                captureRequests: 0,
                piFetches: 0,
                mainFetches: 0,
                unexpectedExternal: 0,
                piSignal: null,
                mainSignal: null,
                piSignalAbortObserved: false,
                mainSignalAbortObserved: false,
                mainModel,
                userMarker,
                sendEvents: { messageSent: 0, generationStopped: 0 },
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

            const eventTypes = context.eventTypes;
            state.messageSentListener = () => { state.sendEvents.messageSent += 1; };
            state.generationStoppedListener = () => { state.sendEvents.generationStopped += 1; };
            context.eventSource.on(eventTypes.MESSAGE_SENT, state.messageSentListener);
            context.eventSource.on(eventTypes.GENERATION_STOPPED, state.generationStoppedListener);
            window.__mvuServerCancelSmoke = state;
            return { ok: true, stage: 'done' };
        } catch (error) {
            return { ok: false, stage, errorName: String(error?.name || 'Error') };
        }
        `,
        [scriptName, endpoint, CAPTURE_MODEL_PREFIX, MAIN_MODEL, USER_MARKER]
    );
    assertServerCancel(
        result?.ok,
        `browser-harness-${result?.stage ?? 'failed'}-${result?.errorName ?? 'none'}`
    );
}

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
                return done({ reached: true, captureRequests: state.captureRequests });
            }
            if (Date.now() >= deadline) {
                return done({
                    reached: false,
                    captureRequests: state?.captureRequests ?? -1,
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
        reached?.reached && reached.captureRequests === 1,
        `pi-provider-not-reached-${reached?.captureRequests ?? -1}-${reached?.piFetches ?? -1}`
    );
}

async function startMainSend(webDriver) {
    const result = await webDriver.executeAsync(
        `
        const [mainModel, userMarker] = arguments;
        const done = arguments[arguments.length - 1];
        let stage = 'initialize';
        (async () => {
            const state = window.__mvuServerCancelSmoke;
            const context = window.SillyTavern.getContext();
            const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
            const fire = (selector, value, eventName) => {
                const element = document.querySelector(selector);
                if (!element) throw new Error(selector);
                if (element.type === 'checkbox') element.checked = value;
                else element.value = value;
                element.dispatchEvent(new Event(eventName, { bubbles: true }));
            };
            if (document.body.dataset.generating === 'true') throw new Error('generation-not-idle');
            context.activateSendButtons();
            stage = 'configure-main';
            fire('#main_api', 'openai', 'change');
            fire('#custom_api_url_text', 'http://127.0.0.1/mvu-local-main', 'input');
            fire('#custom_model_id', mainModel, 'input');
            fire('#stream_toggle', false, 'change');
            fire('#chat_completion_source', 'custom', 'change');
            const statusBefore = state.statusRequests ?? 0;
            document.querySelector('#api_button_openai')?.click();
            const onlineDeadline = Date.now() + 15000;
            while (
                window.SillyTavern.getContext().onlineStatus === 'no_connection' &&
                Date.now() < onlineDeadline
            ) await wait(100);
            if (window.SillyTavern.getContext().onlineStatus === 'no_connection') {
                throw new Error('main-offline-' + statusBefore);
            }

            stage = 'send';
            const textarea = document.querySelector('#send_textarea');
            const sendButton = document.querySelector('#send_but');
            if (!textarea || !sendButton) throw new Error('send-controls');
            const chatLengthBefore = context.chat.length;
            textarea.value = userMarker;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            sendButton.click();
            const mainDeadline = Date.now() + 30000;
            while (state.mainFetches !== 1 && Date.now() < mainDeadline) await wait(50);
            done({
                reached: state.mainFetches === 1,
                stage,
                signalPresent: Boolean(state.mainSignal),
                signalAborted: state.mainSignal?.aborted === true,
                generating: document.body.dataset.generating === 'true',
                chatDelta: context.chat.length - chatLengthBefore,
                userMessageSeen: context.chat.some(
                    message => message?.is_user === true && message?.mes === userMarker
                ),
                messageSent: state.sendEvents.messageSent,
            });
        })().catch(error => done({
            reached: false,
            stage,
            errorName: String(error?.name || 'Error'),
            errorCode: String(error?.message || 'unknown').slice(0, 100),
        }));
        `,
        [MAIN_MODEL, USER_MARKER],
        65_000
    );
    assertServerCancel(
        result?.reached,
        `main-not-reached-${result?.stage ?? 'wait'}-${result?.errorName ?? 'none'}-${result?.errorCode ?? 'none'}`
    );
    assertServerCancel(result.signalPresent && !result.signalAborted, 'main-signal-initial');
    assertServerCancel(
        result.generating &&
            result.chatDelta >= 1 &&
            result.userMessageSeen &&
            result.messageSent >= 1,
        'main-send-lifecycle'
    );
    return result;
}

async function stopPiAndObserveIsolation(webDriver) {
    const stopped = await webDriver.execute(`
        const state = window.__mvuServerCancelSmoke;
        if (!state?.stopHandler) return false;
        Promise.resolve().then(() => state.stopHandler());
        return true;
    `);
    assertServerCancel(stopped, 'pi-stop-not-dispatched');
}

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

async function stopMain(webDriver) {
    const result = await webDriver.executeAsync(
        `
        const done = arguments[arguments.length - 1];
        const state = window.__mvuServerCancelSmoke;
        const stopButton = document.querySelector('#mes_stop');
        const visible = Boolean(stopButton) && getComputedStyle(stopButton).display !== 'none';
        const stoppedBefore = state.sendEvents.generationStopped;
        stopButton?.click();
        const deadline = Date.now() + 10000;
        const poll = () => {
            if (
                state.mainSignal?.aborted === true &&
                document.body.dataset.generating !== 'true'
            ) {
                return done({
                    stopButtonPresent: Boolean(stopButton),
                    stopButtonVisible: visible,
                    mainSignalAborted: true,
                    mainSignalAbortObserved: state.mainSignalAbortObserved,
                    generationIdle: true,
                    generationStopped: state.sendEvents.generationStopped > stoppedBefore,
                    mainFetches: state.mainFetches,
                    piFetches: state.piFetches,
                });
            }
            if (Date.now() >= deadline) {
                return done({
                    stopButtonPresent: Boolean(stopButton),
                    stopButtonVisible: visible,
                    mainSignalAborted: state.mainSignal?.aborted === true,
                    mainSignalAbortObserved: state.mainSignalAbortObserved,
                    generationIdle: document.body.dataset.generating !== 'true',
                    generationStopped: state.sendEvents.generationStopped > stoppedBefore,
                    mainFetches: state.mainFetches,
                    piFetches: state.piFetches,
                });
            }
            setTimeout(poll, 50);
        };
        poll();
        `,
        [],
        15_000
    );
    assertServerCancel(result?.stopButtonPresent && result.stopButtonVisible, 'main-stop-button');
    assertServerCancel(
        result.mainSignalAborted && result.mainSignalAbortObserved && result.generationIdle,
        'main-stop-signal'
    );
    assertServerCancel(result.generationStopped, 'main-stop-event');
    return result;
}

async function cleanupBrowserHarness(webDriver) {
    return webDriver.execute(`
        const state = window.__mvuServerCancelSmoke;
        if (!state) return { ok: false };
        const context = window.SillyTavern.getContext();
        context.eventSource.removeListener(context.eventTypes.MESSAGE_SENT, state.messageSentListener);
        context.eventSource.removeListener(
            context.eventTypes.GENERATION_STOPPED,
            state.generationStoppedListener
        );
        window.fetch = state.originalTopFetch;
        state.frame.fetch = state.originalFrameFetch;
        const result = {
            ok: true,
            topFetchRestored: window.fetch === state.originalTopFetch,
            frameFetchRestored: state.frame.fetch === state.originalFrameFetch,
            captureRequests: state.captureRequests,
            piFetches: state.piFetches,
            mainFetches: state.mainFetches,
            unexpectedExternal: state.unexpectedExternal,
            extraAnalysisEnded: window.Mvu?.isDuringExtraAnalysis?.() === false,
        };
        delete window.__mvuServerCancelSmoke;
        return result;
    `);
}

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
        await startPiRequest(webDriver);
        await waitForServer(
            harness,
            current => current.pi.requests === 1 && current.pi.responseHeadersSent,
            'pi-server-not-streaming'
        );

        const mainSend = await startMainSend(webDriver);
        const bothStreaming = await waitForServer(
            harness,
            current => current.main.requests === 1 && current.main.responseHeadersSent,
            'main-server-not-streaming'
        );
        assertServerCancel(!bothStreaming.pi.responseClosed, 'pi-stream-closed-before-stop');
        assertServerCancel(!bothStreaming.main.responseClosed, 'main-stream-closed-before-stop');

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
            mainSendButtonLifecycle:
                mainSend.generating && mainSend.userMessageSeen && mainSend.messageSent >= 1,
            mainStopButtonLifecycle:
                mainStop.stopButtonPresent &&
                mainStop.stopButtonVisible &&
                mainStop.generationStopped &&
                mainStop.generationIdle,
            noUnexpectedExternalFetch: browserCleanup.unexpectedExternal === 0,
            captureUsedOnce: browserCleanup.captureRequests === 1,
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
