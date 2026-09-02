import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const slashRunnerManifest = path.join(
    'public',
    'scripts',
    'extensions',
    'third-party',
    'JS-Slash-Runner',
    'manifest.json'
);

const FEATURE_SMOKE_MODE = process.env.MVU_PI_ST_FEATURE_SMOKE === '1';
const SERVER_CANCEL_SMOKE_MODE = process.env.MVU_PI_ST_SERVER_CANCEL_SMOKE === '1';
const OAUTH_SMOKE_MODE = process.env.MVU_PI_ST_OAUTH_SMOKE === '1';
const TEMP_PREFIX = OAUTH_SMOKE_MODE
    ? 'mvu-pi-st-oauth-'
    : SERVER_CANCEL_SMOKE_MODE
      ? 'mvu-pi-st-server-cancel-'
      : FEATURE_SMOKE_MODE
        ? 'mvu-pi-st-features-'
        : 'mvu-pi-st-capture-';
const FIREFOX_PROFILE_PREFIX = OAUTH_SMOKE_MODE
    ? 'mvu-pi-st-oauth-profile-'
    : SERVER_CANCEL_SMOKE_MODE
      ? 'mvu-pi-st-server-cancel-profile-'
      : FEATURE_SMOKE_MODE
        ? 'mvu-pi-st-features-profile-'
        : 'mvu-pi-st-profile-';
const SCRIPT_NAME = OAUTH_SMOKE_MODE ? 'MVU Pi OAuth Smoke' : 'MVU Pi Capture Smoke';
const SCRIPT_ID = OAUTH_SMOKE_MODE
    ? '00000000-0000-4000-8000-000000000045'
    : '00000000-0000-4000-8000-000000000042';
const WORLD_MARKER = 'MVU_SMOKE_WORLD_CONTEXT';
const USER_MARKER = 'MVU_SMOKE_USER_HISTORY';
const ASSISTANT_MARKER = 'MVU_SMOKE_ASSISTANT_HISTORY';
const PROVIDER_ENDPOINT_SENTINEL = 'mvu-smoke-provider-endpoint-never-send';
const PROVIDER_KEY_SENTINEL = 'mvu-smoke-provider-key-never-send';
const PROVIDER_MODEL_SENTINEL = 'mvu-smoke-provider-model-never-send';
const CAPTURE_ENDPOINT = 'https://mvu-pi-prompt-capture.invalid/v1/chat/completions';
const CAPTURE_MODEL_PREFIX = 'mvu-pi-prompt-capture:';
const SETTINGS_READY_EVENT = 'chat_completion_settings_ready';
const LISTENER_MISS_TIMEOUT_MS = 10_000;

class SmokeError extends Error {
    constructor(code) {
        super(code);
        this.name = 'SmokeError';
        this.code = code;
    }
}

function assertSmoke(value, code) {
    if (!value) {
        throw new SmokeError(code);
    }
}

function exists(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

function resolveSillyTavernRoot() {
    const candidates = [
        process.env.MVU_ST_ROOT,
        path.resolve(workspaceRoot, '../SillyTavern2'),
        path.join(os.homedir(), 'silly', 'SillyTavern2'),
    ].filter(Boolean);

    return candidates.find(
        candidate =>
            exists(path.join(candidate, 'server.js')) &&
            exists(path.join(candidate, slashRunnerManifest))
    );
}

function resolveGeckodriverExecutable() {
    const candidates = [
        process.env.MVU_GECKODRIVER,
        '/snap/firefox/current/usr/lib/firefox/geckodriver',
    ].filter(Boolean);
    return candidates.find(candidate => exists(candidate)) ?? 'geckodriver';
}

function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

async function getUnusedLoopbackPort() {
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

function makeChildEnvironment(runRoot) {
    const environment = {
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        NODE_ENV: 'test',
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        TMPDIR: runRoot,
        TZ: 'UTC',
        XDG_CACHE_HOME: path.join(runRoot, 'cache'),
        XDG_CONFIG_HOME: path.join(runRoot, 'config'),
        XDG_DATA_HOME: path.join(runRoot, 'share'),
        XDG_RUNTIME_DIR: path.join(runRoot, 'runtime'),
    };
    if (process.env.SNAP) {
        environment.SNAP = process.env.SNAP;
    }
    return environment;
}

async function createFirefoxProfileRoot(geckodriverExecutable, runRoot) {
    const snapCommon = path.join(os.homedir(), 'snap', 'firefox', 'common');
    const usesSnapFirefox =
        path.isAbsolute(geckodriverExecutable) &&
        geckodriverExecutable.startsWith('/snap/firefox/');
    if (usesSnapFirefox && fs.existsSync(snapCommon)) {
        const profileRoot = await mkdtemp(path.join(snapCommon, FIREFOX_PROFILE_PREFIX));
        await chmod(profileRoot, 0o700);
        return { profileRoot, separateCleanup: true, allowedParent: snapCommon };
    }

    const profileRoot = path.join(runRoot, 'profiles');
    await mkdir(profileRoot, { recursive: true, mode: 0o700 });
    return { profileRoot, separateCleanup: false, allowedParent: runRoot };
}

function startManagedProcess(command, args, options) {
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

async function stopManagedProcess(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
        return true;
    }
    const signalProcess = signal => {
        try {
            if (process.platform === 'win32') {
                child.kill(signal);
            } else {
                process.kill(-child.pid, signal);
            }
        } catch {
            // The process may have exited between the state check and signal delivery.
        }
    };

    signalProcess('SIGTERM');
    const exited = await Promise.race([
        child.exitResult.then(() => true),
        delay(5_000).then(() => false),
    ]);
    if (exited) {
        return true;
    }
    signalProcess('SIGKILL');
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
            if (await validator(response)) {
                return;
            }
        } catch {
            // Readiness polling intentionally ignores connection failures until the deadline.
        }
        await delay(150);
    }
    throw new SmokeError('http-readiness-timeout');
}

function startArtifactServer(artifactBytes) {
    let bundleRequests = 0;
    const server = http.createServer((request, response) => {
        let pathname = '';
        try {
            pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
        } catch {
            response.writeHead(400).end();
            return;
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.setHeader('Allow', 'GET, HEAD');
            response.writeHead(405).end();
            return;
        }
        if (pathname !== '/bundle.js') {
            response.writeHead(404).end();
            return;
        }

        bundleRequests += 1;
        response.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
            'Content-Length': artifactBytes.length,
            'Content-Type': 'text/javascript; charset=utf-8',
            'Cross-Origin-Resource-Policy': 'cross-origin',
        });
        if (request.method === 'HEAD') {
            response.end();
        } else {
            response.end(artifactBytes);
        }
    });

    return {
        server,
        getBundleRequests: () => bundleRequests,
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
    if (!server?.listening) {
        return true;
    }
    return new Promise(resolve => {
        server.closeAllConnections?.();
        server.close(error => resolve(!error));
    });
}

