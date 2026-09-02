import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const artifactPath = path.join(workspaceRoot, 'artifact', 'bundle.js');
const characterCardPath = path.join(workspaceRoot, 'example', 'artifact', '青空 理_mvu_update.png');
const tokenPath = path.join(workspaceRoot, 'test_token.md');
const slashRunnerManifest = path.join(
    'public',
    'scripts',
    'extensions',
    'third-party',
    'JS-Slash-Runner',
    'manifest.json'
);
const TEMP_PREFIX = 'mvu-pi-st-openrouter-';
const FIREFOX_PROFILE_PREFIX = 'mvu-pi-st-openrouter-profile-';
const SCRIPT_NAME = 'MVU Pi OpenRouter Browser Smoke';
const SCRIPT_ID = '00000000-0000-4000-8000-000000000044';
const RESULT_MARKER = 'MVU_PI_BROWSER_OK';
const INJECTION_ID = 'MVU_PI_BROWSER_LIVE_RESULT';
const LIVE_MODEL = 'inclusionai/ling-3.0-flash-fin:free';
const BROWSER_CREDENTIAL_PLACEHOLDER = 'mvu-browser-credential-placeholder';
const WIRE_PREFLIGHT_CREDENTIAL = 'mvu-browser-preflight-invalid';
const ANTHROPIC_OPENROUTER_HEADER_OVERRIDES =
    'anthropic-version: null\n' +
    'anthropic-beta: null\n' +
    'anthropic-dangerous-direct-browser-access: null';
const INSTALL_ONLY = process.env.MVU_PI_ST_LIVE_INSTALL_ONLY === '1';
const CONNECTIVITY_ONLY = process.env.MVU_PI_ST_LIVE_CONNECTIVITY_ONLY === '1';
const REQUESTED_CASE = (process.env.MVU_PI_ST_LIVE_CASE ?? '').trim();
const BIDI_NETWORK_ENABLED = process.env.MVU_PI_ST_LIVE_BIDI_NETWORK !== '0';
const BIDI_NETWORK_EVENTS = Object.freeze([
    'network.beforeRequestSent',
    'network.responseStarted',
    'network.fetchError',
]);
const BIDI_NETWORK_EVENT_LIMIT = 256;
const CASES = Object.freeze([
    Object.freeze({
        name: 'openai-responses',
        provider: 'openai',
        api: 'openai-responses',
        endpoint: 'https://openrouter.ai/api/v1',
        expectedOrigin: 'https://openrouter.ai',
        expectedPath: '/api/v1/responses',
        expectedAuthHeader: 'authorization',
        customHeaders: '',
        removedRequestHeaders: Object.freeze([]),
    }),
    Object.freeze({
        name: 'anthropic-messages',
        provider: 'anthropic',
        api: 'anthropic-messages',
        endpoint: 'https://openrouter.ai/api',
        expectedOrigin: 'https://openrouter.ai',
        expectedPath: '/api/v1/messages',
        expectedAuthHeader: 'x-api-key',
        customHeaders: ANTHROPIC_OPENROUTER_HEADER_OVERRIDES,
        removedRequestHeaders: Object.freeze([
            'anthropic-version',
            'anthropic-beta',
            'anthropic-dangerous-direct-browser-access',
        ]),
    }),
    Object.freeze({
        name: 'openai-completions',
        provider: 'openai',
        api: 'openai-completions',
        endpoint: 'https://openrouter.ai/api/v1',
        expectedOrigin: 'https://openrouter.ai',
        expectedPath: '/api/v1/chat/completions',
        expectedAuthHeader: 'authorization',
        customHeaders: '',
        removedRequestHeaders: Object.freeze([]),
    }),
    Object.freeze({
        name: 'openai-responses-abort',
        mode: 'abort',
        provider: 'openai',
        api: 'openai-responses',
        endpoint: 'https://openrouter.ai/api/v1',
        expectedOrigin: 'https://openrouter.ai',
        expectedPath: '/api/v1/responses',
        expectedAuthHeader: 'authorization',
        customHeaders: '',
        removedRequestHeaders: Object.freeze([]),
    }),
]);

class SmokeError extends Error {
    constructor(code) {
        super(code);
        this.name = 'SmokeError';
        this.code = code;
    }
}

function assertSmoke(value, code) {
    if (!value) throw new SmokeError(code);
}

function isFile(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

function resolveSillyTavernRoot() {
    return [
        process.env.MVU_ST_ROOT,
        path.resolve(workspaceRoot, '../SillyTavern2'),
        path.join(os.homedir(), 'silly', 'SillyTavern2'),
    ]
        .filter(Boolean)
        .find(
            candidate =>
                isFile(path.join(candidate, 'server.js')) &&
                isFile(path.join(candidate, slashRunnerManifest))
        );
}

function resolveGeckodriver() {
    return (
        [process.env.MVU_GECKODRIVER, '/snap/firefox/current/usr/lib/firefox/geckodriver']
            .filter(Boolean)
            .find(candidate => isFile(candidate)) ?? 'geckodriver'
    );
}

function readCredential() {
    const source = fs.readFileSync(tokenPath, 'utf8');
    const credentials = [...source.matchAll(/sk-[A-Za-z0-9_-]{12,}/g)].map(match => match[0]);
    const credential = credentials[0];
    assertSmoke(
        credential && credentials.every(candidate => candidate === credential),
        'credential-invalid'
    );
    return credential;
}

function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

async function allocatePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assertSmoke(address && typeof address === 'object', 'port-allocation-failed');
    const port = address.port;
    await new Promise(resolve => server.close(resolve));
    return port;
}

function isolatedEnvironment(root) {
    const environment = {
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        NODE_ENV: 'test',
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        TMPDIR: root,
        TZ: 'UTC',
        XDG_CACHE_HOME: path.join(root, 'cache'),
        XDG_CONFIG_HOME: path.join(root, 'config'),
        XDG_DATA_HOME: path.join(root, 'share'),
        XDG_RUNTIME_DIR: path.join(root, 'runtime'),
    };
    if (process.env.SNAP) environment.SNAP = process.env.SNAP;
    return environment;
}

async function createFirefoxProfileRoot(geckodriver, runRoot) {
    const snapCommon = path.join(os.homedir(), 'snap', 'firefox', 'common');
    if (
        path.isAbsolute(geckodriver) &&
        geckodriver.startsWith('/snap/firefox/') &&
        fs.existsSync(snapCommon)
    ) {
        const profileRoot = await mkdtemp(path.join(snapCommon, FIREFOX_PROFILE_PREFIX));
        await chmod(profileRoot, 0o700);
        return { profileRoot, separate: true, allowedParent: snapCommon };
    }
    const profileRoot = path.join(runRoot, 'profiles');
    await mkdir(profileRoot, { recursive: true, mode: 0o700 });
    return { profileRoot, separate: false, allowedParent: runRoot };
}

function startProcess(command, args, options) {
    const child = spawn(command, args, {
        ...options,
        detached: process.platform !== 'win32',
        stdio: 'ignore',
    });
    child.exitResult = new Promise(resolve => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
        child.once('error', () => resolve({ code: null, signal: 'spawn-error' }));
    });
    return child;
}

async function stopProcess(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return true;
    const send = signal => {
        try {
            if (process.platform === 'win32') {
                child.kill(signal);
            } else {
                process.kill(-child.pid, signal);
            }
        } catch {
            // The process may exit between the state check and signal delivery.
        }
    };
    send('SIGTERM');
    if (await Promise.race([child.exitResult.then(() => true), delay(5_000).then(() => false)])) {
        return true;
    }
    send('SIGKILL');
    return Promise.race([child.exitResult.then(() => true), delay(5_000).then(() => false)]);
}

async function waitForHttp(url, child, timeoutMs, validator = response => response.ok) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (child && (child.exitCode !== null || child.signalCode !== null)) {
            throw new SmokeError('child-exited-before-ready');
        }
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
            if (await validator(response)) return;
        } catch {
            // Startup connection failures are expected until the deadline.
        }
        await delay(150);
    }
    throw new SmokeError('http-readiness-timeout');
}

function startArtifactServer(bytes) {
    let requestCount = 0;
    let rejectedCount = 0;
    const server = http.createServer((request, response) => {
        let pathname;
        try {
            pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
        } catch {
            rejectedCount += 1;
            response.writeHead(400).end();
            return;
        }
        if (!['GET', 'HEAD'].includes(request.method ?? '')) {
            rejectedCount += 1;
            response.writeHead(405, { Allow: 'GET, HEAD' }).end();
            return;
        }
        if (pathname !== '/bundle.js') {
            rejectedCount += 1;
            response.writeHead(404).end();
            return;
        }
        requestCount += 1;
        response.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
            'Content-Length': bytes.length,
            'Content-Type': 'text/javascript; charset=utf-8',
            'Cross-Origin-Resource-Policy': 'cross-origin',
        });
        response.end(request.method === 'HEAD' ? undefined : bytes);
    });
    return {
        server,
        getRequestCount: () => requestCount,
        getRejectedCount: () => rejectedCount,
    };
}

async function listenLoopback(server) {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assertSmoke(address && typeof address === 'object', 'artifact-listen-failed');
    return address.port;
}

async function closeServer(server) {
    if (!server?.listening) return true;
    return new Promise(resolve => {
        server.closeAllConnections?.();
        server.close(error => resolve(!error));
    });
}

async function prepareConfig(stRoot, configPath, dataRoot) {
    const defaultConfig = path.join(stRoot, 'default', 'config.yaml');
    assertSmoke(isFile(defaultConfig), 'st-default-config-missing');
    const config = YAML.parse(await readFile(defaultConfig, 'utf8'));
    config.dataRoot = dataRoot;
    config.listen = false;
    config.listenAddress = { ipv4: '127.0.0.1', ipv6: '[::1]' };
    config.protocol = { ipv4: true, ipv6: false };
    config.browserLaunch = { ...(config.browserLaunch ?? {}), enabled: false };
    config.disableCsrfProtection = true;
    config.enableCorsProxy = false;
    config.requestProxy = { enabled: false, url: '', bypass: [] };
    config.extensions = {
        ...(config.extensions ?? {}),
        autoUpdate: false,
        models: { ...(config.extensions?.models ?? {}), autoDownload: false },
    };
    config.enableDownloadableTokenizers = false;
    config.enableServerPlugins = false;
    config.enableServerPluginsAutoUpdate = false;
    config.skipContentCheck = true;
    await writeFile(configPath, YAML.stringify(config), { mode: 0o600 });
    await chmod(configPath, 0o600);
}

function unavailableBidiNetworkRecorder(reason) {
    return {
        mark: () => 0,
        snapshot: () => ({ available: false, reason, events: [] }),
        close: async () => undefined,
    };
}

function sanitizeBidiHeaderNames(headers) {
    if (!Array.isArray(headers)) return [];
    return [
        ...new Set(
            headers
                .map(header => (typeof header?.name === 'string' ? header.name.toLowerCase() : ''))
                .filter(name => /^[a-z0-9-]+$/.test(name))
        ),
    ].sort();
}

function sanitizeBidiMethod(method) {
    const normalized = typeof method === 'string' ? method.toUpperCase() : '';
    return ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'].includes(normalized)
        ? normalized
        : null;
}

function classifyBidiFetchError(errorText) {
    if (typeof errorText !== 'string') return 'other';
    const normalized = errorText.toLowerCase();
    if (/abort|cancel|binding[_ -]?aborted/.test(normalized)) return 'aborted';
    if (/cors|cross[ -]?origin|access[ -]?control|bad[_ -]?uri/.test(normalized)) return 'cors';
    if (/dns|name[_ -]?not[_ -]?resolved|unknown[_ -]?host|host not found/.test(normalized)) {
        return 'dns';
    }
    if (/ssl|tls|certificate|\bcert\b|sec_error|nss/.test(normalized)) return 'tls';
    if (/timeout|timed out|net[_ -]?timeout/.test(normalized)) return 'timeout';
    if (/blocked|policy|denied|not allowed|forbidden|content[_ -]?blocked/.test(normalized)) {
        return 'blocked';
    }
    if (
        /connection|network|failed to fetch|load failed|net[_ -]?(reset|interrupt)|connection[_ -]?refused/.test(
            normalized
        )
    ) {
        return 'network';
    }
    return 'other';
}

function sanitizeBidiNetworkEvent(method, params) {
    const request = params?.request;
    const response = params?.response;
    const rawUrl =
        typeof request?.url === 'string'
            ? request.url
            : typeof response?.url === 'string'
              ? response.url
              : '';
    let url;
    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }
    if (url.origin !== 'https://openrouter.ai') return null;

    const phase = {
        'network.beforeRequestSent': 'beforeRequestSent',
        'network.responseStarted': 'responseStarted',
        'network.fetchError': 'fetchError',
    }[method];
    if (!phase) return null;

    const responseStatus = response?.status;
    return {
        phase,
        method: sanitizeBidiMethod(request?.method),
        pathname: url.pathname,
        status:
            phase === 'responseStarted' &&
            Number.isInteger(responseStatus) &&
            responseStatus >= 100 &&
            responseStatus <= 599
                ? responseStatus
                : null,
        headerNames: sanitizeBidiHeaderNames(
            phase === 'responseStarted' ? response?.headers : request?.headers
        ),
        ...(phase === 'fetchError'
            ? { errorCategory: classifyBidiFetchError(params?.errorText) }
            : {}),
    };
}

function waitForBidiSocketOpen(socket, timeoutMs = 5_000) {
    if (socket.readyState === WebSocket.OPEN) return Promise.resolve(true);
    return new Promise(resolve => {
        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            socket.removeEventListener('open', onOpen);
            socket.removeEventListener('error', onFailure);
            socket.removeEventListener('close', onFailure);
            resolve(value);
        };
        const onOpen = () => finish(true);
        const onFailure = () => finish(false);
        const timeout = setTimeout(() => finish(false), timeoutMs);
        socket.addEventListener('open', onOpen, { once: true });
        socket.addEventListener('error', onFailure, { once: true });
        socket.addEventListener('close', onFailure, { once: true });
    });
}

function closeBidiSocket(socket, timeoutMs = 2_000) {
    if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise(resolve => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            socket.removeEventListener('close', finish);
            resolve();
        };
        const timeout = setTimeout(finish, timeoutMs);
        socket.addEventListener('close', finish, { once: true });
        try {
            socket.close(1000);
        } catch {
            finish();
        }
    });
}

async function createBidiNetworkRecorder(webSocketUrl) {
    if (!BIDI_NETWORK_ENABLED) return unavailableBidiNetworkRecorder('disabled');

    let parsedWebSocketUrl;
    try {
        parsedWebSocketUrl = new URL(webSocketUrl);
    } catch {
        return unavailableBidiNetworkRecorder('endpoint-missing');
    }
    if (
        !['ws:', 'wss:'].includes(parsedWebSocketUrl.protocol) ||
        !['127.0.0.1', '[::1]', 'localhost'].includes(parsedWebSocketUrl.hostname)
    ) {
        return unavailableBidiNetworkRecorder('endpoint-invalid');
    }

    let socket;
    try {
        socket = new WebSocket(parsedWebSocketUrl.href);
    } catch {
        return unavailableBidiNetworkRecorder('connection-failed');
    }

    const events = [];
    const pendingCommands = new Map();
    let sequence = 0;
    let commandId = 0;
    let available = false;
    let reason = 'connection-failed';
    let closing = false;

    const settlePendingCommands = value => {
        for (const pending of pendingCommands.values()) {
            clearTimeout(pending.timeout);
            pending.resolve(value);
        }
        pendingCommands.clear();
    };
    const onMessage = event => {
        if (typeof event.data !== 'string') return;
        let envelope;
        try {
            envelope = JSON.parse(event.data);
        } catch {
            return;
        }
        if (Number.isInteger(envelope?.id)) {
            const pending = pendingCommands.get(envelope.id);
            if (!pending) return;
            pendingCommands.delete(envelope.id);
            clearTimeout(pending.timeout);
            pending.resolve(envelope.error === undefined);
            return;
        }
        const sanitized = sanitizeBidiNetworkEvent(envelope?.method, envelope?.params);
        if (!sanitized) return;
        events.push({ sequence, ...sanitized });
        sequence += 1;
        if (events.length > BIDI_NETWORK_EVENT_LIMIT) events.shift();
    };
    const onSocketError = () => {
        if (!closing) {
            available = false;
            reason = 'socket-error';
        }
        settlePendingCommands(false);
    };
    const onSocketClose = () => {
        if (!closing) {
            available = false;
            reason = 'socket-closed';
        }
        settlePendingCommands(false);
    };
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onSocketError);
    socket.addEventListener('close', onSocketClose);

    const opened = await waitForBidiSocketOpen(socket);
    if (!opened) {
        closing = true;
        await closeBidiSocket(socket);
        return unavailableBidiNetworkRecorder('connection-failed');
    }

    const sendCommand = (method, params) =>
        new Promise(resolve => {
            commandId += 1;
            const id = commandId;
            const timeout = setTimeout(() => {
                pendingCommands.delete(id);
                resolve(false);
            }, 5_000);
            pendingCommands.set(id, { resolve, timeout });
            try {
                socket.send(JSON.stringify({ id, method, params }));
            } catch {
                pendingCommands.delete(id);
                clearTimeout(timeout);
                resolve(false);
            }
        });
    const subscribed = await sendCommand('session.subscribe', {
        events: BIDI_NETWORK_EVENTS,
    });
    if (!subscribed) {
        closing = true;
        await closeBidiSocket(socket);
        return unavailableBidiNetworkRecorder('subscription-failed');
    }
    available = true;
    reason = null;

    return {
        mark: () => sequence,
        snapshot(mark) {
            return {
                available,
                ...(available ? {} : { reason }),
                events: events
                    .filter(event => event.sequence >= mark)
                    .map(({ sequence: _sequence, ...event }) => event),
            };
        },
        close: async () => {
            closing = true;
            settlePendingCommands(false);
            await closeBidiSocket(socket);
            socket.removeEventListener('message', onMessage);
            socket.removeEventListener('error', onSocketError);
            socket.removeEventListener('close', onSocketClose);
        },
    };
}

function attachBidiNetworkSnapshot(summary, recorder, mark) {
    if (!summary) return;
    summary.transport = {
        ...(summary.transport ?? {}),
        bidiNetwork: recorder.snapshot(mark),
    };
}