function createWebDriver(driverBaseUrl, getSessionId) {
    async function request(method, commandPath, body, timeoutMs = 30_000) {
        const response = await fetch(`${driverBaseUrl}${commandPath}`, {
            method,
            headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        }).catch(() => {
            throw new SmokeError('webdriver-transport-failed');
        });
        const envelope = await response.json().catch(() => {
            throw new SmokeError('webdriver-invalid-json');
        });
        if (!response.ok || envelope?.value?.error) {
            throw new SmokeError(`webdriver-${envelope?.value?.error ?? response.status}`);
        }
        return envelope.value;
    }

    const sessionPath = command => {
        const sessionId = getSessionId();
        assertSmoke(typeof sessionId === 'string' && sessionId.length > 0, 'webdriver-no-session');
        return `/session/${encodeURIComponent(sessionId)}${command}`;
    };

    return {
        request,
        async createSession() {
            return request(
                'POST',
                '/session',
                {
                    capabilities: {
                        alwaysMatch: {
                            acceptInsecureCerts: true,
                            browserName: 'firefox',
                            'moz:firefoxOptions': {
                                args: ['-headless', '--width=1280', '--height=900'],
                                prefs: {
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
            );
        },
        async deleteSession() {
            return request('DELETE', sessionPath(''), undefined, 20_000);
        },
        async setTimeouts() {
            return request('POST', sessionPath('/timeouts'), {
                implicit: 0,
                pageLoad: 60_000,
                script: 90_000,
            });
        },
        async navigate(url) {
            return request('POST', sessionPath('/url'), { url }, 70_000);
        },
        async execute(script, args = [], timeoutMs = 30_000) {
            return request('POST', sessionPath('/execute/sync'), { script, args }, timeoutMs);
        },
        async executeAsync(script, args = [], timeoutMs = 100_000) {
            return request('POST', sessionPath('/execute/async'), { script, args }, timeoutMs);
        },
        async findElement(selector) {
            return request('POST', sessionPath('/element'), {
                using: 'css selector',
                value: selector,
            });
        },
        async setFileInput(elementId, filePath) {
            return request('POST', sessionPath(`/element/${encodeURIComponent(elementId)}/value`), {
                text: filePath,
                value: [...filePath],
            });
        },
    };
}

async function waitForBrowser(webDriver, script, args = [], timeoutMs = 40_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            if (await webDriver.execute(script, args, 10_000)) {
                return;
            }
        } catch {
            // Navigation can temporarily invalidate the current document.
        }
        await delay(200);
    }
    throw new SmokeError('browser-readiness-timeout');
}

async function clickVisiblePopup(webDriver, mode = 'auto') {
    return webDriver.execute(
        `
            const mode = arguments[0];
            const dialogs = [...document.querySelectorAll('dialog.popup')].filter(dialog =>
                dialog.open && dialog.getClientRects().length > 0
            );
            const dialog = dialogs.at(-1);
            if (!dialog) return { handled: false, accepted: false, rejectedScript: false };

            const text = (dialog.textContent || '').toLowerCase();
            const isScript = /script|\u811a\u672c/.test(text);
            const shouldCancel = mode === 'cancel' || (mode === 'auto' && isScript);
            const input = dialog.querySelector('.popup-input');
            if (input && !shouldCancel) {
                input.value = 'MVU Smoke User';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const selector = shouldCancel
                ? '.popup-button-cancel, .popup-button-close'
                : '.popup-button-ok';
            const button = dialog.querySelector(selector);
            if (!button) return { handled: false, accepted: false, rejectedScript: false };
            button.click();
            return { handled: true, accepted: !shouldCancel, rejectedScript: isScript && shouldCancel };
        `,
        [mode]
    );
}

async function settlePopups(webDriver, timeoutMs = 25_000) {
    const deadline = Date.now() + timeoutMs;
    let stableRounds = 0;
    let accepted = 0;
    let rejectedScripts = 0;
    while (Date.now() < deadline) {
        const result = await clickVisiblePopup(webDriver, 'auto');
        if (result?.handled) {
            accepted += Number(result.accepted);
            rejectedScripts += Number(result.rejectedScript);
            stableRounds = 0;
            await delay(250);
            continue;
        }
        stableRounds += 1;
        if (stableRounds >= 5) {
            return { accepted, rejectedScripts };
        }
        await delay(200);
    }
    throw new SmokeError('popup-settle-timeout');
}

function extractElementId(element) {
    return element?.['element-6066-11e4-a52e-4f735466cecf'] ?? element?.ELEMENT;
}

async function prepareTemporaryConfig(stRoot, configPath, dataRoot) {
    const defaultConfigPath = path.join(stRoot, 'default', 'config.yaml');
    assertSmoke(exists(defaultConfigPath), 'st-default-config-missing');
    const configuration = YAML.parse(await readFile(defaultConfigPath, 'utf8'));
    configuration.dataRoot = dataRoot;
    configuration.listen = false;
    configuration.listenAddress = { ipv4: '127.0.0.1', ipv6: '[::1]' };
    configuration.protocol = { ipv4: true, ipv6: false };
    configuration.browserLaunch = { ...(configuration.browserLaunch ?? {}), enabled: false };
    configuration.disableCsrfProtection = true;
    configuration.enableCorsProxy = false;
    configuration.requestProxy = { enabled: false, url: '', bypass: [] };
    configuration.extensions = {
        ...(configuration.extensions ?? {}),
        autoUpdate: false,
        models: { ...(configuration.extensions?.models ?? {}), autoDownload: false },
    };
    configuration.enableDownloadableTokenizers = false;
    configuration.enableServerPlugins = false;
    configuration.enableServerPluginsAutoUpdate = false;
    configuration.skipContentCheck = true;
    await writeFile(configPath, YAML.stringify(configuration), { mode: 0o600 });
    await chmod(configPath, 0o600);
}

async function removeRunRoot(runRoot) {
    if (!runRoot) {
        return true;
    }
    const temporaryDirectory = path.resolve(os.tmpdir());
    const resolved = path.resolve(runRoot);
    assertSmoke(
        path.dirname(resolved) === temporaryDirectory &&
            path.basename(resolved).startsWith(TEMP_PREFIX),
        'unsafe-temp-cleanup-target'
    );
    await rm(resolved, { recursive: true, force: true });
    return !fs.existsSync(resolved);
}

async function removeFirefoxProfileRoot(profile) {
    if (!profile?.separateCleanup) {
        return true;
    }
    const resolved = path.resolve(profile.profileRoot);
    assertSmoke(
        path.dirname(resolved) === path.resolve(profile.allowedParent) &&
            path.basename(resolved).startsWith(FIREFOX_PROFILE_PREFIX),
        'unsafe-profile-cleanup-target'
    );
    await rm(resolved, { recursive: true, force: true });
    return !fs.existsSync(resolved);
}

async function main() {
    let phase = 'preflight';
    let runRoot;
    let stProcess;
    let geckoProcess;
    let firefoxProfileRootState;
    let artifactServer;
    let webDriver;
    let sessionId;
    let cleanupOk = true;
    let runError;
    let failurePhase;
    let result;
    let interrupted = false;

    const signalHandler = () => {
        interrupted = true;
    };
    process.once('SIGINT', signalHandler);
    process.once('SIGTERM', signalHandler);

    try {
        const stRoot = resolveSillyTavernRoot();
        assertSmoke(stRoot, 'st-root-not-found');
        assertSmoke(exists(artifactPath), 'artifact-missing');
        assertSmoke(exists(characterCardPath), 'character-card-missing');

        const artifactBytes = await readFile(artifactPath);
        const artifactHashBefore = sha256(artifactBytes);
        runRoot = await mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
        await chmod(runRoot, 0o700);
        const dataRoot = path.join(runRoot, 'data');
        const configPath = path.join(runRoot, 'config.yaml');
        await Promise.all([
            mkdir(dataRoot, { recursive: true, mode: 0o700 }),
            mkdir(path.join(runRoot, 'runtime'), { recursive: true, mode: 0o700 }),
        ]);
        await prepareTemporaryConfig(stRoot, configPath, dataRoot);

        const childEnvironment = makeChildEnvironment(runRoot);
        const geckodriverExecutable = resolveGeckodriverExecutable();
        firefoxProfileRootState = await createFirefoxProfileRoot(geckodriverExecutable, runRoot);
        const profileRoot = firefoxProfileRootState.profileRoot;
        await Promise.all([
            mkdir(path.join(profileRoot, 'cache'), { recursive: true, mode: 0o700 }),
            mkdir(path.join(profileRoot, 'config'), { recursive: true, mode: 0o700 }),
            mkdir(path.join(profileRoot, 'share'), { recursive: true, mode: 0o700 }),
            mkdir(path.join(profileRoot, 'runtime'), { recursive: true, mode: 0o700 }),
        ]);
        const firefoxEnvironment = makeChildEnvironment(profileRoot);
        const stPort = await getUnusedLoopbackPort();
        const geckoPort = await getUnusedLoopbackPort();

        const artifact = startArtifactServer(artifactBytes);
        artifactServer = artifact.server;
        const artifactPort = await listenLoopback(artifactServer);

        phase = 'start-sillytavern';
        stProcess = startManagedProcess(
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
            { cwd: stRoot, env: childEnvironment }
        );
        const stUrl = `http://127.0.0.1:${stPort}`;
        await waitForHttp(stUrl, stProcess, 45_000);

        phase = 'start-webdriver';
        geckoProcess = startManagedProcess(
            geckodriverExecutable,
            [
                '--host',
                '127.0.0.1',
                '--allow-hosts',
                '127.0.0.1',
                '--port',
                String(geckoPort),
                '--profile-root',
                profileRoot,
                '--log',
                'error',
            ],
            { cwd: profileRoot, env: firefoxEnvironment }
        );
        const driverBaseUrl = `http://127.0.0.1:${geckoPort}`;
        await waitForHttp(
            `${driverBaseUrl}/status`,
            geckoProcess,
            30_000,
            async response => response.ok && (await response.json())?.value?.ready === true
        );

        webDriver = createWebDriver(driverBaseUrl, () => sessionId);
        const createdSession = await webDriver.createSession();
        sessionId = createdSession?.sessionId;
        assertSmoke(typeof sessionId === 'string' && sessionId.length > 0, 'session-create-failed');
        const createdFirefoxProfilePath = createdSession?.capabilities?.['moz:profile'];
        const profileTemporary =
            typeof createdFirefoxProfilePath === 'string' &&
            path
                .resolve(createdFirefoxProfilePath)
                .startsWith(`${path.resolve(profileRoot)}${path.sep}`);
        assertSmoke(profileTemporary, 'firefox-profile-not-temporary');
        await webDriver.setTimeouts();

        phase = 'initialize-sillytavern';
        await webDriver.navigate(stUrl);
        await waitForBrowser(
            webDriver,
            `return document.readyState === 'complete' && !!document.body;`,
            [],
            30_000
        );
        const resetResult = await webDriver.executeAsync(`
            const done = arguments[arguments.length - 1];
            fetch('/api/users/reset-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: '' }),
            }).then(response => done({ ok: response.status === 204 || response.ok }))
              .catch(() => done({ ok: false }));
        `);
        assertSmoke(resetResult?.ok, 'settings-reset-failed');
        await webDriver.navigate(stUrl);
        await waitForBrowser(webDriver, `return document.readyState === 'complete';`, [], 30_000);

        for (let index = 0; index < 8; index += 1) {
            const popup = await clickVisiblePopup(webDriver, 'accept');
            if (!popup?.handled) break;
            await delay(300);
        }
        await waitForBrowser(
            webDriver,
            `return !!window.SillyTavern && !!window.TavernHelper &&
                typeof window.TavernHelper.replaceScriptTrees === 'function';`,
            [],
            45_000
        );

        phase = 'import-character';
        const fileInput = await webDriver.findElement('#character_import_file');
        const fileInputId = extractElementId(fileInput);
        assertSmoke(fileInputId, 'character-file-input-missing');
        await webDriver.setFileInput(fileInputId, characterCardPath);
        await waitForBrowser(
            webDriver,
            `return (window.SillyTavern?.getContext?.().characters?.length ?? 0) > 0;`,
            [],
            45_000
        );
        const character = await webDriver.execute(`
            const context = window.SillyTavern.getContext();
            const index = context.characters.findIndex(character =>
                String(character?.name ?? '').includes('\u9752\u7a7a')
            );
            return { found: index >= 0, index, count: context.characters.length };
        `);
        assertSmoke(character?.found, 'imported-character-not-found');
        await webDriver.execute(
            `
                const index = arguments[0];
                const context = window.SillyTavern.getContext();
                window.__mvuCharacterSelection = { settled: false };
                Promise.resolve(context.selectCharacterById(index))
                    .then(() => { window.__mvuCharacterSelection.settled = true; })
                    .catch(() => { window.__mvuCharacterSelection.settled = true; });
                return true;
            `,
            [character.index]
        );
        const popupCounts = await settlePopups(webDriver, 35_000);
        await waitForBrowser(
            webDriver,
            `
                const context = window.SillyTavern?.getContext?.();
                return !!context && context.characterId !== undefined && context.characterId !== null;
            `,
            [],
            35_000
        );

        phase = 'prepare-worldbook';
        const worldbook = await webDriver.executeAsync(
            `
            const done = arguments[arguments.length - 1];
            (async () => {
                const helper = window.TavernHelper;
                for (const type of ['character', 'preset', 'global']) {
                    helper.replaceScriptTrees([], { type });
                }
                await Promise.all([
                    helper.replaceTavernRegexes([], { type: 'character' }),
                    helper.replaceTavernRegexes([], { type: 'preset' }),
                    helper.replaceTavernRegexes([], { type: 'global' }),
                ]);
                const primary = helper.getCurrentCharPrimaryLorebook();
                if (!primary) return done({ ok: false, stored: false });
                const uid = await helper.createLorebookEntry(primary, {
                    comment: '[mvu_update] Browser smoke world context',
                    enabled: true,
                    type: 'constant',
                    position: 'before_character_definition',
                    order: 1000,
                    probability: 100,
                    content: arguments[0],
                });
                const entries = await helper.getLorebookEntries(primary);
                done({
                    ok: Number.isInteger(uid),
                    stored: entries.some(entry => entry.uid === uid && entry.enabled === true),
                });
            })().catch(() => done({ ok: false, stored: false }));
        `,
            [WORLD_MARKER]
        );
        assertSmoke(worldbook?.ok && worldbook?.stored, 'worldbook-marker-not-stored');

        // saveWorldInfo refreshes SillyTavern's in-memory world-info cache immediately. Keep the
        // selected character and session intact: this smoke validates the request/cancel boundary,
        // while the broader prompt-fixture suite owns worldbook parity as a separate concern.

        phase = 'load-artifact';
        const artifactUrl = `http://127.0.0.1:${artifactPort}/bundle.js?sha=${artifactHashBefore.slice(0, 12)}`;
        // This endpoint is valid enough to pass Pi's static transport preflight, but the capture
        // boundary must prevent any request from ever reaching it.
        const providerEndpoint = `https://${PROVIDER_ENDPOINT_SENTINEL}.invalid/v1`;
        const setup = await webDriver.executeAsync(
            `
                const [artifactUrl, scriptName, scriptId, providerEndpoint, providerKey, providerModel,
                    userMarker, assistantMarker] = arguments;
                const done = arguments[arguments.length - 1];
                (async () => {
                    const context = window.SillyTavern.getContext();
                    const helper = window.TavernHelper;
                    await helper.createChatMessages([
                        { role: 'user', message: userMarker },
                        { role: 'assistant', message: assistantMarker },
                    ], { refresh: 'affected' });

                    context.extensionSettings.mvu_settings = {
                        \u66f4\u65b0\u65b9\u5f0f: '\u989d\u5916\u6a21\u578b\u89e3\u6790',
                        \u989d\u5916\u6a21\u578b\u89e3\u6790\u914d\u7f6e: {
                            \u7834\u9650\u65b9\u6848: '\u4f7f\u7528\u5f53\u524d\u9884\u8bbe',
                            \u5e94\u7b54\u683c\u5f0f: '\u804a\u5929\u6d88\u606f',
                            \u542f\u7528\u81ea\u52a8\u8bf7\u6c42: false,
                            \u8bf7\u6c42\u65b9\u5f0f: '\u4f9d\u6b21\u8bf7\u6c42\uff0c\u5931\u8d25\u540e\u91cd\u8bd5',
                            \u8bf7\u6c42\u6b21\u6570: 1,
                            \u4e16\u754c\u4e66\u6761\u76ee\u767d\u540d\u5355\u6b63\u5219: '',
                            \u4e16\u754c\u4e66\u6761\u76ee\u9ed1\u540d\u5355\u6b63\u5219: '',
                            \u6a21\u578b\u6765\u6e90: '\u66f4\u591a',
                            api\u5730\u5740: '',
                            \u5bc6\u94a5: providerKey,
                            customApiKey: '',
                            \u6a21\u578b\u540d\u79f0: providerModel,
                            pi: {
                                provider: 'openai',
                                api: 'openai-responses',
                                authType: 'api_key',
                                endpoint: providerEndpoint,
                                model: providerModel,
                                contextWindow: 8192,
                                credentials: {},
                                apiKeys: { 'openai:openai-responses': providerKey },
                                customHeaders: '',
                                customIncludeBody: '',
                                customExcludeBody: '',
                            },
                            \u6e29\u5ea6: 1,
                            \u9891\u7387\u60e9\u7f5a: 0,
                            \u5b58\u5728\u60e9\u7f5a: 0,
                            top_p: 1,
                            top_k: 0,
                            max_chat_history: 2,
                            \u6700\u5927\u56de\u590dtoken\u6570: 128,
                            api\u65b9\u6848\u5217\u8868: [],
                            \u5f53\u524dapi\u65b9\u6848: '',
                        },
                    };
                    helper.replaceScriptTrees([{
                        type: 'script',
                        enabled: true,
                        name: scriptName,
                        id: scriptId,
                        content: 'import ' + JSON.stringify(artifactUrl),
                        info: '',
                        button: { enabled: true, buttons: [] },
                        data: {},
                        export_with: { data: false, button: false },
                    }], { type: 'global' });
                    done({ ok: true });
                })().catch(() => done({ ok: false }));
            `,
            [
                artifactUrl,
                SCRIPT_NAME,
                SCRIPT_ID,
                providerEndpoint,
                OAUTH_SMOKE_MODE ? '' : PROVIDER_KEY_SENTINEL,
                PROVIDER_MODEL_SENTINEL,
                USER_MARKER,
                ASSISTANT_MARKER,
            ]
        );
        assertSmoke(setup?.ok, 'artifact-script-install-failed');
        await waitForBrowser(
            webDriver,
            `
                const iframe = [...document.querySelectorAll('iframe')].find(frame =>
                    frame.id.startsWith('TH-script--' + arguments[0])
                );
                return !!window.Mvu && !!iframe?.contentWindow &&
                    typeof iframe.contentWindow.getButtonEvent === 'function';
            `,
            [SCRIPT_NAME],
            60_000
        );
        assertSmoke(artifact.getBundleRequests() >= 1, 'artifact-not-requested');

        if (OAUTH_SMOKE_MODE) {
            phase = 'oauth-ui-smoke';
            const { runPiStOAuthSmoke } = await import('./pi_st_oauth_smoke.mjs');
            result = await runPiStOAuthSmoke({
                webDriver,
                scriptName: SCRIPT_NAME,
                artifactBundleRequests: artifact.getBundleRequests(),
                artifactHashStable: sha256(await readFile(artifactPath)) === artifactHashBefore,
                firefoxProfileTemporary: profileTemporary,
                embeddedScriptsRejected: popupCounts.rejectedScripts,
            });
        } else if (SERVER_CANCEL_SMOKE_MODE) {
            phase = 'server-cancel-smoke';
            const { runPiStServerCancelSmoke } = await import('./pi_st_server_cancel_smoke.mjs');
            result = await runPiStServerCancelSmoke({
                webDriver,
                scriptName: SCRIPT_NAME,
                artifactBundleRequests: artifact.getBundleRequests(),
                artifactHashStable: sha256(await readFile(artifactPath)) === artifactHashBefore,
                firefoxProfileTemporary: profileTemporary,
                embeddedScriptsRejected: popupCounts.rejectedScripts,
            });
        } else if (FEATURE_SMOKE_MODE) {
            phase = 'feature-protocol-smoke';
            const { runPiStFeatureSmoke } = await import('./pi_st_feature_smoke.mjs');
            result = await runPiStFeatureSmoke({
                webDriver,
                scriptName: SCRIPT_NAME,
                artifactBundleRequests: artifact.getBundleRequests(),
                artifactHashStable: sha256(await readFile(artifactPath)) === artifactHashBefore,
                firefoxProfileTemporary: profileTemporary,
                embeddedScriptsRejected: popupCounts.rejectedScripts,
            });
        } else {
            phase = 'observe-capture';
            const observerSetup = await webDriver.execute(
                `
                const [scriptName, providerEndpointSentinel, providerKeySentinel,
                    providerModelSentinel, captureEndpoint, capturePrefix, settingsReadyEvent,
                    userMarker, assistantMarker, worldMarker] = arguments;
                let stage = 'context';
                try {
                const context = window.SillyTavern.getContext();
                const helper = window.TavernHelper;
                stage = 'iframe';
                const iframe = [...document.querySelectorAll('iframe')].find(frame =>
                    frame.id.startsWith('TH-script--' + scriptName)
                );
                if (!iframe?.contentWindow) return { ok: false };
                stage = 'button-event';
                const eventId = iframe.contentWindow.getButtonEvent('\u91cd\u8bd5\u989d\u5916\u6a21\u578b\u89e3\u6790');
                stage = 'handler-list';
                const handlers = context.eventSource?.events?.[eventId];
                if (!Array.isArray(handlers) || handlers.length === 0) return { ok: false };

                stage = 'observation';
                const originalFetch = window.fetch;
                const eventSource = context.eventSource;
                const readyEvent = helper.tavern_events?.CHAT_COMPLETION_SETTINGS_READY || settingsReadyEvent;
                const listenerCountBefore = Array.isArray(eventSource.events?.[readyEvent])
                    ? eventSource.events[readyEvent].length : 0;
                const extensionPromptCountBefore = Object.keys(context.extensionPrompts || {}).length;
                const literalMacro = '{{lastUserMessage}}';
                const observation = {
                    generateFetchCount: 0,
                    settingsReadyMarkerSeen: false,
                    signalPresent: false,
                    signalIsAbortSignal: false,
                    signalAbortedAtFetch: false,
                    bodyWasJson: false,
                    bodyUsesCustomSource: false,
                    bodyUsesInvalidEndpoint: false,
                    bodyHasEmptyKey: false,
                    bodyHasMarkerModel: false,
                    bodyOmitsProviderSentinels: false,
                    nativeFetchRejected: false,
                    nativeFetchRejectedAsAbort: false,
                    messageCount: 0,
                    systemCount: 0,
                    userCount: 0,
                    assistantCount: 0,
                    validRoles: false,
                    adaptableContent: false,
                    characterContextPresent: false,
                    userHistoryPresent: false,
                    assistantHistoryPresent: false,
                    injectionBoundariesPresent: false,
                    taskInstructionPresent: false,
                    worldMarkerPresent: false,
                    macroExpandedDuring: false,
                };

                const readyListener = data => {
                    if (typeof data?.model !== 'string' || !data.model.startsWith(capturePrefix)) return;
                    observation.settingsReadyMarkerSeen = true;
                    const messages = Array.isArray(data.messages) ? data.messages : [];
                    observation.messageCount = messages.length;
                    observation.systemCount = messages.filter(message => message?.role === 'system').length;
                    observation.userCount = messages.filter(message => message?.role === 'user').length;
                    observation.assistantCount = messages.filter(message => message?.role === 'assistant').length;
                    observation.validRoles = messages.every(message =>
                        ['system', 'user', 'assistant', 'tool'].includes(message?.role)
                    );
                    observation.adaptableContent = messages.every(message =>
                        typeof message?.content === 'string' || Array.isArray(message?.content)
                    );
                    const text = messages.map(message => {
                        if (typeof message?.content === 'string') return message.content;
                        if (!Array.isArray(message?.content)) return '';
                        return message.content.map(part => typeof part?.text === 'string' ? part.text : '').join('\\n');
                    }).join('\\n');
                    observation.characterContextPresent = text.includes('\u9752\u7a7a');
                    observation.userHistoryPresent = text.includes(userMarker);
                    observation.assistantHistoryPresent = text.includes(assistantMarker);
                    observation.injectionBoundariesPresent =
                        text.includes('<system_injection source="sillytavern">') &&
                        text.includes('</system_injection>');
                    observation.taskInstructionPresent = text.includes('<must>');
                    observation.worldMarkerPresent = text.includes(worldMarker);
                    observation.macroExpandedDuring = helper.substitudeMacros(literalMacro) !== literalMacro;
                };
                stage = 'ready-listener';
                eventSource.on(readyEvent, readyListener);

                stage = 'fetch-wrapper';
                window.fetch = function(input, init) {
                    const rawUrl = typeof input === 'string'
                        ? input
                        : input instanceof URL
                          ? input.href
                          : input?.url;
                    let pathname = '';
                    try { pathname = new URL(rawUrl, window.location.href).pathname; } catch {}
                    const response = originalFetch.apply(this, arguments);
                    if (pathname !== '/api/backends/chat-completions/generate') return response;

                    observation.generateFetchCount += 1;
                    const signal = init?.signal || input?.signal;
                    observation.signalPresent = !!signal;
                    observation.signalIsAbortSignal = signal instanceof AbortSignal;
                    observation.signalAbortedAtFetch = signal?.aborted === true;
                    const bodyText = typeof init?.body === 'string' ? init.body : '';
                    let body;
                    try {
                        body = JSON.parse(bodyText);
                        observation.bodyWasJson = true;
                    } catch {
                        body = {};
                    }
                    observation.bodyUsesCustomSource = body.chat_completion_source === 'custom';
                    observation.bodyUsesInvalidEndpoint =
                        body.reverse_proxy === captureEndpoint && body.custom_url === captureEndpoint;
                    observation.bodyHasEmptyKey =
                        body.proxy_password === '' &&
                        !/authorization/i.test(JSON.stringify(body.custom_include_headers || {}));
                    observation.bodyHasMarkerModel =
                        typeof body.model === 'string' && body.model.startsWith(capturePrefix);
                    observation.bodyOmitsProviderSentinels =
                        !bodyText.includes(providerEndpointSentinel) &&
                        !bodyText.includes(providerKeySentinel) &&
                        !bodyText.includes(providerModelSentinel);
                    Promise.resolve(response).catch(error => {
                        observation.nativeFetchRejected = true;
                        observation.nativeFetchRejectedAsAbort =
                            signal?.aborted === true || error?.name === 'AbortError';
                    });
                    return response;
                };

                stage = 'store-state';
                window.__mvuCaptureSmoke = {
                    originalFetch,
                    readyEvent,
                    readyListener,
                    listenerCountBefore,
                    extensionPromptCountBefore,
                    literalMacro,
                    observation,
                    handler: handlers[handlers.length - 1],
                };
                return {
                    ok: true,
                    handlerCount: handlers.length,
                    listenerCountBefore,
                    extensionPromptCountBefore,
                };
                } catch {
                    return { ok: false, stage };
                }
            `,
                [
                    SCRIPT_NAME,
                    PROVIDER_ENDPOINT_SENTINEL,
                    PROVIDER_KEY_SENTINEL,
                    PROVIDER_MODEL_SENTINEL,
                    CAPTURE_ENDPOINT,
                    CAPTURE_MODEL_PREFIX,
                    SETTINGS_READY_EVENT,
                    USER_MARKER,
                    ASSISTANT_MARKER,
                    WORLD_MARKER,
                ]
            );
            assertSmoke(
                observerSetup?.ok,
                `capture-observer-setup-failed-${observerSetup?.stage ?? 'unknown'}`
            );
            assertSmoke(observerSetup.handlerCount >= 1, 'retry-handler-missing');

            const invocation = await webDriver.executeAsync(
                `
            const done = arguments[arguments.length - 1];
            const smoke = window.__mvuCaptureSmoke;
            if (!smoke || typeof smoke.handler !== 'function') {
                done({ completed: false, rejected: false });
            } else {
                Promise.race([
                    Promise.resolve().then(() => smoke.handler()).then(
                        () => ({ completed: true, rejected: false }),
                        () => ({ completed: true, rejected: true })
                    ),
                    new Promise(resolve => setTimeout(
                        () => resolve({ completed: false, rejected: false }),
                        60000
                    )),
                ]).then(done);
            }
        `,
                [],
                80_000
            );
            assertSmoke(invocation?.completed, 'retry-handler-timeout');
            await delay(500);

            const evidence = await webDriver.execute(`
            const smoke = window.__mvuCaptureSmoke;
            if (!smoke) return { ok: false };
            const context = window.SillyTavern.getContext();
            const helper = window.TavernHelper;
            const eventSource = context.eventSource;
            eventSource.removeListener(smoke.readyEvent, smoke.readyListener);
            window.fetch = smoke.originalFetch;
            const listenerCountAfter = Array.isArray(eventSource.events?.[smoke.readyEvent])
                ? eventSource.events[smoke.readyEvent].length : 0;
            const extensionPrompts = context.extensionPrompts || {};
            const extensionPromptCountAfter = Object.keys(extensionPrompts).length;
            const markerAbsentFromPrompts = !JSON.stringify(extensionPrompts).includes(
                'mvu-pi-prompt-capture:'
            );
            const noInjectionPrompt = !Object.prototype.hasOwnProperty.call(extensionPrompts, 'INJECTION');
            const macroLiteralAfter = helper.substitudeMacros(smoke.literalMacro) === smoke.literalMacro;
            const fetchRestored = window.fetch === smoke.originalFetch;
            const observation = { ...smoke.observation };
            delete window.__mvuCaptureSmoke;
            return {
                ok: true,
                ...observation,
                listenerCountStable: listenerCountAfter === smoke.listenerCountBefore,
                extensionPromptCountStable:
                    extensionPromptCountAfter === smoke.extensionPromptCountBefore,
                markerAbsentFromPrompts,
                noInjectionPrompt,
                macroLiteralAfter,
                fetchRestored,
                extraAnalysisEnded: window.Mvu?.isDuringExtraAnalysis?.() === false,
            };
        `);
            assertSmoke(evidence?.ok, 'capture-evidence-missing');

            const requiredChecks = {
                capabilityGatePassed: evidence.generateFetchCount >= 1,
                settingsReadyMarkerSeen: evidence.settingsReadyMarkerSeen,
                generateFetchSeen: evidence.generateFetchCount >= 1,
                signalPresent: evidence.signalPresent,
                signalIsAbortSignal: evidence.signalIsAbortSignal,
                signalAbortedAtFetch: evidence.signalAbortedAtFetch,
                bodyWasJson: evidence.bodyWasJson,
                bodyUsesCustomSource: evidence.bodyUsesCustomSource,
                bodyUsesInvalidEndpoint: evidence.bodyUsesInvalidEndpoint,
                bodyHasEmptyKey: evidence.bodyHasEmptyKey,
                bodyHasMarkerModel: evidence.bodyHasMarkerModel,
                bodyOmitsProviderSentinels: evidence.bodyOmitsProviderSentinels,
                nativeFetchRejected: evidence.nativeFetchRejected,
                nativeFetchRejectedAsAbort: evidence.nativeFetchRejectedAsAbort,
                validMessageRoles: evidence.validRoles,
                adaptableMessageContent: evidence.adaptableContent,
                characterContextPresent: evidence.characterContextPresent,
                userHistoryPresent: evidence.userHistoryPresent,
                assistantHistoryPresent: evidence.assistantHistoryPresent,
                taskInstructionPresent: evidence.taskInstructionPresent,
                macroExpandedDuring: evidence.macroExpandedDuring,
                listenerCountStable: evidence.listenerCountStable,
                markerAbsentFromPrompts: evidence.markerAbsentFromPrompts,
                noInjectionPrompt: evidence.noInjectionPrompt,
                macroLiteralAfter: evidence.macroLiteralAfter,
                fetchRestored: evidence.fetchRestored,
                extraAnalysisEnded: evidence.extraAnalysisEnded,
                artifactLoaded: artifact.getBundleRequests() >= 1,
                artifactHashStable: sha256(await readFile(artifactPath)) === artifactHashBefore,
                firefoxProfileTemporary: profileTemporary,
                embeddedScriptsRejected: popupCounts.rejectedScripts >= 1,
            };
            for (const [name, passed] of Object.entries(requiredChecks)) {
                assertSmoke(passed, `assertion-${name}`);
            }

            phase = 'observe-capture-listener-miss';
            const listenerMissSetup = await webDriver.execute(
                `
                const [scriptName, providerEndpointSentinel, providerKeySentinel,
                    providerModelSentinel, captureEndpoint, capturePrefix,
                    settingsReadyEvent] = arguments;
                let stage = 'context';
                try {
                    const context = window.SillyTavern.getContext();
                    const helper = window.TavernHelper;
                    const eventSource = context.eventSource;
                    const readyEvent = helper.tavern_events?.CHAT_COMPLETION_SETTINGS_READY ||
                        settingsReadyEvent;
                    stage = 'iframe';
                    const iframe = [...document.querySelectorAll('iframe')].find(frame =>
                        frame.id.startsWith('TH-script--' + scriptName)
                    );
                    if (!iframe?.contentWindow) return { ok: false, stage };

                    stage = 'observation';
                    const originalFetch = window.fetch;
                    const iframeConsole = iframe.contentWindow.console;
                    const originalIframeConsoleError = iframeConsole.error;
                    const listenerCountBefore = Array.isArray(eventSource.events?.[readyEvent])
                        ? eventSource.events[readyEvent].length : 0;
                    const extensionPromptCountBefore = Object.keys(context.extensionPrompts || {})
                        .length;
                    const literalMacro = '{{lastUserMessage}}';
                    const mismatchModel = 'mvu-smoke-unmatched-capture-model';
                    const observation = {
                        invocationStarted: false,
                        matchingMarkerSeenBeforeRewrite: false,
                        markerRewritten: false,
                        generateFetchCount: 0,
                        requestUsesBackendPath: false,
                        requestUsesPost: false,
                        requestOmitsProviderSentinels: false,
                        providerSentinelUrlFetchCount: 0,
                        captureEndpointBrowserFetchCount: 0,
                        signalPresent: false,
                        signalIsAbortSignal: false,
                        signalAbortedAtFetch: false,
                        bodyWasJson: false,
                        bodyUsesCustomSource: false,
                        bodyUsesInvalidEndpoint: false,
                        bodyEndpointHasInvalidTld: false,
                        bodyHasEmptyKey: false,
                        bodyHasMismatchModel: false,
                        bodyOmitsProviderSentinels: false,
                        nativeFetchSettled: false,
                        nativeFetchRejected: false,
                        nativeResponseWasFailure: false,
                        propagatedConsoleErrors: 0,
                    };

                    const mismatchListener = data => {
                        if (typeof data?.model !== 'string' ||
                            !data.model.startsWith(capturePrefix)) return;
                        observation.matchingMarkerSeenBeforeRewrite = true;
                        data.model = mismatchModel;
                        observation.markerRewritten = data.model === mismatchModel;
                    };
                    stage = 'mismatch-listener';
                    eventSource.on(readyEvent, mismatchListener);

                    stage = 'console-wrapper';
                    iframeConsole.error = function() {
                        if (observation.invocationStarted) {
                            observation.propagatedConsoleErrors += 1;
                        }
                        return originalIframeConsoleError.apply(this, arguments);
                    };

                    stage = 'fetch-wrapper';
                    window.fetch = function(input, init) {
                        const rawUrl = typeof input === 'string'
                            ? input
                            : input instanceof URL
                              ? input.href
                              : input?.url;
                        const urlText = String(rawUrl || '');
                        if ([providerEndpointSentinel, providerKeySentinel,
                            providerModelSentinel].some(sentinel => urlText.includes(sentinel))) {
                            observation.providerSentinelUrlFetchCount += 1;
                        }
                        if (urlText.includes(captureEndpoint)) {
                            observation.captureEndpointBrowserFetchCount += 1;
                        }

                        let pathname = '';
                        try { pathname = new URL(rawUrl, window.location.href).pathname; } catch {}
                        const response = originalFetch.apply(this, arguments);
                        if (pathname !== '/api/backends/chat-completions/generate') return response;

                        observation.generateFetchCount += 1;
                        observation.requestUsesBackendPath = true;
                        observation.requestUsesPost = String(init?.method || 'GET').toUpperCase() ===
                            'POST';
                        observation.requestOmitsProviderSentinels =
                            !urlText.includes(providerEndpointSentinel) &&
                            !urlText.includes(providerKeySentinel) &&
                            !urlText.includes(providerModelSentinel);
                        const signal = init?.signal || input?.signal;
                        observation.signalPresent = !!signal;
                        observation.signalIsAbortSignal = signal instanceof AbortSignal;
                        observation.signalAbortedAtFetch = signal?.aborted === true;
                        const bodyText = typeof init?.body === 'string' ? init.body : '';
                        let body;
                        try {
                            body = JSON.parse(bodyText);
                            observation.bodyWasJson = true;
                        } catch {
                            body = {};
                        }
                        observation.bodyUsesCustomSource = body.chat_completion_source === 'custom';
                        observation.bodyUsesInvalidEndpoint =
                            body.reverse_proxy === captureEndpoint &&
                            body.custom_url === captureEndpoint;
                        try {
                            observation.bodyEndpointHasInvalidTld =
                                new URL(body.reverse_proxy).hostname.endsWith('.invalid') &&
                                new URL(body.custom_url).hostname.endsWith('.invalid');
                        } catch {}
                        observation.bodyHasEmptyKey =
                            body.proxy_password === '' &&
                            !/(authorization|x-api-key)/i.test(
                                JSON.stringify(body.custom_include_headers || {})
                            );
                        observation.bodyHasMismatchModel = body.model === mismatchModel;
                        observation.bodyOmitsProviderSentinels =
                            !bodyText.includes(providerEndpointSentinel) &&
                            !bodyText.includes(providerKeySentinel) &&
                            !bodyText.includes(providerModelSentinel);
                        Promise.resolve(response).then(
                            resolved => {
                                observation.nativeFetchSettled = true;
                                observation.nativeResponseWasFailure = !resolved.ok;
                            },
                            () => {
                                observation.nativeFetchSettled = true;
                                observation.nativeFetchRejected = true;
                            }
                        );
                        return response;
                    };

                    stage = 'store-state';
                    window.__mvuCaptureListenerMissSmoke = {
                        originalFetch,
                        iframeConsole,
                        originalIframeConsoleError,
                        readyEvent,
                        mismatchListener,
                        listenerCountBefore,
                        extensionPromptCountBefore,
                        literalMacro,
                        observation,
                    };
                    return { ok: true, listenerCountBefore, extensionPromptCountBefore };
                } catch {
                    return { ok: false, stage };
                }
            `,
                [
                    SCRIPT_NAME,
                    PROVIDER_ENDPOINT_SENTINEL,
                    PROVIDER_KEY_SENTINEL,
                    PROVIDER_MODEL_SENTINEL,
                    CAPTURE_ENDPOINT,
                    CAPTURE_MODEL_PREFIX,
                    SETTINGS_READY_EVENT,
                ]
            );
            assertSmoke(
                listenerMissSetup?.ok,
                `listener-miss-setup-failed-${listenerMissSetup?.stage ?? 'unknown'}`
            );

            const listenerMissInvocation = await webDriver.executeAsync(
                `
                const timeoutMs = arguments[0];
                const done = arguments[arguments.length - 1];
                const smoke = window.__mvuCaptureListenerMissSmoke;
                const iframe = [...document.querySelectorAll('iframe')].find(frame =>
                    frame.id.startsWith('TH-script--' + arguments[1])
                );
                const eventId = iframe?.contentWindow?.getButtonEvent?.(
                    '\u91cd\u8bd5\u989d\u5916\u6a21\u578b\u89e3\u6790'
                );
                const handlers = window.SillyTavern?.getContext?.().eventSource?.events?.[eventId];
                const handler = Array.isArray(handlers) ? handlers[handlers.length - 1] : undefined;
                if (!smoke || typeof handler !== 'function') {
                    done({ completed: false, rejected: false, elapsedMs: 0 });
                    return;
                }
                smoke.observation.invocationStarted = true;
                const startedAt = performance.now();
                Promise.race([
                    Promise.resolve().then(() => handler()).then(
                        () => ({ completed: true, rejected: false }),
                        () => ({ completed: true, rejected: true })
                    ),
                    new Promise(resolve => setTimeout(
                        () => resolve({ completed: false, rejected: false }),
                        timeoutMs
                    )),
                ]).then(outcome => done({
                    ...outcome,
                    elapsedMs: Math.ceil(performance.now() - startedAt),
                }));
            `,
                [LISTENER_MISS_TIMEOUT_MS, SCRIPT_NAME],
                LISTENER_MISS_TIMEOUT_MS + 10_000
            );
            await delay(250);

            const listenerMissEvidence = await webDriver.execute(`
                const smoke = window.__mvuCaptureListenerMissSmoke;
                if (!smoke) return { ok: false };
                const context = window.SillyTavern.getContext();
                const helper = window.TavernHelper;
                const eventSource = context.eventSource;
                eventSource.removeListener(smoke.readyEvent, smoke.mismatchListener);
                window.fetch = smoke.originalFetch;
                smoke.iframeConsole.error = smoke.originalIframeConsoleError;
                const listenerCountAfter = Array.isArray(eventSource.events?.[smoke.readyEvent])
                    ? eventSource.events[smoke.readyEvent].length : 0;
                const extensionPrompts = context.extensionPrompts || {};
                const extensionPromptCountAfter = Object.keys(extensionPrompts).length;
                const observation = { ...smoke.observation };
                const result = {
                    ok: true,
                    ...observation,
                    listenerCountStable: listenerCountAfter === smoke.listenerCountBefore,
                    extensionPromptCountStable:
                        extensionPromptCountAfter === smoke.extensionPromptCountBefore,
                    markerAbsentFromPrompts: !JSON.stringify(extensionPrompts).includes(
                        'mvu-pi-prompt-capture:'
                    ),
                    noInjectionPrompt:
                        !Object.prototype.hasOwnProperty.call(extensionPrompts, 'INJECTION'),
                    macroLiteralAfter:
                        helper.substitudeMacros(smoke.literalMacro) === smoke.literalMacro,
                    fetchRestored: window.fetch === smoke.originalFetch,
                    consoleRestored:
                        smoke.iframeConsole.error === smoke.originalIframeConsoleError,
                    extraAnalysisEnded: window.Mvu?.isDuringExtraAnalysis?.() === false,
                };
                delete window.__mvuCaptureListenerMissSmoke;
                return result;
            `);
            assertSmoke(listenerMissEvidence?.ok, 'listener-miss-evidence-missing');

            const listenerMissChecks = {
                listenerMissCompleted: listenerMissInvocation?.completed === true,
                listenerMissHandledByRetryStrategy: listenerMissInvocation?.rejected === false,
                listenerMissConvergedWithin10Seconds:
                    Number.isFinite(listenerMissInvocation?.elapsedMs) &&
                    listenerMissInvocation.elapsedMs <= LISTENER_MISS_TIMEOUT_MS,
                matchingMarkerSeenBeforeRewrite:
                    listenerMissEvidence.matchingMarkerSeenBeforeRewrite,
                markerRewritten: listenerMissEvidence.markerRewritten,
                propagatedErrorObserved: listenerMissEvidence.propagatedConsoleErrors >= 1,
                exactlyOneBackendGenerateFetch: listenerMissEvidence.generateFetchCount === 1,
                requestUsesRealStBackendPath: listenerMissEvidence.requestUsesBackendPath,
                requestUsesPost: listenerMissEvidence.requestUsesPost,
                requestOmitsProviderSentinels: listenerMissEvidence.requestOmitsProviderSentinels,
                providerEndpointNeverFetchedByBrowser:
                    listenerMissEvidence.providerSentinelUrlFetchCount === 0,
                captureEndpointNeverFetchedByBrowser:
                    listenerMissEvidence.captureEndpointBrowserFetchCount === 0,
                listenerMissSignalPresent: listenerMissEvidence.signalPresent,
                listenerMissSignalIsAbortSignal: listenerMissEvidence.signalIsAbortSignal,
                listenerMissSignalNotPreAborted: !listenerMissEvidence.signalAbortedAtFetch,
                listenerMissBodyWasJson: listenerMissEvidence.bodyWasJson,
                listenerMissBodyUsesCustomSource: listenerMissEvidence.bodyUsesCustomSource,
                listenerMissBodyUsesFixedInvalidEndpoint:
                    listenerMissEvidence.bodyUsesInvalidEndpoint &&
                    listenerMissEvidence.bodyEndpointHasInvalidTld,
                listenerMissBodyHasEmptyKey: listenerMissEvidence.bodyHasEmptyKey,
                listenerMissBodyHasMismatchedModel: listenerMissEvidence.bodyHasMismatchModel,
                listenerMissBodyOmitsProviderSentinels:
                    listenerMissEvidence.bodyOmitsProviderSentinels,
                backendFailureSettled:
                    listenerMissEvidence.nativeFetchSettled &&
                    (listenerMissEvidence.nativeResponseWasFailure ||
                        listenerMissEvidence.nativeFetchRejected),
                listenerMissListenerCountStable: listenerMissEvidence.listenerCountStable,
                listenerMissMarkerAbsentFromPrompts: listenerMissEvidence.markerAbsentFromPrompts,
                listenerMissNoInjectionPrompt: listenerMissEvidence.noInjectionPrompt,
                listenerMissMacroLiteralAfter: listenerMissEvidence.macroLiteralAfter,
                listenerMissFetchRestored: listenerMissEvidence.fetchRestored,
                listenerMissConsoleRestored: listenerMissEvidence.consoleRestored,
                listenerMissExtraAnalysisEnded: listenerMissEvidence.extraAnalysisEnded,
            };
            for (const [name, passed] of Object.entries(listenerMissChecks)) {
                assertSmoke(passed, `assertion-${name}`);
            }

            result = {
                ok: true,
                counts: {
                    artifactBundleRequests: artifact.getBundleRequests(),
                    backendGenerateFetches: evidence.generateFetchCount,
                    capturedMessages: evidence.messageCount,
                    systemMessages: evidence.systemCount,
                    userMessages: evidence.userCount,
                    assistantMessages: evidence.assistantCount,
                    acceptedImportPrompts: popupCounts.accepted,
                    rejectedEmbeddedScripts: popupCounts.rejectedScripts,
                    listenerMissBackendGenerateFetches: listenerMissEvidence.generateFetchCount,
                    listenerMissElapsedMs: listenerMissInvocation.elapsedMs,
                },
                checks: { ...requiredChecks, ...listenerMissChecks },
                observations: {
                    // Adapter-added late-system boundaries are asserted in toPiContext unit tests;
                    // raw SillyTavern capture messages are not required to contain them.
                    injectionBoundariesPresent: evidence.injectionBoundariesPresent,
                    worldMarkerPresent: evidence.worldMarkerPresent,
                    // Other ST extensions may add/remove unrelated prompts while the request runs;
                    // the exact one-shot INJECTION key is checked separately above.
                    extensionPromptCountStable: evidence.extensionPromptCountStable,
                },
            };
        }
    } catch (error) {
        runError = error;
        failurePhase = phase;
    } finally {
        phase = 'cleanup';
        if (sessionId && webDriver) {
            try {
                await webDriver.deleteSession();
            } catch {
                cleanupOk = false;
            }
            sessionId = undefined;
        }
        cleanupOk = (await closeServer(artifactServer).catch(() => false)) && cleanupOk;
        cleanupOk = (await stopManagedProcess(geckoProcess).catch(() => false)) && cleanupOk;
        cleanupOk = (await stopManagedProcess(stProcess).catch(() => false)) && cleanupOk;
        cleanupOk =
            (await removeFirefoxProfileRoot(firefoxProfileRootState).catch(() => false)) &&
            cleanupOk;
        cleanupOk = (await removeRunRoot(runRoot).catch(() => false)) && cleanupOk;
        process.removeListener('SIGINT', signalHandler);
        process.removeListener('SIGTERM', signalHandler);
    }

    if (interrupted && !runError) {
        runError = new SmokeError('interrupted');
    }
    if (!cleanupOk && !runError) {
        runError = new SmokeError('cleanup-failed');
        failurePhase = 'cleanup';
    }
    if (runError) {
        const code =
            runError instanceof SmokeError || typeof runError?.code === 'string'
                ? runError.code
                : 'unexpected-error';
        process.stdout.write(
            `${JSON.stringify({ ok: false, phase: failurePhase, code, cleanup: cleanupOk }, null, 2)}\n`
        );
        process.exitCode = 1;
        return;
    }

    result.checks.cleanup = cleanupOk;
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

await main();