function webdriver(baseUrl, getSessionId) {
    async function request(method, commandPath, body, timeoutMs = 30_000) {
        let response;
        try {
            response = await fetch(baseUrl + commandPath, {
                method,
                headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch {
            throw new SmokeError('webdriver-transport-failed');
        }
        const envelope = await response.json().catch(() => null);
        if (!response.ok || !envelope || envelope.value?.error) {
            throw new SmokeError('webdriver-command-failed');
        }
        return envelope.value;
    }
    const sessionPath = suffix => {
        const sessionId = getSessionId();
        assertSmoke(sessionId, 'webdriver-session-missing');
        return '/session/' + encodeURIComponent(sessionId) + suffix;
    };
    return {
        createSession: (requestWebSocketUrl = true) =>
            request(
                'POST',
                '/session',
                {
                    capabilities: {
                        alwaysMatch: {
                            acceptInsecureCerts: true,
                            browserName: 'firefox',
                            ...(requestWebSocketUrl ? { webSocketUrl: true } : {}),
                            'moz:firefoxOptions': {
                                args: ['-headless', '--width=1280', '--height=900'],
                                prefs: {
                                    'browser.cache.disk.enable': false,
                                    'browser.formfill.enable': false,
                                    'browser.privatebrowsing.autostart': true,
                                    'browser.shell.checkDefaultBrowser': false,
                                    'browser.startup.page': 0,
                                    'intl.accept_languages': 'en-US',
                                    'network.proxy.type': 0,
                                },
                            },
                        },
                    },
                },
                60_000
            ),
        deleteSession: () => request('DELETE', sessionPath(''), undefined, 20_000),
        setTimeouts: () =>
            request('POST', sessionPath('/timeouts'), {
                implicit: 0,
                pageLoad: 60_000,
                script: 180_000,
            }),
        navigate: url => request('POST', sessionPath('/url'), { url }, 70_000),
        execute: (script, args = [], timeoutMs = 30_000) =>
            request('POST', sessionPath('/execute/sync'), { script, args }, timeoutMs),
        executeAsync: (script, args = [], timeoutMs = 180_000) =>
            request('POST', sessionPath('/execute/async'), { script, args }, timeoutMs),
        findElement: selector =>
            request('POST', sessionPath('/element'), {
                using: 'css selector',
                value: selector,
            }),
        setFileInput: (elementId, filePath) =>
            request('POST', sessionPath('/element/' + encodeURIComponent(elementId) + '/value'), {
                text: filePath,
                value: [...filePath],
            }),
    };
}

async function waitForBrowser(driver, browserFunction, args = [], timeoutMs = 45_000) {
    const deadline = Date.now() + timeoutMs;
    const script = 'return (' + browserFunction.toString() + ').apply(null, arguments);';
    while (Date.now() < deadline) {
        try {
            if (await driver.execute(script, args, 10_000)) return;
        } catch {
            // Navigation and iframe creation can invalidate the document temporarily.
        }
        await delay(200);
    }
    throw new SmokeError('browser-readiness-timeout');
}

async function waitForPiAbortDispatch(driver, recorder, mark, expectedPath, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    let browserState = { exists: false };
    let bidiNetwork = recorder.snapshot(mark);
    while (Date.now() < deadline) {
        browserState = await driver.execute(
            'return (' + readPiAbortCase.toString() + ').apply(null, arguments);',
            [],
            10_000
        );
        bidiNetwork = recorder.snapshot(mark);
        const postDispatched = bidiNetwork.events.some(
            event =>
                event.phase === 'beforeRequestSent' &&
                event.method === 'POST' &&
                event.pathname === expectedPath
        );
        if (
            browserState?.exists === true &&
            browserState.requestCount === 1 &&
            browserState.signalPresent === true &&
            postDispatched
        ) {
            return { reached: true, browserState, bidiNetwork };
        }
        if (browserState?.invocationSettled === true) break;
        await delay(25);
    }
    return { reached: false, browserState, bidiNetwork };
}

async function waitForBidiAbort(recorder, mark, expectedPath, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    let snapshot = recorder.snapshot(mark);
    while (Date.now() < deadline) {
        snapshot = recorder.snapshot(mark);
        if (
            snapshot.events.some(
                event =>
                    event.phase === 'fetchError' &&
                    event.pathname === expectedPath &&
                    event.errorCategory === 'aborted'
            )
        ) {
            return { seen: true, snapshot };
        }
        await delay(25);
    }
    return { seen: false, snapshot };
}

function safeAsyncBrowserScript(browserFunction) {
    return (
        'const done = arguments[arguments.length - 1];' +
        'const args = Array.prototype.slice.call(arguments, 0, -1);' +
        'const setInputValue = ' +
        setInputValue.toString() +
        ';' +
        'Promise.resolve((' +
        browserFunction.toString() +
        ').apply(null, args)).then(' +
        'value => done({ ok: true, value }),' +
        "error => done({ ok: false, errorName: error && error.name || 'UnknownError' })" +
        ');'
    );
}

function elementId(element) {
    return element?.['element-6066-11e4-a52e-4f735466cecf'] ?? element?.ELEMENT;
}

async function clickPopup(driver, mode = 'auto') {
    return driver.execute(
        `
            const mode = arguments[0];
            const dialogs = [...document.querySelectorAll('dialog.popup')].filter(dialog =>
                dialog.open && dialog.getClientRects().length > 0
            );
            const dialog = dialogs.at(-1);
            if (!dialog) return { handled: false, rejectedScript: false };
            const text = (dialog.textContent || '').toLowerCase();
            const isScript = /script|脚本/.test(text);
            const cancel = mode === 'cancel' || (mode === 'auto' && isScript);
            const input = dialog.querySelector('.popup-input');
            if (input && !cancel) {
                input.value = 'MVU Browser Smoke User';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const selector = cancel
                ? '.popup-button-cancel, .popup-button-close'
                : '.popup-button-ok';
            const button = dialog.querySelector(selector);
            if (!button) return { handled: false, rejectedScript: false };
            button.click();
            return { handled: true, rejectedScript: isScript && cancel };
        `,
        [mode]
    );
}

async function settlePopups(driver, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    let stable = 0;
    let rejectedScripts = 0;
    while (Date.now() < deadline) {
        const result = await clickPopup(driver, 'auto');
        if (result?.handled) {
            stable = 0;
            rejectedScripts += Number(result.rejectedScript);
            await delay(250);
            continue;
        }
        stable += 1;
        if (stable >= 5) return { rejectedScripts };
        await delay(200);
    }
    throw new SmokeError('popup-settle-timeout');
}

function browserReadyForTavernHelper() {
    return Boolean(
        window.SillyTavern &&
            window.TavernHelper &&
            typeof window.TavernHelper.replaceScriptTrees === 'function'
    );
}

function browserHasImportedCharacter() {
    const characters = window.SillyTavern?.getContext?.().characters ?? [];
    return characters.some(character => String(character?.name ?? '').includes('青空'));
}

function browserHasSelectedCharacter() {
    const context = window.SillyTavern?.getContext?.();
    return Boolean(context && context.characterId !== undefined && context.characterId !== null);
}

function browserArtifactReady(scriptName) {
    const iframe = [...document.querySelectorAll('iframe')].find(frame =>
        frame.id.startsWith('TH-script--' + scriptName)
    );
    return Boolean(
        window.Mvu &&
            document.querySelector('.mvu-pi-model-controls') &&
            typeof iframe.contentWindow?.getButtonEvent === 'function'
    );
}

async function installArtifact(setup) {
    const context = window.SillyTavern.getContext();
    const helper = window.TavernHelper;
    const initial = setup.cases[0];

    context.extensionSettings.mvu_settings = {
        通知: {
            MVU框架加载成功: false,
            变量初始化成功: false,
            变量更新出错: false,
            额外模型解析中: false,
        },
        更新方式: '额外模型解析',
        额外模型解析配置: {
            破限方案: '使用当前预设',
            其他预设名称: '',
            应答格式: '聊天消息',
            关闭thinking: false,
            兼容假流式: false,
            随机头部: false,
            启用自动请求: false,
            请求方式: '依次请求，失败后重试',
            请求次数: 1,
            世界书条目白名单正则: '',
            世界书条目黑名单正则: '',
            模型来源: '更多',
            api地址: '',
            密钥: '',
            customApiKey: '',
            模型名称: '',
            pi: {
                provider: initial.provider,
                api: initial.api,
                authType: 'api_key',
                endpoint: initial.endpoint,
                model: setup.model,
                contextWindow: 200000,
                credentials: {},
                apiKeys: {},
                customHeaders: '',
                customIncludeBody: '',
                customExcludeBody: '',
            },
            温度: 0,
            频率惩罚: 0,
            存在惩罚: 0,
            top_p: 1,
            top_k: 0,
            max_chat_history: 2,
            最大回复token数: 4096,
            api方案列表: [],
            当前api方案: '',
        },
        自动清理变量: {
            启用: false,
            快照保留间隔: 50,
            要保留变量的最近楼层数: 20,
            触发恢复变量的最近楼层数: 10,
        },
        兼容性: {
            更新到聊天变量: false,
            显示老旧功能: false,
            sendas不视为user消息: false,
        },
    };

    const previousMessageIds = Array.from(
        { length: context.chat.length },
        (_value, index) => index
    );
    if (previousMessageIds.length > 0) {
        await helper.deleteChatMessages(previousMessageIds, { refresh: 'none' });
    }
    await helper.createChatMessages(
        [
            { role: 'user', message: 'MVU browser provider smoke request.' },
            {
                role: 'assistant',
                message: 'MVU browser provider smoke target. <StatusPlaceHolderImpl/>',
            },
        ],
        { refresh: 'none' }
    );
    await context.setExtensionPrompt(
        setup.injectionId,
        `This is a deterministic integration smoke test. Return exactly this text and nothing else:\n<UpdateVariable>_.set('stat_data.__mvu_pi_browser_smoke', '${setup.marker}');</UpdateVariable>`,
        1,
        0,
        false,
        0
    );
    const originalGetContext = window.SillyTavern.getContext;
    if (typeof originalGetContext !== 'function') throw new Error('get-context-hook-missing');
    window.__mvuLiveOriginalGetContext = originalGetContext;
    window.SillyTavern.getContext = function () {
        return {
            ...originalGetContext.call(this),
            saveSettingsDebounced: () => undefined,
        };
    };
    if (
        window.SillyTavern.getContext === originalGetContext ||
        window.SillyTavern.getContext().saveSettingsDebounced ===
            originalGetContext.call(window.SillyTavern).saveSettingsDebounced
    ) {
        throw new Error('get-context-hook-not-patched');
    }
    helper.replaceScriptTrees(
        [
            {
                type: 'script',
                enabled: true,
                name: setup.scriptName,
                id: setup.scriptId,
                content:
                    "globalThis.__mvuLiveModuleState = 'loading';\n" +
                    'import(' +
                    JSON.stringify(setup.artifactUrl) +
                    ").then(() => { globalThis.__mvuLiveModuleState = 'loaded'; }, " +
                    "() => { globalThis.__mvuLiveModuleState = 'rejected'; });",
                info: '',
                button: { enabled: true, buttons: [] },
                data: {},
                export_with: { data: false, button: false },
            },
        ],
        { type: 'global' }
    );
    return {
        saveSettingsPatched: window.SillyTavern.getContext !== originalGetContext,
        origin: window.location.origin,
    };
}

function setInputValue(input, value, eventName = 'input') {
    input.value = value;
    const EventConstructor = input.ownerDocument.defaultView.Event;
    input.dispatchEvent(new EventConstructor(eventName, { bubbles: true }));
}

async function configurePiCase(configuration) {
    const iframe = [...document.querySelectorAll('iframe')].find(frame =>
        frame.id.startsWith('TH-script--' + configuration.scriptName)
    );
    if (!iframe?.contentWindow) throw new Error('artifact-iframe-missing');
    const panelDocument = document;

    const selects = [...panelDocument.querySelectorAll('select')];
    const providerSelect = selects.find(select => {
        const values = [...select.options].map(option => option.value);
        return ['openai', 'openai-codex', 'anthropic', 'google'].every(value =>
            values.includes(value)
        );
    });
    if (!providerSelect) throw new Error('provider-select-missing');
    setInputValue(providerSelect, configuration.provider, 'change');
    await new Promise(resolve => setTimeout(resolve, 100));

    const apiSelect = [...panelDocument.querySelectorAll('select')].find(select =>
        [...select.options].some(option => option.value === configuration.api)
    );
    if (!apiSelect) throw new Error('api-select-missing');
    setInputValue(apiSelect, configuration.api, 'change');
    await new Promise(resolve => setTimeout(resolve, 100));

    const modelInput = panelDocument.querySelector('.mvu-pi-model-controls input[type="text"]');
    const piGrid = modelInput?.closest('.mvu-field-grid');
    const endpointInput = [
        ...(piGrid?.querySelectorAll('.mvu-field > input[type="text"]') ?? []),
    ].find(input => !input.closest('.mvu-pi-model-controls'));
    const keyInput = piGrid?.querySelector('.mvu-field > input[type="password"]');
    const customHeadersInput = panelDocument.querySelector(
        'textarea.mvu-pi-advanced-textarea[placeholder="X-Client-Name: MVU"]'
    );
    if (!endpointInput || !modelInput || !keyInput || !customHeadersInput) {
        throw new Error('pi-input-missing');
    }

    setInputValue(endpointInput, configuration.endpoint);
    await new Promise(resolve => setTimeout(resolve, 100));
    setInputValue(modelInput, configuration.model);
    setInputValue(keyInput, configuration.apiKey);
    setInputValue(customHeadersInput, configuration.customHeaders);
    await new Promise(resolve => setTimeout(resolve, 150));

    const visibleErrors = [...panelDocument.querySelectorAll('.mvu-field-error')].filter(
        element => element.getClientRects().length > 0 && element.textContent?.trim()
    );
    return {
        providerSelected: providerSelect.value === configuration.provider,
        apiSelected: apiSelect.value === configuration.api,
        endpointSelected: endpointInput.value === configuration.endpoint,
        modelSelected: modelInput.value === configuration.model,
        credentialLengthMatched: keyInput.value.length === configuration.apiKey.length,
        customHeadersExact: customHeadersInput.value === configuration.customHeaders,
        visibleErrorCount: visibleErrors.length,
    };
}

async function probeOpenRouterBrowserConnectivity(scriptName) {
    const iframe = [...document.querySelectorAll('iframe')].find(frame =>
        frame.id.startsWith('TH-script--' + scriptName)
    );
    if (!iframe?.contentWindow) throw new Error('artifact-iframe-missing');
    const realm = iframe.contentWindow;
    const controller = new realm.AbortController();
    const startedAt = realm.performance.now();
    const timeout = realm.setTimeout(() => controller.abort(), 15_000);
    let result;
    try {
        const response = await realm.fetch('https://openrouter.ai/api/v1/models', {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
        });
        const elapsed = realm.performance.now() - startedAt;
        await response.body?.cancel().catch(() => undefined);
        result = {
            responseResolved: true,
            status:
                Number.isInteger(response.status) &&
                response.status >= 100 &&
                response.status <= 599
                    ? response.status
                    : null,
            responseType: [
                'basic',
                'cors',
                'default',
                'error',
                'opaque',
                'opaqueredirect',
            ].includes(response.type)
                ? response.type
                : 'other',
            signalAborted: controller.signal.aborted,
            fetchErrorName: null,
            fetchErrorIsTypeError: false,
            elapsedBucket: elapsed < 100 ? '<100ms' : elapsed < 1_000 ? '100-999ms' : '>=1000ms',
        };
    } catch (error) {
        const elapsed = realm.performance.now() - startedAt;
        result = {
            responseResolved: false,
            status: null,
            responseType: null,
            signalAborted: controller.signal.aborted,
            fetchErrorName: [
                'AbortError',
                'NetworkError',
                'NotAllowedError',
                'SecurityError',
                'TimeoutError',
                'TypeError',
            ].includes(error?.name)
                ? error.name
                : 'OtherError',
            fetchErrorIsTypeError: error instanceof realm.TypeError,
            elapsedBucket: elapsed < 100 ? '<100ms' : elapsed < 1_000 ? '100-999ms' : '>=1000ms',
        };
    } finally {
        realm.clearTimeout(timeout);
    }
    await new Promise(resolve => realm.setTimeout(resolve, 250));
    return result;
}

async function probeOpenRouterResponsesBrowserTransport(scriptName) {
    const iframe = [...document.querySelectorAll('iframe')].find(frame =>
        frame.id.startsWith('TH-script--' + scriptName)
    );
    if (!iframe?.contentWindow) throw new Error('artifact-iframe-missing');
    const realm = iframe.contentWindow;
    const controller = new realm.AbortController();
    const startedAt = realm.performance.now();
    const timeout = realm.setTimeout(() => controller.abort(), 15_000);
    let result;
    try {
        const response = await realm.fetch('https://openrouter.ai/api/v1/responses', {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                Authorization: 'Bearer mvu-browser-preflight-invalid',
                'Content-Type': 'application/json',
                'User-Agent': 'OpenAI/JS 6.40.0',
                'X-Stainless-Arch': 'unknown',
                'X-Stainless-Lang': 'js',
                'X-Stainless-OS': 'Unknown',
                'X-Stainless-Package-Version': '6.40.0',
                'X-Stainless-Retry-Count': '0',
                'X-Stainless-Runtime': 'browser:firefox',
                'X-Stainless-Runtime-Version': 'unknown',
            },
            body: JSON.stringify({
                model: 'mvu-browser-preflight-invalid',
                input: 'mvu browser preflight',
            }),
            cache: 'no-store',
            signal: controller.signal,
        });
        const elapsed = realm.performance.now() - startedAt;
        await response.body?.cancel().catch(() => undefined);
        result = {
            responseResolved: true,
            status:
                Number.isInteger(response.status) &&
                response.status >= 100 &&
                response.status <= 599
                    ? response.status
                    : null,
            responseType: [
                'basic',
                'cors',
                'default',
                'error',
                'opaque',
                'opaqueredirect',
            ].includes(response.type)
                ? response.type
                : 'other',
            signalAborted: controller.signal.aborted,
            fetchErrorName: null,
            fetchErrorIsTypeError: false,
            elapsedBucket: elapsed < 100 ? '<100ms' : elapsed < 1_000 ? '100-999ms' : '>=1000ms',
        };
    } catch (error) {
        const elapsed = realm.performance.now() - startedAt;
        result = {
            responseResolved: false,
            status: null,
            responseType: null,
            signalAborted: controller.signal.aborted,
            fetchErrorName: [
                'AbortError',
                'NetworkError',
                'NotAllowedError',
                'SecurityError',
                'TimeoutError',
                'TypeError',
            ].includes(error?.name)
                ? error.name
                : 'OtherError',
            fetchErrorIsTypeError: error instanceof realm.TypeError,
            elapsedBucket: elapsed < 100 ? '<100ms' : elapsed < 1_000 ? '100-999ms' : '>=1000ms',
        };
    } finally {
        realm.clearTimeout(timeout);
    }
    await new Promise(resolve => realm.setTimeout(resolve, 250));
    return result;
}

async function invokePiCase(configuration) {
    const context = window.SillyTavern.getContext();
    const iframe = [...document.querySelectorAll('iframe')].find(frame =>
        frame.id.startsWith('TH-script--' + configuration.scriptName)
    );
    if (!iframe?.contentWindow) throw new Error('artifact-iframe-missing');
    const eventId = iframe.contentWindow.getButtonEvent('重试额外模型解析');
    const handlers = context.eventSource?.events?.[eventId];
    if (!Array.isArray(handlers) || handlers.length === 0) {
        throw new Error('retry-handler-missing');
    }
    const settingsBefore = context.extensionSettings?.mvu_settings?.额外模型解析配置;
    const lastMessageBefore = context.chat.at(-1);
    const preInvocation = {
        lastMessageIsAssistant: lastMessageBefore?.is_user === false,
        lastMessageHasStatusPlaceholder: String(
            lastMessageBefore?.mes ?? lastMessageBefore?.message ?? ''
        ).includes('<StatusPlaceHolderImpl/>'),
        sourceIsPi: settingsBefore?.模型来源 === '更多',
        providerMatched: settingsBefore?.pi?.provider === configuration.provider,
        apiMatched: settingsBefore?.pi?.api === configuration.api,
        endpointMatched: settingsBefore?.pi?.endpoint === configuration.endpoint,
        modelMatched: settingsBefore?.pi?.model === configuration.model,
        customHeadersExact: settingsBefore?.pi?.customHeaders === configuration.customHeaders,
        placeholderCredentialMatched: settingsBefore?.密钥 === configuration.placeholderApiKey,
        extraAnalysisIdle: window.Mvu?.isDuringExtraAnalysis?.() === false,
    };

    const observation = {
        requestCount: 0,
        paths: [],
        statuses: [],
        requestHeaderNames: [],
        requestMethod: null,
        requestInitKeys: [],
        requestBodyKind: null,
        requestBodySizeBucket: null,
        requestMode: null,
        requestCredentials: null,
        requestCache: null,
        requestRedirect: null,
        requestKeepalive: false,
        requestDuplexPresent: false,
        expectedAuthMatched: true,
        outboundAuthInjected: true,
        customHeaderOverridesApplied: true,
        explicitSignalPresent: true,
        signalIsAbortSignal: true,
        signalAbortedAtDispatch: false,
        signalAbortedAtReject: false,
        responseResolved: true,
        corsResponse: true,
        allowOriginVisible: true,
        fetchErrorName: null,
        fetchErrorIsTypeError: false,
        fetchErrorIsDomException: false,
        fetchElapsedBucket: null,
        resourceTimingEntrySeen: false,
        resourceTimingResponseStatus: null,
        responseContentType: null,
        wireBodySizeBucket: null,
        wireFormat: null,
        wireEventTypes: [],
        wireCompletedSeen: false,
        wireFailedSeen: false,
        wireIncompleteReason: null,
        wireOutputTextSeen: false,
        wireDoneSeen: false,
        wireBodyReadError: false,
        wireBodyTruncatedForTelemetry: false,
        wireMarkerSeen: false,
        rateLimited: false,
    };
    const bodyReadTasks = [];
    const summarizeWireBody = text => {
        observation.wireBodySizeBucket =
            text.length < 1_024 ? '<1KiB' : text.length < 16_384 ? '1-15KiB' : '>=16KiB';
        const dataLines = text
            .split(/\r?\n/)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trim());
        observation.wireFormat =
            dataLines.length > 0
                ? 'sse'
                : text.trim().startsWith('{') || text.trim().startsWith('[')
                  ? 'json'
                  : text.trim()
                    ? 'other'
                    : 'empty';
        const allowedEventTypes = new Set([
            'chat.completion',
            'chat.completion.chunk',
            'content_block_delta',
            'content_block_start',
            'content_block_stop',
            'error',
            'message',
            'message_delta',
            'message_start',
            'message_stop',
            'ping',
            'response.completed',
            'response.content_part.added',
            'response.content_part.done',
            'response.created',
            'response.failed',
            'response.in_progress',
            'response.incomplete',
            'response.output_item.added',
            'response.output_item.done',
            'response.output_text.delta',
            'response.output_text.done',
        ]);
        const eventTypes = new Set();
        let markerTail = '';
        const markerTailLength = Math.max(configuration.marker.length - 1, 0);
        const observeOutputText = outputText => {
            if (typeof outputText !== 'string') return;
            observation.wireOutputTextSeen = true;
            const markerCandidate = markerTail + outputText;
            observation.wireMarkerSeen =
                observation.wireMarkerSeen || markerCandidate.includes(configuration.marker);
            markerTail = markerTailLength > 0 ? markerCandidate.slice(-markerTailLength) : '';
        };
        const observeChatContent = content => {
            if (typeof content === 'string') {
                observeOutputText(content);
                return;
            }
            for (const part of Array.isArray(content) ? content : []) {
                if (part?.type === 'text' && typeof part.text === 'string') {
                    observeOutputText(part.text);
                }
            }
        };
        for (const data of dataLines) {
            if (data === '[DONE]') {
                observation.wireDoneSeen = true;
                observation.wireCompletedSeen = true;
                continue;
            }
            let event;
            try {
                event = JSON.parse(data);
            } catch {
                continue;
            }
            if (allowedEventTypes.has(event?.type)) eventTypes.add(event.type);
            if (['chat.completion', 'chat.completion.chunk'].includes(event?.object)) {
                eventTypes.add(event.object);
            }
            observation.wireCompletedSeen =
                observation.wireCompletedSeen ||
                event?.type === 'response.completed' ||
                event?.type === 'message_stop';
            observation.wireFailedSeen =
                observation.wireFailedSeen ||
                event?.type === 'response.failed' ||
                event?.type === 'response.incomplete' ||
                event?.type === 'error' ||
                Boolean(event?.error);
            if (event?.type === 'response.incomplete') {
                const reason = event?.response?.incomplete_details?.reason;
                observation.wireIncompleteReason = ['content_filter', 'max_output_tokens'].includes(
                    reason
                )
                    ? reason
                    : 'other';
            }
            if (event?.type === 'response.output_text.delta' && typeof event.delta === 'string') {
                observeOutputText(event.delta);
            }
            if (event?.type === 'response.output_text.done' && typeof event.text === 'string') {
                observeOutputText(event.text);
            }
            const outputItems = [
                ...(Array.isArray(event?.response?.output) ? event.response.output : []),
                ...(event?.item ? [event.item] : []),
            ];
            for (const item of outputItems) {
                for (const content of Array.isArray(item?.content) ? item.content : []) {
                    if (content?.type === 'output_text' && typeof content.text === 'string') {
                        observeOutputText(content.text);
                    }
                }
            }
            if (event?.type === 'content_block_delta' && event?.delta?.type === 'text_delta') {
                observeOutputText(event.delta.text);
            }
            if (event?.type === 'content_block_start' && event?.content_block?.type === 'text') {
                observeOutputText(event.content_block.text);
            }
            for (const content of Array.isArray(event?.content) ? event.content : []) {
                if (content?.type === 'text') observeOutputText(content.text);
            }
            const anthropicStopReason =
                event?.type === 'message_delta' ? event?.delta?.stop_reason : event?.stop_reason;
            if (anthropicStopReason === 'max_tokens') {
                observation.wireFailedSeen = true;
                observation.wireIncompleteReason = 'max_output_tokens';
            }
            if (anthropicStopReason === 'refusal') {
                observation.wireFailedSeen = true;
                observation.wireIncompleteReason = 'content_filter';
            }
            for (const choice of Array.isArray(event?.choices) ? event.choices : []) {
                observeChatContent(choice?.delta?.content);
                observeChatContent(choice?.message?.content);
                if (choice?.finish_reason !== null && choice?.finish_reason !== undefined) {
                    observation.wireCompletedSeen = true;
                }
                if (choice?.finish_reason === 'length') {
                    observation.wireFailedSeen = true;
                    observation.wireIncompleteReason = 'max_output_tokens';
                }
                if (choice?.finish_reason === 'content_filter') {
                    observation.wireFailedSeen = true;
                    observation.wireIncompleteReason = 'content_filter';
                }
            }
        }
        observation.wireEventTypes = [...eventTypes].sort();
    };
    const topOriginalFetch = window.fetch;
    const iframeOriginalFetch = iframe.contentWindow.fetch;
    const wrapFetch = (originalFetch, realm) =>
        async function (input, init) {
            const rawUrl =
                typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
            let url;
            try {
                url = new URL(rawUrl, window.location.href);
            } catch {
                return originalFetch.call(realm, input, init);
            }
            if (url.origin !== configuration.expectedOrigin) {
                return originalFetch.call(realm, input, init);
            }

            observation.requestCount += 1;
            observation.paths.push(url.pathname);
            const headers = new Headers(input?.headers);
            new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
            observation.requestHeaderNames = [...headers.keys()]
                .map(name => name.toLowerCase())
                .sort();
            const method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
            observation.requestMethod = [
                'DELETE',
                'GET',
                'HEAD',
                'OPTIONS',
                'PATCH',
                'POST',
                'PUT',
            ].includes(method)
                ? method
                : 'OTHER';
            observation.requestInitKeys = Object.keys(init ?? {})
                .filter(name => /^[A-Za-z][A-Za-z0-9]*$/.test(name))
                .sort();
            const body = init?.body ?? input?.body;
            observation.requestBodyKind =
                body === undefined || body === null
                    ? 'none'
                    : typeof body === 'string'
                      ? 'string'
                      : typeof realm.ReadableStream === 'function' &&
                          body instanceof realm.ReadableStream
                        ? 'readable-stream'
                        : typeof realm.Blob === 'function' && body instanceof realm.Blob
                          ? 'blob'
                          : typeof realm.FormData === 'function' && body instanceof realm.FormData
                            ? 'form-data'
                            : typeof realm.URLSearchParams === 'function' &&
                                body instanceof realm.URLSearchParams
                              ? 'url-search-params'
                              : 'other';
            observation.requestBodySizeBucket =
                typeof body !== 'string'
                    ? null
                    : body.length < 1_024
                      ? '<1KiB'
                      : body.length < 16_384
                        ? '1-15KiB'
                        : '>=16KiB';
            observation.requestMode = ['cors', 'navigate', 'no-cors', 'same-origin'].includes(
                init?.mode
            )
                ? init.mode
                : null;
            observation.requestCredentials = ['include', 'omit', 'same-origin'].includes(
                init?.credentials
            )
                ? init.credentials
                : null;
            observation.requestCache = [
                'default',
                'force-cache',
                'no-cache',
                'no-store',
                'only-if-cached',
                'reload',
            ].includes(init?.cache)
                ? init.cache
                : null;
            observation.requestRedirect = ['error', 'follow', 'manual'].includes(init?.redirect)
                ? init.redirect
                : null;
            observation.requestKeepalive = init?.keepalive === true;
            observation.requestDuplexPresent = Object.prototype.hasOwnProperty.call(
                init ?? {},
                'duplex'
            );
            const expectedAuthValue =
                configuration.expectedAuthHeader === 'authorization'
                    ? 'Bearer ' + configuration.placeholderApiKey
                    : configuration.placeholderApiKey;
            observation.expectedAuthMatched =
                observation.expectedAuthMatched &&
                headers.get(configuration.expectedAuthHeader) === expectedAuthValue;
            observation.customHeaderOverridesApplied =
                observation.customHeaderOverridesApplied &&
                configuration.removedRequestHeaders.every(name => !headers.has(name));
            const outboundHeaders = new realm.Headers(headers);
            const outboundAuthValue =
                configuration.expectedAuthHeader === 'authorization'
                    ? 'Bearer ' + configuration.apiKey
                    : configuration.apiKey;
            outboundHeaders.set(configuration.expectedAuthHeader, outboundAuthValue);
            observation.outboundAuthInjected =
                observation.outboundAuthInjected &&
                outboundHeaders.get(configuration.expectedAuthHeader) === outboundAuthValue;
            const outboundInit = { ...(init ?? {}), headers: outboundHeaders };
            const signal = init?.signal ?? input?.signal;
            observation.explicitSignalPresent =
                observation.explicitSignalPresent && signal !== undefined;
            observation.signalIsAbortSignal =
                observation.signalIsAbortSignal &&
                Boolean(
                    signal &&
                        (signal instanceof realm.AbortSignal ||
                            Object.prototype.toString.call(signal) === '[object AbortSignal]')
                );
            observation.signalAbortedAtDispatch =
                observation.signalAbortedAtDispatch || signal?.aborted === true;

            let response;
            const fetchStartedAt = realm.performance.now();
            const resourceTimingCountAtDispatch = realm.performance.getEntriesByName(
                url.href,
                'resource'
            ).length;
            try {
                response = await originalFetch.call(realm, input, outboundInit);
            } catch (error) {
                observation.responseResolved = false;
                observation.corsResponse = false;
                observation.allowOriginVisible = false;
                observation.signalAbortedAtReject = signal?.aborted === true;
                observation.fetchErrorName = [
                    'AbortError',
                    'NetworkError',
                    'NotAllowedError',
                    'SecurityError',
                    'TimeoutError',
                    'TypeError',
                ].includes(error?.name)
                    ? error.name
                    : 'OtherError';
                observation.fetchErrorIsTypeError = error instanceof realm.TypeError;
                observation.fetchErrorIsDomException =
                    typeof realm.DOMException === 'function' && error instanceof realm.DOMException;
                const elapsed = realm.performance.now() - fetchStartedAt;
                observation.fetchElapsedBucket =
                    elapsed < 100 ? '<100ms' : elapsed < 1_000 ? '100-999ms' : '>=1000ms';
                const timingEntries = realm.performance.getEntriesByName(url.href, 'resource');
                const timingEntry = timingEntries.slice(resourceTimingCountAtDispatch).at(-1);
                observation.resourceTimingEntrySeen = Boolean(timingEntry);
                observation.resourceTimingResponseStatus = Number.isInteger(
                    timingEntry?.responseStatus
                )
                    ? timingEntry.responseStatus
                    : null;
                throw error;
            }
            observation.statuses.push(response.status);
            observation.rateLimited = observation.rateLimited || response.status === 429;
            observation.corsResponse = observation.corsResponse && response.type === 'cors';
            const contentType = String(response.headers.get('content-type') ?? '')
                .split(';', 1)[0]
                .trim()
                .toLowerCase();
            observation.responseContentType = [
                'application/json',
                'application/problem+json',
                'text/event-stream',
                'text/plain',
            ].includes(contentType)
                ? contentType
                : contentType
                  ? 'other'
                  : null;
            const allowOrigin = response.headers.get('access-control-allow-origin');
            observation.allowOriginVisible =
                observation.allowOriginVisible && (allowOrigin === '*' || allowOrigin === null);
            bodyReadTasks.push(
                (async () => {
                    const reader = response.clone().body?.getReader();
                    if (!reader) {
                        summarizeWireBody('');
                        return;
                    }
                    const decoder = new realm.TextDecoder();
                    let text = '';
                    const telemetryLimit = 262_144;
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            const decoded = decoder.decode(value, { stream: true });
                            if (text.length < telemetryLimit) {
                                const remaining = telemetryLimit - text.length;
                                text += decoded.slice(0, remaining);
                                if (decoded.length > remaining) {
                                    observation.wireBodyTruncatedForTelemetry = true;
                                }
                            } else {
                                observation.wireBodyTruncatedForTelemetry = true;
                            }
                        }
                        if (text.length < telemetryLimit) text += decoder.decode();
                    } catch {
                        observation.wireBodyReadError = true;
                    } finally {
                        summarizeWireBody(text);
                    }
                })()
            );
            return response;
        };

    window.fetch = wrapFetch(topOriginalFetch, window);
    iframe.contentWindow.fetch = wrapFetch(iframeOriginalFetch, iframe.contentWindow);
    let invocation = { settled: false, rejected: false, errorName: null };
    try {
        invocation = await Promise.race([
            Promise.resolve()
                .then(() => handlers.at(-1)())
                .then(
                    () => ({ settled: true, rejected: false, errorName: null }),
                    error => {
                        const rawName = typeof error?.name === 'string' ? error.name : '';
                        const rawCode = typeof error?.code === 'string' ? error.code : '';
                        return {
                            settled: true,
                            rejected: true,
                            errorName: [
                                'AbortError',
                                'Error',
                                'PiRequestAbortedError',
                                'PiResultAdapterError',
                                'PiRuntimeError',
                                'TypeError',
                            ].includes(rawName)
                                ? rawName
                                : 'OtherError',
                            errorCode: [
                                'aborted',
                                'invalid_configuration',
                                'invalid_prompt',
                                'network',
                                'protocol',
                                'provider',
                                'request_already_active',
                            ].includes(rawCode)
                                ? rawCode
                                : null,
                        };
                    }
                ),
            new Promise(resolve =>
                setTimeout(
                    () => resolve({ settled: false, rejected: false, errorName: null }),
                    150000
                )
            ),
        ]);
        await Promise.allSettled(bodyReadTasks);
        await new Promise(resolve => setTimeout(resolve, 250));
    } finally {
        window.fetch = topOriginalFetch;
        iframe.contentWindow.fetch = iframeOriginalFetch;
    }

    const lastMessage = context.chat.at(-1);
    const lastMessageText = String(lastMessage?.mes ?? lastMessage?.message ?? '');
    let runtimeCanAccessParentOrigin = false;
    let runtimeDocumentBaseOrigin = null;
    try {
        runtimeDocumentBaseOrigin = new URL(iframe.contentWindow.document.baseURI).origin;
        runtimeCanAccessParentOrigin =
            iframe.contentWindow.parent === window &&
            iframe.contentWindow.parent.location.origin === window.location.origin &&
            runtimeDocumentBaseOrigin === window.location.origin;
    } catch {
        runtimeCanAccessParentOrigin = false;
    }
    return {
        ...observation,
        preInvocation,
        invocation,
        resultMarkerSeen: lastMessageText.includes(configuration.marker),
        updateTagSeen: /<UpdateVariable>[\s\S]*<\/UpdateVariable>/.test(lastMessageText),
        topOrigin: window.location.origin,
        runtimeOrigin: iframe.contentWindow.location.origin,
        runtimeDocumentBaseOrigin,
        runtimeCanAccessParentOrigin,
        handlerCount: handlers.length,
        extraAnalysisEnded: window.Mvu?.isDuringExtraAnalysis?.() === false,
    };
}

async function startPiAbortCase(configuration) {
    const context = window.SillyTavern.getContext();
    const iframe = [...document.querySelectorAll('iframe')].find(frame =>
        frame.id.startsWith('TH-script--' + configuration.scriptName)
    );
    if (!iframe?.contentWindow) throw new Error('artifact-iframe-missing');
    if (window.__mvuPiLiveAbortState) throw new Error('abort-state-already-active');

    const retryEventId = iframe.contentWindow.getButtonEvent('重试额外模型解析');
    const stopEventId = iframe.contentWindow.getButtonEvent('停止“更多”额外模型解析');
    const retryHandlers = context.eventSource?.events?.[retryEventId];
    const stopHandlers = context.eventSource?.events?.[stopEventId];
    if (!Array.isArray(retryHandlers) || retryHandlers.length === 0) {
        throw new Error('retry-handler-missing');
    }
    if (!Array.isArray(stopHandlers) || stopHandlers.length === 0) {
        throw new Error('stop-handler-missing');
    }

    await context.setExtensionPrompt(
        configuration.injectionId,
        'Cancellation transport smoke nonce ' +
            configuration.abortNonce +
            '. Produce a detailed response of at least 2000 words before any variable update.',
        1,
        0,
        false,
        0
    );

    const settingsBefore = context.extensionSettings?.mvu_settings?.额外模型解析配置;
    const lastMessageBefore = context.chat.at(-1);
    const preInvocation = {
        lastMessageIsAssistant: lastMessageBefore?.is_user === false,
        lastMessageHasStatusPlaceholder: String(
            lastMessageBefore?.mes ?? lastMessageBefore?.message ?? ''
        ).includes('<StatusPlaceHolderImpl/>'),
        sourceIsPi: settingsBefore?.模型来源 === '更多',
        providerMatched: settingsBefore?.pi?.provider === configuration.provider,
        apiMatched: settingsBefore?.pi?.api === configuration.api,
        endpointMatched: settingsBefore?.pi?.endpoint === configuration.endpoint,
        modelMatched: settingsBefore?.pi?.model === configuration.model,
        customHeadersExact: settingsBefore?.pi?.customHeaders === configuration.customHeaders,
        placeholderCredentialMatched: settingsBefore?.密钥 === configuration.placeholderApiKey,
        extraAnalysisIdle: window.Mvu?.isDuringExtraAnalysis?.() === false,
    };

    const topOriginalFetch = window.fetch;
    const iframeOriginalFetch = iframe.contentWindow.fetch;
    const state = {
        iframe: iframe.contentWindow,
        topOriginalFetch,
        iframeOriginalFetch,
        topWrappedFetch: null,
        iframeWrappedFetch: null,
        stopHandler: stopHandlers.at(-1),
        preInvocation,
        requestCount: 0,
        paths: [],
        requestHeaderNames: [],
        expectedAuthMatched: true,
        outboundAuthInjected: true,
        customHeaderOverridesApplied: true,
        explicitSignalPresent: true,
        signalIsAbortSignal: true,
        signalAbortedAtDispatch: false,
        signal: null,
        responseResolved: false,
        responseStatus: null,
        fetchRejected: false,
        fetchErrorName: null,
        signalAbortedAtFetchReject: false,
        bodyReadRejected: false,
        bodyReadErrorName: null,
        signalAbortedAtBodyReject: false,
        bodyReadPromises: [],
        stopInvoked: false,
        invocation: { settled: false, rejected: false, errorName: null },
        invocationPromise: null,
    };

    const safeErrorName = error =>
        [
            'AbortError',
            'NetworkError',
            'NotAllowedError',
            'SecurityError',
            'TimeoutError',
            'TypeError',
        ].includes(error?.name)
            ? error.name
            : 'OtherError';
    const wrapFetch = (originalFetch, realm) =>
        async function (input, init) {
            const rawUrl =
                typeof input === 'string'
                    ? input
                    : input instanceof realm.URL
                      ? input.href
                      : input?.url;
            let url;
            try {
                url = new realm.URL(rawUrl, realm.location.href);
            } catch {
                return originalFetch.call(realm, input, init);
            }
            if (url.origin !== configuration.expectedOrigin) {
                return originalFetch.call(realm, input, init);
            }

            state.requestCount += 1;
            state.paths.push(url.pathname);
            const headers = new realm.Headers(input?.headers);
            new realm.Headers(init?.headers).forEach((value, name) => headers.set(name, value));
            state.requestHeaderNames = [...headers.keys()].map(name => name.toLowerCase()).sort();
            const expectedAuthValue =
                configuration.expectedAuthHeader === 'authorization'
                    ? 'Bearer ' + configuration.placeholderApiKey
                    : configuration.placeholderApiKey;
            state.expectedAuthMatched =
                state.expectedAuthMatched &&
                headers.get(configuration.expectedAuthHeader) === expectedAuthValue;
            state.customHeaderOverridesApplied =
                state.customHeaderOverridesApplied &&
                configuration.removedRequestHeaders.every(name => !headers.has(name));

            const outboundHeaders = new realm.Headers(headers);
            const outboundAuthValue =
                configuration.expectedAuthHeader === 'authorization'
                    ? 'Bearer ' + configuration.apiKey
                    : configuration.apiKey;
            outboundHeaders.set(configuration.expectedAuthHeader, outboundAuthValue);
            state.outboundAuthInjected =
                state.outboundAuthInjected &&
                outboundHeaders.get(configuration.expectedAuthHeader) === outboundAuthValue;

            const signal = init?.signal ?? input?.signal;
            state.signal = signal ?? null;
            state.explicitSignalPresent = state.explicitSignalPresent && signal !== undefined;
            state.signalIsAbortSignal =
                state.signalIsAbortSignal &&
                Boolean(
                    signal &&
                        (signal instanceof realm.AbortSignal ||
                            Object.prototype.toString.call(signal) === '[object AbortSignal]')
                );
            state.signalAbortedAtDispatch =
                state.signalAbortedAtDispatch || signal?.aborted === true;

            let response;
            try {
                response = await originalFetch.call(realm, input, {
                    ...(init ?? {}),
                    headers: outboundHeaders,
                });
            } catch (error) {
                state.fetchRejected = true;
                state.fetchErrorName = safeErrorName(error);
                state.signalAbortedAtFetchReject = signal?.aborted === true;
                throw error;
            }
            state.responseResolved = true;
            state.responseStatus =
                Number.isInteger(response.status) &&
                response.status >= 100 &&
                response.status <= 599
                    ? response.status
                    : null;
            const bodyReadPromise = (async () => {
                const reader = response.clone().body?.getReader();
                if (!reader) return;
                try {
                    while (!(await reader.read()).done) {
                        // Consume only the diagnostic tee; no response bytes are retained.
                    }
                } catch (error) {
                    state.bodyReadRejected = true;
                    state.bodyReadErrorName = safeErrorName(error);
                    state.signalAbortedAtBodyReject = signal?.aborted === true;
                }
            })();
            state.bodyReadPromises.push(bodyReadPromise);
            return response;
        };

    state.topWrappedFetch = wrapFetch(topOriginalFetch, window);
    state.iframeWrappedFetch = wrapFetch(iframeOriginalFetch, iframe.contentWindow);
    window.fetch = state.topWrappedFetch;
    iframe.contentWindow.fetch = state.iframeWrappedFetch;
    window.__mvuPiLiveAbortState = state;

    state.invocationPromise = Promise.resolve()
        .then(() => retryHandlers.at(-1)())
        .then(
            () => {
                state.invocation = { settled: true, rejected: false, errorName: null };
            },
            error => {
                state.invocation = {
                    settled: true,
                    rejected: true,
                    errorName: [
                        'AbortError',
                        'Error',
                        'PiRequestAbortedError',
                        'PiResultAdapterError',
                        'PiRuntimeError',
                        'TypeError',
                    ].includes(error?.name)
                        ? error.name
                        : 'OtherError',
                };
            }
        );

    return {
        started: true,
        preInvocation,
        retryHandlerCount: retryHandlers.length,
        stopHandlerCount: stopHandlers.length,
    };
}

function readPiAbortCase() {
    const state = window.__mvuPiLiveAbortState;
    if (!state) return { exists: false };
    return {
        exists: true,
        requestCount: state.requestCount,
        paths: [...state.paths],
        signalPresent: state.signal !== null,
        signalAborted: state.signal?.aborted === true,
        stopInvoked: state.stopInvoked,
        invocationSettled: state.invocation.settled === true,
    };
}

async function stopPiAbortCase() {
    const state = window.__mvuPiLiveAbortState;
    if (!state) throw new Error('abort-state-missing');
    state.stopInvoked = true;
    await Promise.resolve(state.stopHandler());
    return {
        stopInvoked: true,
        signalAborted: state.signal?.aborted === true,
    };
}

async function finishPiAbortCase(configuration) {
    const state = window.__mvuPiLiveAbortState;
    if (!state) throw new Error('abort-state-missing');
    const timeout = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    await Promise.race([state.invocationPromise, timeout(15_000)]);
    await Promise.race([Promise.allSettled(state.bodyReadPromises), timeout(2_000)]);

    const context = window.SillyTavern.getContext();
    const lastMessage = context.chat.at(-1);
    const lastMessageText = String(lastMessage?.mes ?? lastMessage?.message ?? '');
    const evidence = {
        preInvocation: state.preInvocation,
        requestCount: state.requestCount,
        paths: [...state.paths],
        requestHeaderNames: [...state.requestHeaderNames],
        expectedAuthMatched: state.expectedAuthMatched,
        outboundAuthInjected: state.outboundAuthInjected,
        customHeaderOverridesApplied: state.customHeaderOverridesApplied,
        explicitSignalPresent: state.explicitSignalPresent,
        signalIsAbortSignal: state.signalIsAbortSignal,
        signalAbortedAtDispatch: state.signalAbortedAtDispatch,
        signalAbortedAfterStop: state.signal?.aborted === true,
        responseResolved: state.responseResolved,
        responseStatus: state.responseStatus,
        fetchRejected: state.fetchRejected,
        fetchErrorName: state.fetchErrorName,
        signalAbortedAtFetchReject: state.signalAbortedAtFetchReject,
        bodyReadRejected: state.bodyReadRejected,
        bodyReadErrorName: state.bodyReadErrorName,
        signalAbortedAtBodyReject: state.signalAbortedAtBodyReject,
        stopInvoked: state.stopInvoked,
        invocation: state.invocation,
        resultMarkerSeen: lastMessageText.includes(configuration.marker),
        updateTagSeen: /<UpdateVariable>[\s\S]*<\/UpdateVariable>/.test(lastMessageText),
        extraAnalysisEnded: window.Mvu?.isDuringExtraAnalysis?.() === false,
        topOrigin: window.location.origin,
        runtimeDocumentBaseOrigin: new URL(state.iframe.document.baseURI).origin,
    };

    if (window.fetch === state.topWrappedFetch) window.fetch = state.topOriginalFetch;
    if (state.iframe.fetch === state.iframeWrappedFetch) {
        state.iframe.fetch = state.iframeOriginalFetch;
    }
    evidence.fetchWrappersRestored =
        window.fetch === state.topOriginalFetch && state.iframe.fetch === state.iframeOriginalFetch;
    delete window.__mvuPiLiveAbortState;
    return evidence;
}

async function scrubCredentialAndUnload(setup) {
    const context = window.SillyTavern.getContext();
    const helper = window.TavernHelper;
    const abortState = window.__mvuPiLiveAbortState;
    let abortStateCleaned = true;
    if (abortState) {
        try {
            abortState.stopInvoked = true;
            await Promise.resolve(abortState.stopHandler());
            await Promise.race([
                Promise.resolve(abortState.invocationPromise).catch(() => undefined),
                new Promise(resolve => setTimeout(resolve, 2_000)),
            ]);
        } catch {
            abortStateCleaned = false;
        }
        if (window.fetch === abortState.topWrappedFetch) {
            window.fetch = abortState.topOriginalFetch;
        }
        if (abortState.iframe?.fetch === abortState.iframeWrappedFetch) {
            abortState.iframe.fetch = abortState.iframeOriginalFetch;
        }
        abortStateCleaned =
            abortStateCleaned &&
            window.fetch === abortState.topOriginalFetch &&
            abortState.iframe?.fetch === abortState.iframeOriginalFetch;
        delete window.__mvuPiLiveAbortState;
    }
    const keyInput = document.querySelector('.mvu-field > input[type="password"]');
    if (keyInput) {
        setInputValue(keyInput, '');
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    const settings = context.extensionSettings.mvu_settings;
    if (settings?.额外模型解析配置) {
        settings.额外模型解析配置.密钥 = '';
        settings.额外模型解析配置.customApiKey = '';
        if (settings.额外模型解析配置.pi) {
            settings.额外模型解析配置.pi.apiKeys = {};
            settings.额外模型解析配置.pi.credentials = {};
        }
    }
    await context.setExtensionPrompt(setup.injectionId, '', -1, 0, false, 0);
    helper.replaceScriptTrees([], { type: 'global' });
    await new Promise(resolve => setTimeout(resolve, 500));

    const originalGetContext = window.__mvuLiveOriginalGetContext;
    if (typeof originalGetContext === 'function') {
        window.SillyTavern.getContext = originalGetContext;
    }
    delete window.__mvuLiveOriginalGetContext;
    return {
        credentialFieldEmpty: keyInput ? keyInput.value === '' : true,
        extensionCredentialEmpty:
            settings?.额外模型解析配置?.密钥 === '' &&
            Object.keys(settings?.额外模型解析配置?.pi?.apiKeys ?? {}).length === 0,
        artifactIframeRemoved: ![...document.querySelectorAll('iframe')].some(frame =>
            frame.id.startsWith('TH-script--' + setup.scriptName)
        ),
        saveSettingsRestored:
            typeof originalGetContext !== 'function' ||
            window.SillyTavern.getContext === originalGetContext,
        abortStateCleaned,
    };
}

async function findPersistenceMatches(root, rootKind, needles) {
    if (!root || !fs.existsSync(root)) return [];
    const matches = [];
    const stack = [root];
    while (stack.length > 0) {
        const current = stack.pop();
        let entries;
        try {
            entries = await readdir(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(entryPath);
            } else if (entry.isFile()) {
                const bytes = await readFile(entryPath).catch(() => undefined);
                if (!bytes) continue;
                for (const needle of needles) {
                    if (!bytes.includes(needle.bytes)) continue;
                    const relativePath = path.relative(root, entryPath);
                    matches.push({
                        kind: needle.kind,
                        root: rootKind,
                        relativePath:
                            relativePath &&
                            !relativePath.startsWith('..') &&
                            !path.isAbsolute(relativePath)
                                ? relativePath
                                : 'unavailable',
                        sizeBucket:
                            bytes.length < 1_024
                                ? '<1KiB'
                                : bytes.length < 1_048_576
                                  ? '1KiB-1MiB'
                                  : '>=1MiB',
                    });
                    if (matches.length >= 20) return matches;
                }
            }
        }
    }
    return matches;
}

async function removeRunRoot(runRoot) {
    if (!runRoot) return true;
    const resolved = path.resolve(runRoot);
    assertSmoke(
        path.dirname(resolved) === path.resolve(os.tmpdir()) &&
            path.basename(resolved).startsWith(TEMP_PREFIX),
        'unsafe-run-root-cleanup'
    );
    await rm(resolved, { recursive: true, force: true });
    return !fs.existsSync(resolved);
}

async function removeProfileRoot(profile) {
    if (!profile?.separate) return true;
    const resolved = path.resolve(profile.profileRoot);
    assertSmoke(
        path.dirname(resolved) === path.resolve(profile.allowedParent) &&
            path.basename(resolved).startsWith(FIREFOX_PROFILE_PREFIX),
        'unsafe-profile-cleanup'
    );
    await rm(resolved, { recursive: true, force: true });
    return !fs.existsSync(resolved);
}

async function main() {
    let phase = 'preflight';
    let runRoot;
    let stProcess;
    let geckoProcess;
    let profile;
    let artifactServer;
    let driver;
    let sessionId;
    let bidiNetworkRecorder = unavailableBidiNetworkRecorder(
        BIDI_NETWORK_ENABLED ? 'not-started' : 'disabled'
    );
    let activeCaseBidiMark = 0;
    let credential;
    let cleanup = true;
    let credentialPersisted = false;
    let persistenceDiagnostics = [];
    let browserScrubbed = false;
    let failure;
    let failurePhase;
    let failureDiagnostics;
    let activeCaseSummary;
    let connectivitySummary;
    let wirePreflightSummary;
    let output;
    const summaries = [];

    try {
        const selectedCases =
            REQUESTED_CASE === ''
                ? CASES
                : CASES.filter(testCase => testCase.name === REQUESTED_CASE);
        assertSmoke(REQUESTED_CASE === '' || selectedCases.length === 1, 'requested-case-invalid');
        const stRoot = resolveSillyTavernRoot();
        assertSmoke(stRoot, 'st-root-not-found');
        assertSmoke(isFile(artifactPath), 'artifact-missing');
        assertSmoke(isFile(characterCardPath), 'character-card-missing');
        assertSmoke(!(INSTALL_ONLY && CONNECTIVITY_ONLY), 'live-mode-conflict');
        if (!INSTALL_ONLY && !CONNECTIVITY_ONLY) {
            assertSmoke(isFile(tokenPath), 'credential-file-missing');
            credential = readCredential();
        }

        const artifactBytes = await readFile(artifactPath);
        const artifactHash = sha256(artifactBytes);
        runRoot = await mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
        await chmod(runRoot, 0o700);
        const dataRoot = path.join(runRoot, 'data');
        const configPath = path.join(runRoot, 'config.yaml');
        await Promise.all([
            mkdir(dataRoot, { recursive: true, mode: 0o700 }),
            mkdir(path.join(runRoot, 'runtime'), { recursive: true, mode: 0o700 }),
        ]);
        await prepareConfig(stRoot, configPath, dataRoot);

        const geckodriver = resolveGeckodriver();
        profile = await createFirefoxProfileRoot(geckodriver, runRoot);
        await Promise.all(
            ['cache', 'config', 'share', 'runtime'].map(directory =>
                mkdir(path.join(profile.profileRoot, directory), {
                    recursive: true,
                    mode: 0o700,
                })
            )
        );
        const stPort = await allocatePort();
        const geckoPort = await allocatePort();
        const artifact = startArtifactServer(artifactBytes);
        artifactServer = artifact.server;
        const artifactPort = await listenLoopback(artifactServer);

        phase = 'start-sillytavern';
        stProcess = startProcess(
            process.execPath,
            [
                'server.js',
                '--configPath',
                configPath,
                '--dataRoot',
                dataRoot,
                '--port',
                String(stPort),
                '--listen',
                'false',
                '--listenAddressIPv4',
                '127.0.0.1',
                '--enableIPv4',
                'true',
                '--enableIPv6',
                'false',
                '--browserLaunchEnabled',
                'false',
                '--disableCsrf',
                'true',
                '--heartbeatInterval',
                '0',
                '--requestProxyEnabled',
                'false',
            ],
            { cwd: stRoot, env: isolatedEnvironment(runRoot) }
        );
        const stUrl = 'http://127.0.0.1:' + stPort;
        await waitForHttp(stUrl, stProcess, 45_000);

        phase = 'start-webdriver';
        geckoProcess = startProcess(
            geckodriver,
            [
                '--host',
                '127.0.0.1',
                '--allow-hosts',
                '127.0.0.1',
                '--port',
                String(geckoPort),
                '--profile-root',
                profile.profileRoot,
                '--log',
                'error',
            ],
            { cwd: profile.profileRoot, env: isolatedEnvironment(profile.profileRoot) }
        );
        const driverUrl = 'http://127.0.0.1:' + geckoPort;
        await waitForHttp(
            driverUrl + '/status',
            geckoProcess,
            30_000,
            async response => response.ok && (await response.json())?.value?.ready === true
        );
        driver = webdriver(driverUrl, () => sessionId);
        let session;
        try {
            session = await driver.createSession(BIDI_NETWORK_ENABLED);
        } catch (error) {
            if (!BIDI_NETWORK_ENABLED) throw error;
            session = await driver.createSession(false);
        }
        sessionId = session?.sessionId;
        assertSmoke(sessionId, 'webdriver-session-create-failed');
        const browserProfile = session?.capabilities?.['moz:profile'];
        assertSmoke(
            typeof browserProfile === 'string' &&
                path
                    .resolve(browserProfile)
                    .startsWith(path.resolve(profile.profileRoot) + path.sep),
            'firefox-profile-not-isolated'
        );
        const browserVersion = String(session?.capabilities?.browserVersion ?? '');
        bidiNetworkRecorder = await createBidiNetworkRecorder(
            session?.capabilities?.webSocketUrl
        ).catch(() => unavailableBidiNetworkRecorder('initialization-failed'));
        await driver.setTimeouts();

        phase = 'initialize-sillytavern';
        await driver.navigate(stUrl);
        await waitForBrowser(driver, () => document.readyState === 'complete', [], 30_000);
        const reset = await driver.executeAsync(`
            const done = arguments[arguments.length - 1];
            fetch('/api/users/reset-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: '' }),
            }).then(response => done({ ok: response.status === 204 || response.ok }))
              .catch(() => done({ ok: false }));
        `);
        assertSmoke(reset?.ok, 'settings-reset-failed');
        await driver.navigate(stUrl);
        await waitForBrowser(driver, () => document.readyState === 'complete', [], 30_000);
        for (let index = 0; index < 8; index += 1) {
            const popup = await clickPopup(driver, 'accept');
            if (!popup?.handled) break;
            await delay(300);
        }
        await waitForBrowser(driver, browserReadyForTavernHelper, [], 45_000);

        const version = await fetch(stUrl + '/version', {
            signal: AbortSignal.timeout(5_000),
        }).then(response => response.json());
        const sillyTavernVersion = String(version?.pkgVersion ?? '');
        assertSmoke(sillyTavernVersion === '1.18.0', 'unexpected-sillytavern-version');

        phase = 'import-character';
        const input = await driver.findElement('#character_import_file');
        const inputId = elementId(input);
        assertSmoke(inputId, 'character-import-input-missing');
        await driver.setFileInput(inputId, characterCardPath);
        await waitForBrowser(driver, browserHasImportedCharacter, [], 45_000);
        const selected = await driver.execute(`
            const context = window.SillyTavern.getContext();
            const index = context.characters.findIndex(character =>
                String(character?.name ?? '').includes('青空')
            );
            if (index < 0) return { ok: false };
            Promise.resolve(context.selectCharacterById(index)).catch(() => undefined);
            return { ok: true };
        `);
        assertSmoke(selected?.ok, 'imported-character-not-found');
        const popupEvidence = await settlePopups(driver, 35_000);
        await waitForBrowser(driver, browserHasSelectedCharacter, [], 35_000);

        phase = 'install-artifact';
        const artifactUrl =
            'http://127.0.0.1:' + artifactPort + '/bundle.js?sha=' + artifactHash.slice(0, 12);
        const installed = await driver.executeAsync(
            safeAsyncBrowserScript(installArtifact),
            [
                {
                    artifactUrl,
                    scriptName: SCRIPT_NAME,
                    scriptId: SCRIPT_ID,
                    injectionId: INJECTION_ID,
                    marker: RESULT_MARKER,
                    model: LIVE_MODEL,
                    cases: CASES,
                },
            ],
            90_000
        );
        assertSmoke(
            installed?.ok && installed.value?.saveSettingsPatched,
            'artifact-install-failed'
        );
        try {
            await waitForBrowser(driver, browserArtifactReady, [SCRIPT_NAME], 90_000);
        } catch (error) {
            failureDiagnostics = await driver
                .execute(
                    `
                        const iframe = [...document.querySelectorAll('iframe')].find(frame =>
                            frame.id.startsWith('TH-script--' + arguments[0])
                        );
                        return {
                            artifactRequests: arguments[1],
                            iframeExists: !!iframe,
                            iframeDocumentReady: iframe?.contentDocument?.readyState === 'complete',
                            moduleState: ['loading', 'loaded', 'rejected'].includes(
                                iframe?.contentWindow?.__mvuLiveModuleState
                            ) ? iframe.contentWindow.__mvuLiveModuleState : 'missing',
                            mvuPresent: !!window.Mvu,
                            buttonApiPresent:
                                typeof iframe?.contentWindow?.getButtonEvent === 'function',
                            sourceControlsPresent:
                                !!document.querySelector('.mvu-pi-model-controls'),
                        };
                    `,
                    [SCRIPT_NAME, artifact.getRequestCount()],
                    10_000
                )
                .catch(() => ({ diagnosticUnavailable: true }));
            throw error;
        }
        assertSmoke(artifact.getRequestCount() >= 1, 'artifact-not-requested');

        const tavernHelperVersion = String(
            await driver.execute('return window.TavernHelper.getTavernHelperVersion();')
        );
        assertSmoke(tavernHelperVersion === '4.9.3', 'unexpected-tavernhelper-version');

        if (!INSTALL_ONLY) {
            phase = 'browser-connectivity-preflight';
            const connectivityMark = bidiNetworkRecorder.mark();
            const connectivity = await driver.executeAsync(
                safeAsyncBrowserScript(probeOpenRouterBrowserConnectivity),
                [SCRIPT_NAME],
                25_000
            );
            connectivitySummary = {
                responseResolved: connectivity?.ok && connectivity.value?.responseResolved === true,
                status:
                    Number.isInteger(connectivity?.value?.status) &&
                    connectivity.value.status >= 100 &&
                    connectivity.value.status <= 599
                        ? connectivity.value.status
                        : null,
                responseType: [
                    'basic',
                    'cors',
                    'default',
                    'error',
                    'opaque',
                    'opaqueredirect',
                ].includes(connectivity?.value?.responseType)
                    ? connectivity.value.responseType
                    : null,
                signalAborted: connectivity?.value?.signalAborted === true,
                fetchErrorName:
                    typeof connectivity?.value?.fetchErrorName === 'string'
                        ? connectivity.value.fetchErrorName
                        : null,
                fetchErrorIsTypeError: connectivity?.value?.fetchErrorIsTypeError === true,
                elapsedBucket: ['<100ms', '100-999ms', '>=1000ms'].includes(
                    connectivity?.value?.elapsedBucket
                )
                    ? connectivity.value.elapsedBucket
                    : null,
                bidiNetwork: bidiNetworkRecorder.snapshot(connectivityMark),
            };
            failureDiagnostics = { connectivity: connectivitySummary };
            assertSmoke(
                connectivitySummary.responseResolved &&
                    connectivitySummary.status !== null &&
                    connectivitySummary.status >= 200 &&
                    connectivitySummary.status < 300 &&
                    connectivitySummary.responseType === 'cors' &&
                    !connectivitySummary.signalAborted,
                'browser-connectivity-preflight-failed'
            );

            phase = 'browser-wire-preflight';
            const wirePreflightMark = bidiNetworkRecorder.mark();
            const wirePreflight = await driver.executeAsync(
                safeAsyncBrowserScript(probeOpenRouterResponsesBrowserTransport),
                [SCRIPT_NAME],
                25_000
            );
            wirePreflightSummary = {
                responseResolved:
                    wirePreflight?.ok && wirePreflight.value?.responseResolved === true,
                status:
                    Number.isInteger(wirePreflight?.value?.status) &&
                    wirePreflight.value.status >= 100 &&
                    wirePreflight.value.status <= 599
                        ? wirePreflight.value.status
                        : null,
                responseType: [
                    'basic',
                    'cors',
                    'default',
                    'error',
                    'opaque',
                    'opaqueredirect',
                ].includes(wirePreflight?.value?.responseType)
                    ? wirePreflight.value.responseType
                    : null,
                signalAborted: wirePreflight?.value?.signalAborted === true,
                fetchErrorName:
                    typeof wirePreflight?.value?.fetchErrorName === 'string'
                        ? wirePreflight.value.fetchErrorName
                        : null,
                fetchErrorIsTypeError: wirePreflight?.value?.fetchErrorIsTypeError === true,
                elapsedBucket: ['<100ms', '100-999ms', '>=1000ms'].includes(
                    wirePreflight?.value?.elapsedBucket
                )
                    ? wirePreflight.value.elapsedBucket
                    : null,
                bidiNetwork: bidiNetworkRecorder.snapshot(wirePreflightMark),
            };
            failureDiagnostics = {
                connectivity: connectivitySummary,
                wirePreflight: wirePreflightSummary,
            };
            assertSmoke(
                wirePreflightSummary.responseResolved &&
                    wirePreflightSummary.status !== null &&
                    wirePreflightSummary.responseType === 'cors' &&
                    !wirePreflightSummary.signalAborted,
                'browser-wire-preflight-failed'
            );
            failureDiagnostics = undefined;
        }

        phase = 'live-matrix';
        for (const [caseIndex, testCase] of (INSTALL_ONLY || CONNECTIVITY_ONLY
            ? []
            : selectedCases
        ).entries()) {
            phase = 'live-' + testCase.name;
            activeCaseBidiMark = bidiNetworkRecorder.mark();
            activeCaseSummary = {
                name: testCase.name,
                ok: false,
                requestCount: 0,
                paths: [],
                status: null,
                transport: {
                    bidiNetwork: bidiNetworkRecorder.snapshot(activeCaseBidiMark),
                },
                checks: {
                    configurationScriptCompleted: false,
                    providerSelected: false,
                    apiSelected: false,
                    endpointSelected: false,
                    modelSelected: false,
                    credentialFieldUpdated: false,
                    customHeadersUpdated: false,
                    noVisibleConfigErrors: false,
                    invocationScriptCompleted: false,
                    preInvocationStateValid: false,
                    browserOrigin: false,
                    requestSeen: false,
                    pathMatched: false,
                    authHeaderMatched: false,
                    outboundAuthInjected: false,
                    customHeaderOverridesApplied: false,
                    signalPresent: false,
                    signalIsAbortSignal: false,
                    signalNotPreAborted: false,
                    ...(testCase.mode === 'abort'
                        ? {
                              bidiRequestDispatched: false,
                              stopHandlerInvoked: false,
                              signalAborted: false,
                              bidiFetchAborted: false,
                              noProviderRetry: false,
                              invocationSettledAsManualCancel: false,
                              noResultWritten: false,
                              fetchWrappersRestored: false,
                              analysisEnded: false,
                          }
                        : {
                              responseResolved: false,
                              corsAllowed: false,
                              successStatus: false,
                              resultMarkerSeen: false,
                              updateTagSeen: false,
                              invocationSettled: false,
                              analysisEnded: false,
                          }),
                },
            };
            summaries.push(activeCaseSummary);
            failureDiagnostics = activeCaseSummary;

            const configured = await driver.executeAsync(
                safeAsyncBrowserScript(configurePiCase),
                [
                    {
                        ...testCase,
                        scriptName: SCRIPT_NAME,
                        model: LIVE_MODEL,
                        apiKey: BROWSER_CREDENTIAL_PLACEHOLDER,
                    },
                ],
                30_000
            );
            activeCaseSummary.checks.configurationScriptCompleted = configured?.ok === true;
            const configChecks = configured.value;
            activeCaseSummary.checks.providerSelected = configChecks?.providerSelected === true;
            activeCaseSummary.checks.apiSelected = configChecks?.apiSelected === true;
            activeCaseSummary.checks.endpointSelected = configChecks?.endpointSelected === true;
            activeCaseSummary.checks.modelSelected = configChecks?.modelSelected === true;
            activeCaseSummary.checks.credentialFieldUpdated =
                configChecks?.credentialLengthMatched === true;
            activeCaseSummary.checks.customHeadersUpdated =
                configChecks?.customHeadersExact === true;
            activeCaseSummary.checks.noVisibleConfigErrors = configChecks?.visibleErrorCount === 0;
            assertSmoke(
                activeCaseSummary.checks.configurationScriptCompleted,
                'case-configuration-script-failed'
            );
            assertSmoke(
                activeCaseSummary.checks.providerSelected &&
                    activeCaseSummary.checks.apiSelected &&
                    activeCaseSummary.checks.endpointSelected &&
                    activeCaseSummary.checks.modelSelected &&
                    activeCaseSummary.checks.credentialFieldUpdated &&
                    activeCaseSummary.checks.customHeadersUpdated &&
                    activeCaseSummary.checks.noVisibleConfigErrors,
                'case-configuration-invalid'
            );

            if (testCase.mode === 'abort') {
                const bidiAtStart = bidiNetworkRecorder.snapshot(activeCaseBidiMark);
                assertSmoke(bidiAtStart.available === true, 'abort-bidi-network-unavailable');

                const started = await driver.executeAsync(
                    safeAsyncBrowserScript(startPiAbortCase),
                    [
                        {
                            ...testCase,
                            scriptName: SCRIPT_NAME,
                            injectionId: INJECTION_ID,
                            marker: RESULT_MARKER,
                            model: LIVE_MODEL,
                            apiKey: credential,
                            placeholderApiKey: BROWSER_CREDENTIAL_PLACEHOLDER,
                            abortNonce: Date.now().toString(36),
                        },
                    ],
                    30_000
                );
                activeCaseSummary.checks.invocationScriptCompleted =
                    started?.ok === true && started.value?.started === true;
                assertSmoke(
                    activeCaseSummary.checks.invocationScriptCompleted,
                    'abort-case-start-failed'
                );

                const dispatch = await waitForPiAbortDispatch(
                    driver,
                    bidiNetworkRecorder,
                    activeCaseBidiMark,
                    testCase.expectedPath
                );
                activeCaseSummary.checks.bidiRequestDispatched = dispatch.reached === true;
                assertSmoke(dispatch.reached === true, 'abort-request-dispatch-not-observed');

                const stopped = await driver.executeAsync(
                    safeAsyncBrowserScript(stopPiAbortCase),
                    [],
                    10_000
                );
                activeCaseSummary.checks.stopHandlerInvoked =
                    stopped?.ok === true && stopped.value?.stopInvoked === true;
                assertSmoke(
                    activeCaseSummary.checks.stopHandlerInvoked,
                    'abort-stop-handler-failed'
                );

                const finished = await driver.executeAsync(
                    safeAsyncBrowserScript(finishPiAbortCase),
                    [{ marker: RESULT_MARKER }],
                    25_000
                );
                assertSmoke(finished?.ok === true, 'abort-case-finish-failed');
                const evidence = finished.value;
                const bidiAbort = await waitForBidiAbort(
                    bidiNetworkRecorder,
                    activeCaseBidiMark,
                    testCase.expectedPath
                );
                const paths = Array.isArray(evidence.paths)
                    ? evidence.paths.filter(
                          requestPath =>
                              typeof requestPath === 'string' &&
                              requestPath.startsWith('/') &&
                              !requestPath.includes('?')
                      )
                    : [];
                const requestCount =
                    Number.isInteger(evidence.requestCount) && evidence.requestCount >= 0
                        ? evidence.requestCount
                        : 0;
                const status =
                    Number.isInteger(evidence.responseStatus) &&
                    evidence.responseStatus >= 100 &&
                    evidence.responseStatus <= 599
                        ? evidence.responseStatus
                        : null;
                Object.assign(activeCaseSummary.checks, {
                    preInvocationStateValid:
                        evidence.preInvocation?.lastMessageIsAssistant === true &&
                        evidence.preInvocation?.lastMessageHasStatusPlaceholder === true &&
                        evidence.preInvocation?.sourceIsPi === true &&
                        evidence.preInvocation?.providerMatched === true &&
                        evidence.preInvocation?.apiMatched === true &&
                        evidence.preInvocation?.endpointMatched === true &&
                        evidence.preInvocation?.modelMatched === true &&
                        evidence.preInvocation?.customHeadersExact === true &&
                        evidence.preInvocation?.placeholderCredentialMatched === true &&
                        evidence.preInvocation?.extraAnalysisIdle === true,
                    browserOrigin:
                        evidence.topOrigin === stUrl &&
                        evidence.runtimeDocumentBaseOrigin === stUrl,
                    requestSeen: requestCount === 1,
                    pathMatched: paths.length === 1 && paths[0] === testCase.expectedPath,
                    authHeaderMatched: evidence.expectedAuthMatched === true,
                    outboundAuthInjected: evidence.outboundAuthInjected === true,
                    customHeaderOverridesApplied: evidence.customHeaderOverridesApplied === true,
                    signalPresent: evidence.explicitSignalPresent === true,
                    signalIsAbortSignal: evidence.signalIsAbortSignal === true,
                    signalNotPreAborted: evidence.signalAbortedAtDispatch === false,
                    signalAborted: evidence.signalAbortedAfterStop === true,
                    bidiFetchAborted: bidiAbort.seen === true,
                    noProviderRetry: requestCount === 1,
                    // Manual cancellation is intentionally consumed by invokeExtraModelWithStrategy;
                    // the user-facing retry handler settles normally instead of leaking an abort.
                    invocationSettledAsManualCancel:
                        evidence.invocation?.settled === true &&
                        evidence.invocation?.rejected === false,
                    noResultWritten:
                        evidence.resultMarkerSeen === false && evidence.updateTagSeen === false,
                    fetchWrappersRestored: evidence.fetchWrappersRestored === true,
                    analysisEnded: evidence.extraAnalysisEnded === true,
                });
                activeCaseSummary.requestCount = requestCount;
                activeCaseSummary.paths = paths;
                activeCaseSummary.status = status;
                activeCaseSummary.transport = {
                    requestHeaderNames: Array.isArray(evidence.requestHeaderNames)
                        ? evidence.requestHeaderNames.filter(
                              name => typeof name === 'string' && /^[a-z0-9-]+$/.test(name)
                          )
                        : [],
                    responseResolved: evidence.responseResolved === true,
                    fetchRejected: evidence.fetchRejected === true,
                    fetchErrorName:
                        typeof evidence.fetchErrorName === 'string'
                            ? evidence.fetchErrorName
                            : null,
                    signalAbortedAtFetchReject: evidence.signalAbortedAtFetchReject === true,
                    bodyReadRejected: evidence.bodyReadRejected === true,
                    bodyReadErrorName:
                        typeof evidence.bodyReadErrorName === 'string'
                            ? evidence.bodyReadErrorName
                            : null,
                    signalAbortedAtBodyReject: evidence.signalAbortedAtBodyReject === true,
                    invocationSettled: evidence.invocation?.settled === true,
                    invocationRejected: evidence.invocation?.rejected === true,
                    bidiNetwork: bidiAbort.snapshot,
                };
                activeCaseSummary.ok = Object.values(activeCaseSummary.checks).every(
                    check => check === true
                );
                assertSmoke(activeCaseSummary.ok, 'case-check-failed-' + testCase.name);
                failureDiagnostics = undefined;
                activeCaseSummary = undefined;
                activeCaseBidiMark = 0;
                continue;
            }

            const invoked = await driver.executeAsync(
                safeAsyncBrowserScript(invokePiCase),
                [
                    {
                        ...testCase,
                        scriptName: SCRIPT_NAME,
                        marker: RESULT_MARKER,
                        model: LIVE_MODEL,
                        apiKey: credential,
                        placeholderApiKey: BROWSER_CREDENTIAL_PLACEHOLDER,
                    },
                ],
                180_000
            );
            activeCaseSummary.checks.invocationScriptCompleted = invoked?.ok === true;
            assertSmoke(
                activeCaseSummary.checks.invocationScriptCompleted,
                'case-invocation-script-failed'
            );
            const evidence = invoked.value;
            const requestCount =
                Number.isInteger(evidence.requestCount) && evidence.requestCount >= 0
                    ? evidence.requestCount
                    : 0;
            const paths = Array.isArray(evidence.paths)
                ? evidence.paths.filter(
                      requestPath =>
                          typeof requestPath === 'string' &&
                          requestPath.startsWith('/') &&
                          !requestPath.includes('?')
                  )
                : [];
            const status =
                Number.isInteger(evidence.statuses?.[0]) &&
                evidence.statuses[0] >= 100 &&
                evidence.statuses[0] <= 599
                    ? evidence.statuses[0]
                    : null;
            Object.assign(activeCaseSummary.checks, {
                preInvocationStateValid:
                    evidence.preInvocation?.lastMessageIsAssistant === true &&
                    evidence.preInvocation?.lastMessageHasStatusPlaceholder === true &&
                    evidence.preInvocation?.sourceIsPi === true &&
                    evidence.preInvocation?.providerMatched === true &&
                    evidence.preInvocation?.apiMatched === true &&
                    evidence.preInvocation?.endpointMatched === true &&
                    evidence.preInvocation?.modelMatched === true &&
                    evidence.preInvocation?.customHeadersExact === true &&
                    evidence.preInvocation?.placeholderCredentialMatched === true &&
                    evidence.preInvocation?.extraAnalysisIdle === true,
                browserOrigin:
                    evidence.topOrigin === stUrl && evidence.runtimeCanAccessParentOrigin === true,
                requestSeen: requestCount === 1,
                pathMatched: paths.length === 1 && paths[0] === testCase.expectedPath,
                authHeaderMatched: evidence.expectedAuthMatched === true,
                outboundAuthInjected: evidence.outboundAuthInjected === true,
                customHeaderOverridesApplied: evidence.customHeaderOverridesApplied === true,
                signalPresent: evidence.explicitSignalPresent === true,
                signalIsAbortSignal: evidence.signalIsAbortSignal === true,
                signalNotPreAborted: evidence.signalAbortedAtDispatch === false,
                responseResolved: evidence.responseResolved === true,
                corsAllowed: evidence.corsResponse === true && evidence.allowOriginVisible === true,
                successStatus: status !== null && status >= 200 && status < 300,
                // The cloned response stream is diagnostic-only: Firefox may end that tee branch
                // before its final SSE frame even when the adapter consumed the original stream.
                // The normalized adapter result below remains the end-to-end output assertion.
                resultMarkerSeen: evidence.resultMarkerSeen === true,
                updateTagSeen: evidence.updateTagSeen === true,
                invocationSettled:
                    evidence.invocation?.settled === true &&
                    evidence.invocation?.rejected === false,
                analysisEnded: evidence.extraAnalysisEnded === true,
            });
            activeCaseSummary.requestCount = requestCount;
            activeCaseSummary.paths = paths;
            activeCaseSummary.status = status;
            activeCaseSummary.transport = {
                runtimeOrigin:
                    typeof evidence.runtimeOrigin === 'string' ? evidence.runtimeOrigin : null,
                runtimeDocumentBaseOrigin:
                    typeof evidence.runtimeDocumentBaseOrigin === 'string'
                        ? evidence.runtimeDocumentBaseOrigin
                        : null,
                handlerCount: Number.isInteger(evidence.handlerCount)
                    ? evidence.handlerCount
                    : null,
                preInvocation: {
                    lastMessageIsAssistant: evidence.preInvocation?.lastMessageIsAssistant === true,
                    lastMessageHasStatusPlaceholder:
                        evidence.preInvocation?.lastMessageHasStatusPlaceholder === true,
                    sourceIsPi: evidence.preInvocation?.sourceIsPi === true,
                    providerMatched: evidence.preInvocation?.providerMatched === true,
                    apiMatched: evidence.preInvocation?.apiMatched === true,
                    endpointMatched: evidence.preInvocation?.endpointMatched === true,
                    modelMatched: evidence.preInvocation?.modelMatched === true,
                    customHeadersExact: evidence.preInvocation?.customHeadersExact === true,
                    placeholderCredentialMatched:
                        evidence.preInvocation?.placeholderCredentialMatched === true,
                    extraAnalysisIdle: evidence.preInvocation?.extraAnalysisIdle === true,
                },
                requestHeaderNames: Array.isArray(evidence.requestHeaderNames)
                    ? evidence.requestHeaderNames.filter(
                          name => typeof name === 'string' && /^[a-z0-9-]+$/.test(name)
                      )
                    : [],
                requestMethod: [
                    'DELETE',
                    'GET',
                    'HEAD',
                    'OPTIONS',
                    'PATCH',
                    'POST',
                    'PUT',
                    'OTHER',
                ].includes(evidence.requestMethod)
                    ? evidence.requestMethod
                    : null,
                requestInitKeys: Array.isArray(evidence.requestInitKeys)
                    ? evidence.requestInitKeys.filter(
                          name => typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(name)
                      )
                    : [],
                requestBodyKind: [
                    'none',
                    'string',
                    'readable-stream',
                    'blob',
                    'form-data',
                    'url-search-params',
                    'other',
                ].includes(evidence.requestBodyKind)
                    ? evidence.requestBodyKind
                    : null,
                requestBodySizeBucket: ['<1KiB', '1-15KiB', '>=16KiB'].includes(
                    evidence.requestBodySizeBucket
                )
                    ? evidence.requestBodySizeBucket
                    : null,
                requestMode: ['cors', 'navigate', 'no-cors', 'same-origin'].includes(
                    evidence.requestMode
                )
                    ? evidence.requestMode
                    : null,
                requestCredentials: ['include', 'omit', 'same-origin'].includes(
                    evidence.requestCredentials
                )
                    ? evidence.requestCredentials
                    : null,
                requestCache: [
                    'default',
                    'force-cache',
                    'no-cache',
                    'no-store',
                    'only-if-cached',
                    'reload',
                ].includes(evidence.requestCache)
                    ? evidence.requestCache
                    : null,
                requestRedirect: ['error', 'follow', 'manual'].includes(evidence.requestRedirect)
                    ? evidence.requestRedirect
                    : null,
                requestKeepalive: evidence.requestKeepalive === true,
                requestDuplexPresent: evidence.requestDuplexPresent === true,
                invocationSettled: evidence.invocation?.settled === true,
                invocationRejected: evidence.invocation?.rejected === true,
                invocationErrorName:
                    typeof evidence.invocation?.errorName === 'string'
                        ? evidence.invocation.errorName
                        : null,
                invocationErrorCode:
                    typeof evidence.invocation?.errorCode === 'string'
                        ? evidence.invocation.errorCode
                        : null,
                fetchErrorName:
                    typeof evidence.fetchErrorName === 'string' ? evidence.fetchErrorName : null,
                fetchErrorIsTypeError: evidence.fetchErrorIsTypeError === true,
                fetchErrorIsDomException: evidence.fetchErrorIsDomException === true,
                signalAbortedAtReject: evidence.signalAbortedAtReject === true,
                fetchElapsedBucket: ['<100ms', '100-999ms', '>=1000ms'].includes(
                    evidence.fetchElapsedBucket
                )
                    ? evidence.fetchElapsedBucket
                    : null,
                resourceTimingEntrySeen: evidence.resourceTimingEntrySeen === true,
                resourceTimingResponseStatus:
                    Number.isInteger(evidence.resourceTimingResponseStatus) &&
                    evidence.resourceTimingResponseStatus >= 0 &&
                    evidence.resourceTimingResponseStatus <= 599
                        ? evidence.resourceTimingResponseStatus
                        : null,
                responseContentType: [
                    'application/json',
                    'application/problem+json',
                    'text/event-stream',
                    'text/plain',
                    'other',
                ].includes(evidence.responseContentType)
                    ? evidence.responseContentType
                    : null,
                wireBodySizeBucket: ['<1KiB', '1-15KiB', '>=16KiB'].includes(
                    evidence.wireBodySizeBucket
                )
                    ? evidence.wireBodySizeBucket
                    : null,
                wireFormat: ['sse', 'json', 'other', 'empty'].includes(evidence.wireFormat)
                    ? evidence.wireFormat
                    : null,
                wireEventTypes: Array.isArray(evidence.wireEventTypes)
                    ? evidence.wireEventTypes.filter(
                          eventType =>
                              typeof eventType === 'string' && /^[a-z][a-z0-9._-]+$/.test(eventType)
                      )
                    : [],
                wireCompletedSeen: evidence.wireCompletedSeen === true,
                wireFailedSeen: evidence.wireFailedSeen === true,
                wireIncompleteReason: ['content_filter', 'max_output_tokens', 'other'].includes(
                    evidence.wireIncompleteReason
                )
                    ? evidence.wireIncompleteReason
                    : null,
                wireOutputTextSeen: evidence.wireOutputTextSeen === true,
                wireMarkerSeen: evidence.wireMarkerSeen === true,
                wireDoneSeen: evidence.wireDoneSeen === true,
                wireBodyReadError: evidence.wireBodyReadError === true,
                wireBodyTruncatedForTelemetry: evidence.wireBodyTruncatedForTelemetry === true,
                bidiNetwork: bidiNetworkRecorder.snapshot(activeCaseBidiMark),
            };
            activeCaseSummary.ok = Object.values(activeCaseSummary.checks).every(
                check => check === true
            );

            if (evidence.rateLimited) {
                for (const skipped of selectedCases.slice(caseIndex + 1)) {
                    summaries.push({
                        name: skipped.name,
                        ok: false,
                        requestCount: 0,
                        paths: [],
                        status: null,
                        checks: { attempted: false },
                        skipped: 'upstream-rate-limit',
                    });
                }
                break;
            }
            assertSmoke(activeCaseSummary.ok, 'case-check-failed-' + testCase.name);
            failureDiagnostics = undefined;
            activeCaseSummary = undefined;
            activeCaseBidiMark = 0;
        }

        phase = 'scrub-browser-memory';
        const scrubbed = await driver.executeAsync(
            safeAsyncBrowserScript(scrubCredentialAndUnload),
            [{ scriptName: SCRIPT_NAME, injectionId: INJECTION_ID }],
            30_000
        );
        assertSmoke(
            scrubbed?.ok &&
                scrubbed.value?.credentialFieldEmpty &&
                scrubbed.value?.extensionCredentialEmpty &&
                scrubbed.value?.artifactIframeRemoved &&
                scrubbed.value?.saveSettingsRestored &&
                scrubbed.value?.abortStateCleaned,
            'browser-credential-scrub-failed'
        );
        browserScrubbed = true;

        assertSmoke(sha256(await readFile(artifactPath)) === artifactHash, 'artifact-hash-changed');
        assertSmoke(artifact.getRejectedCount() === 0, 'artifact-server-rejected-request');
        if (!INSTALL_ONLY && !CONNECTIVITY_ONLY) {
            assertSmoke(summaries.length === selectedCases.length, 'live-matrix-incomplete');
            assertSmoke(!summaries.some(summary => summary.status === 429), 'upstream-rate-limit');
            assertSmoke(
                summaries.every(summary => summary.ok),
                'live-matrix-failed'
            );
        }
        output = {
            ok: true,
            installOnly: INSTALL_ONLY,
            connectivityOnly: CONNECTIVITY_ONLY,
            requestedCase: REQUESTED_CASE || null,
            versions: {
                sillyTavern: sillyTavernVersion,
                tavernHelper: tavernHelperVersion,
                firefox: browserVersion,
            },
            artifact: {
                requests: artifact.getRequestCount(),
                hashStable: true,
                servedOnlyBundle: artifact.getRejectedCount() === 0,
            },
            matrix: summaries,
            connectivity: connectivitySummary ?? null,
            wirePreflight: wirePreflightSummary ?? null,
            security: {
                credentialPassedOnlyAfterArtifactLoad: !INSTALL_ONLY && !CONNECTIVITY_ONLY,
                credentialInjectedOnlyAtTransport: !INSTALL_ONLY && !CONNECTIVITY_ONLY,
                saveSettingsDisabledWhileCredentialPresent: !INSTALL_ONLY && !CONNECTIVITY_ONLY,
                browserMemoryScrubbed: true,
                firefoxProfileTemporary: true,
                isolatedDataRoot: true,
                childEnvironmentOmitsHome: true,
                rejectedEmbeddedScripts: popupEvidence.rejectedScripts,
            },
        };
    } catch (error) {
        attachBidiNetworkSnapshot(activeCaseSummary, bidiNetworkRecorder, activeCaseBidiMark);
        failure = error;
        failurePhase = phase;
        failureDiagnostics ??= activeCaseSummary;
    } finally {
        attachBidiNetworkSnapshot(activeCaseSummary, bidiNetworkRecorder, activeCaseBidiMark);
        if (sessionId && driver && !browserScrubbed) {
            const scrubbed = await driver
                .executeAsync(
                    safeAsyncBrowserScript(scrubCredentialAndUnload),
                    [{ scriptName: SCRIPT_NAME, injectionId: INJECTION_ID }],
                    30_000
                )
                .catch(() => null);
            browserScrubbed = Boolean(
                scrubbed?.ok &&
                    scrubbed.value?.credentialFieldEmpty &&
                    scrubbed.value?.extensionCredentialEmpty &&
                    scrubbed.value?.artifactIframeRemoved &&
                    scrubbed.value?.saveSettingsRestored &&
                    scrubbed.value?.abortStateCleaned
            );
        }
        attachBidiNetworkSnapshot(activeCaseSummary, bidiNetworkRecorder, activeCaseBidiMark);
        await bidiNetworkRecorder.close().catch(() => undefined);
        if (sessionId && driver) {
            try {
                await driver.deleteSession();
            } catch {
                cleanup = false;
            }
            sessionId = undefined;
        }
        cleanup = (await closeServer(artifactServer).catch(() => false)) && cleanup;
        cleanup = (await stopProcess(geckoProcess).catch(() => false)) && cleanup;
        cleanup = (await stopProcess(stProcess).catch(() => false)) && cleanup;
        const persistenceNeedles = [
            ...(credential ? [{ kind: 'credential', bytes: Buffer.from(credential) }] : []),
            {
                kind: 'ui-placeholder',
                bytes: Buffer.from(BROWSER_CREDENTIAL_PLACEHOLDER),
            },
            {
                kind: 'wire-placeholder',
                bytes: Buffer.from(WIRE_PREFLIGHT_CREDENTIAL),
            },
        ];
        const persistenceRoots = [
            { root: runRoot, kind: 'run-root' },
            ...(profile?.separate ? [{ root: profile.profileRoot, kind: 'firefox-profile' }] : []),
        ].filter(entry => Boolean(entry.root));
        const persistenceChecks = await Promise.all(
            persistenceRoots.map(entry =>
                findPersistenceMatches(entry.root, entry.kind, persistenceNeedles).catch(() => [
                    {
                        kind: 'scan-error',
                        root: entry.kind,
                        relativePath: 'unavailable',
                        sizeBucket: null,
                    },
                ])
            )
        );
        persistenceDiagnostics = persistenceChecks.flat();
        credentialPersisted = persistenceDiagnostics.some(
            diagnostic => diagnostic.kind === 'credential' || diagnostic.kind === 'scan-error'
        );
        cleanup = (await removeProfileRoot(profile).catch(() => false)) && cleanup;
        cleanup = (await removeRunRoot(runRoot).catch(() => false)) && cleanup;
        credential = undefined;
    }

    if (credentialPersisted && !failure) {
        failure = new SmokeError('credential-persisted-to-temporary-storage');
        failurePhase = 'security-audit';
    }
    if (!cleanup && !failure) {
        failure = new SmokeError('cleanup-failed');
        failurePhase = 'cleanup';
    }
    if (failure) {
        process.stdout.write(
            JSON.stringify(
                {
                    ok: false,
                    phase: failurePhase,
                    code: failure instanceof SmokeError ? failure.code : 'unexpected-error',
                    credentialPersisted,
                    persistenceDiagnostics,
                    browserMemoryScrubbed: browserScrubbed,
                    cleanup,
                    diagnostics: failureDiagnostics,
                    matrix: summaries,
                },
                null,
                2
            ) + '\n'
        );
        process.exitCode = 1;
        return;
    }

    output.security.credentialPersisted = credentialPersisted;
    output.security.persistenceDiagnostics = persistenceDiagnostics;
    output.security.cleanup = cleanup;
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

await main();
