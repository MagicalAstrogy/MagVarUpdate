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
const defaultOutputDirectory = path.join(workspaceRoot, 'tests', 'fixtures', 'pi_prompt_capture');
const slashRunnerManifest = path.join(
    'public',
    'scripts',
    'extensions',
    'third-party',
    'JS-Slash-Runner',
    'manifest.json'
);

const TEMP_PREFIX = 'mvu-pi-st-prompt-fixtures-';
const FIREFOX_PROFILE_PREFIX = 'mvu-pi-st-prompt-profile-';
const SCRIPT_NAME = 'MVU Pi B04 Prompt Fixtures';
const SCRIPT_ID = '00000000-0000-4000-8000-000000000043';
const OTHER_PRESET = 'B04 Other Preset';
const SETTINGS_READY_EVENT = 'chat_completion_settings_ready';
const CAPTURE_MODEL_PREFIX = 'mvu-pi-prompt-capture:';

const CONTROLS = Object.freeze({
    legacyEndpoint: 'https://b04-legacy-control.invalid/v1',
    legacyKey: 'b04-legacy-control-key',
    legacyModel: 'claude-b04-control-model',
    piEndpoint: 'https://b04-pi-control.invalid/v1',
    piKey: 'b04-pi-control-key',
    piModel: 'claude-b04-control-model',
});

const ROUTES = Object.freeze([
    Object.freeze({ id: 'current_preset', value: '使用当前预设' }),
    Object.freeze({ id: 'other_preset', value: '使用其他预设' }),
    Object.freeze({ id: 'builtin_jailbreak', value: '使用内置破限' }),
]);

class FixtureError extends Error {
    constructor(code, details) {
        super(details ? code + ': ' + details : code);
        this.name = 'FixtureError';
        this.code = code;
    }
}

function assertFixture(value, code, details) {
    if (!value) {
        throw new FixtureError(code, details);
    }
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
    assertFixture(address && typeof address === 'object', 'port-allocation-failed');
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
    if (process.env.SNAP) {
        environment.SNAP = process.env.SNAP;
    }
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
    if (!child || child.exitCode !== null || child.signalCode !== null) {
        return true;
    }
    const send = signal => {
        try {
            if (process.platform === 'win32') {
                child.kill(signal);
            } else {
                process.kill(-child.pid, signal);
            }
        } catch {
            // The child exited between the state check and the signal.
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
            throw new FixtureError('child-exited-before-ready');
        }
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
            if (await validator(response)) {
                return;
            }
        } catch {
            // Readiness polling tolerates startup failures until the deadline.
        }
        await delay(150);
    }
    throw new FixtureError('http-readiness-timeout');
}

function startArtifactServer(bytes) {
    let requestCount = 0;
    const server = http.createServer((request, response) => {
        let pathname;
        try {
            pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
        } catch {
            response.writeHead(400).end();
            return;
        }
        if (!['GET', 'HEAD'].includes(request.method ?? '')) {
            response.writeHead(405, { Allow: 'GET, HEAD' }).end();
            return;
        }
        if (pathname !== '/bundle.js') {
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
    return { server, getRequestCount: () => requestCount };
}

async function listenLoopback(server) {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assertFixture(address && typeof address === 'object', 'listen-failed');
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

async function prepareConfig(stRoot, configPath, dataRoot) {
    const defaultConfig = path.join(stRoot, 'default', 'config.yaml');
    assertFixture(isFile(defaultConfig), 'st-default-config-missing');
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
            throw new FixtureError('webdriver-transport-failed');
        }
        const envelope = await response.json().catch(() => null);
        if (!response.ok || !envelope || envelope.value?.error) {
            throw new FixtureError(
                'webdriver-command-failed',
                [
                    envelope?.value?.error ?? response.status,
                    envelope?.value?.message,
                    envelope?.value?.stacktrace,
                ]
                    .filter(Boolean)
                    .join(' / ')
            );
        }
        return envelope.value;
    }
    const sessionPath = suffix => {
        const sessionId = getSessionId();
        assertFixture(sessionId, 'webdriver-session-missing');
        return '/session/' + encodeURIComponent(sessionId) + suffix;
    };
    return {
        request,
        createSession: () =>
            request(
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
            ),
        deleteSession: () => request('DELETE', sessionPath(''), undefined, 20_000),
        setTimeouts: () =>
            request('POST', sessionPath('/timeouts'), {
                implicit: 0,
                pageLoad: 60_000,
                script: 120_000,
            }),
        navigate: url => request('POST', sessionPath('/url'), { url }, 70_000),
        execute: (script, args = [], timeoutMs = 30_000) =>
            request('POST', sessionPath('/execute/sync'), { script, args }, timeoutMs),
        executeAsync: (script, args = [], timeoutMs = 120_000) =>
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
            if (await driver.execute(script, args, 10_000)) {
                return;
            }
        } catch {
            // Navigation or iframe replacement may invalidate the document temporarily.
        }
        await delay(200);
    }
    throw new FixtureError('browser-readiness-timeout');
}

function asyncBrowserScript(browserFunction) {
    return (
        'const done = arguments[arguments.length - 1];' +
        'const args = Array.prototype.slice.call(arguments, 0, -1);' +
        'Promise.resolve((' +
        browserFunction.toString() +
        ').apply(null, args)).then(' +
        'value => done({ ok: true, value }),' +
        'error => done({ ok: false, error: String(error && (error.stack || error)) })' +
        ');'
    );
}

function elementId(element) {
    return element?.['element-6066-11e4-a52e-4f735466cecf'] ?? element?.ELEMENT;
}

async function clickPopup(driver, mode = 'auto') {
    return driver.execute(
        'const mode = arguments[0];' +
            "const dialogs = [...document.querySelectorAll('dialog.popup')].filter(" +
            'dialog => dialog.open && dialog.getClientRects().length > 0);' +
            'const dialog = dialogs.at(-1);' +
            'if (!dialog) return { handled: false, rejectedScript: false };' +
            "const text = (dialog.textContent || '').toLowerCase();" +
            'const isScript = /script|脚本/.test(text);' +
            "const cancel = mode === 'cancel' || (mode === 'auto' && isScript);" +
            "const input = dialog.querySelector('.popup-input');" +
            'if (input && !cancel) {' +
            "input.value = 'B04 Fixture User';" +
            "input.dispatchEvent(new Event('input', { bubbles: true }));" +
            "input.dispatchEvent(new Event('change', { bubbles: true }));" +
            '}' +
            "const selector = cancel ? '.popup-button-cancel, .popup-button-close' : '.popup-button-ok';" +
            'const button = dialog.querySelector(selector);' +
            'if (!button) return { handled: false, rejectedScript: false };' +
            'button.click();' +
            'return { handled: true, rejectedScript: isScript && cancel };',
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
        if (stable >= 5) {
            return { rejectedScripts };
        }
        await delay(200);
    }
    throw new FixtureError('popup-settle-timeout');
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
            iframe?.contentWindow &&
            typeof iframe.contentWindow.getButtonEvent === 'function'
    );
}

async function preparePromptFixture(fixture) {
    const helper = window.TavernHelper;
    const context = window.SillyTavern.getContext();
    const selectedId = context.characterId;
    const currentName = helper.getCurrentCharacterName();
    const currentAvatar = helper.getCurrentCharacterId();
    const currentWorldbook = helper.getCurrentCharPrimaryLorebook();
    if (!helper || !currentName || !currentWorldbook || selectedId == null || context.groupId) {
        throw new Error('b04-no-single-character');
    }

    for (const type of ['character', 'preset', 'global']) {
        helper.replaceScriptTrees([], { type });
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    await Promise.all([
        helper.replaceTavernRegexes([], { type: 'character', name: 'current' }),
        helper.replaceTavernRegexes([], { type: 'preset', name: 'in_use' }),
        helper.replaceTavernRegexes([], { type: 'global' }),
    ]);

    const worldbookDeadline = Date.now() + 20_000;
    let worldbookReadable = false;
    while (Date.now() < worldbookDeadline) {
        if (helper.getLorebooks().includes(currentWorldbook)) {
            try {
                await helper.getLorebookEntries(currentWorldbook);
                worldbookReadable = true;
                break;
            } catch {
                // The imported embedded lorebook is named before its data becomes readable.
            }
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!worldbookReadable) {
        throw new Error('b04-worldbook-not-readable');
    }

    await helper.replaceLorebookEntries(currentWorldbook, [
        {
            uid: 0,
            display_index: 0,
            comment: '[mvu_update] B04_GATE',
            enabled: true,
            type: 'constant',
            position: 'before_character_definition',
            order: 500,
            probability: 100,
            content: 'B04_WORLD_UPDATE_KEEP',
        },
        {
            uid: 1,
            display_index: 1,
            comment: 'B04_ALLOW',
            enabled: true,
            type: 'constant',
            position: 'after_character_definition',
            order: 400,
            probability: 100,
            content: 'B04_WORLD_ALLOW_KEEP {{lastUserMessage}}',
        },
        {
            uid: 2,
            display_index: 2,
            comment: 'B04_DEPTH',
            enabled: true,
            type: 'constant',
            position: 'at_depth_as_system',
            depth: 1,
            order: 300,
            probability: 100,
            content: 'B04_WORLD_DEPTH_KEEP',
        },
        {
            uid: 3,
            display_index: 3,
            comment: 'B04_DROP',
            enabled: true,
            type: 'constant',
            position: 'before_character_definition',
            order: 200,
            probability: 100,
            content: 'B04_WORLD_BLACKLIST_DROP',
        },
        {
            uid: 4,
            display_index: 4,
            comment: '[mvu_plot] B04_PLOT',
            enabled: true,
            type: 'constant',
            position: 'before_character_definition',
            order: 100,
            probability: 100,
            content: 'B04_WORLD_PLOT_DROP',
        },
    ]);

    await helper.replaceCharacter(
        currentName,
        {
            description: 'B04_CHARACTER_CARD\n<StatusPlaceHolderImpl/>',
        },
        { render: 'none' }
    );

    const base = helper.getPreset('in_use');
    const fixturePreset = {
        ...base,
        settings: {
            ...base.settings,
            max_context: 32768,
            max_completion_tokens: 128,
            reply_count: 1,
            should_stream: false,
            squash_system_messages: false,
            character_name_prefix: 'none',
            wrap_user_messages_in_quotes: false,
        },
        prompts: [
            {
                id: 'b04PresetMacro',
                name: 'B04 preset macro',
                enabled: true,
                position: { type: 'relative' },
                role: 'system',
                content: 'B04_PRESET_MACRO {{lastUserMessage}}',
            },
            {
                id: 'worldInfoBefore',
                name: 'World before',
                enabled: true,
                position: { type: 'relative' },
                role: 'system',
            },
            {
                id: 'charDescription',
                name: 'Character',
                enabled: true,
                position: { type: 'relative' },
                role: 'system',
            },
            {
                id: 'worldInfoAfter',
                name: 'World after',
                enabled: true,
                position: { type: 'relative' },
                role: 'system',
            },
            {
                id: 'chatHistory',
                name: 'History',
                enabled: true,
                position: { type: 'relative' },
                role: 'system',
            },
            {
                id: 'b04PresetDepth',
                name: 'B04 preset depth',
                enabled: true,
                position: { type: 'in_chat', depth: 1, order: 10 },
                role: 'system',
                content: 'B04_PRESET_DEPTH_KEEP',
            },
        ],
        prompts_unused: [],
        extensions: {
            ...(base.extensions || {}),
            regex_scripts: [],
            tavern_helper: {
                ...((base.extensions || {}).tavern_helper || {}),
                scripts: [],
            },
        },
    };
    await helper.replacePreset('in_use', structuredClone(fixturePreset), { render: 'none' });
    await helper.createOrReplacePreset(fixture.otherPreset, structuredClone(fixturePreset), {
        render: 'none',
    });

    await helper.replaceTavernRegexes(
        [
            {
                id: 'b04-regex',
                script_name: 'B04 Prompt Fixture Regex',
                enabled: true,
                find_regex: '/B04_REGEX_SOURCE/g',
                trim_strings: [],
                replace_string: 'B04_REGEX_APPLIED',
                source: {
                    user_input: true,
                    ai_output: false,
                    slash_command: false,
                    world_info: false,
                    reasoning: false,
                },
                destination: { display: false, prompt: true },
                run_on_edit: false,
                min_depth: null,
                max_depth: null,
            },
        ],
        { type: 'global' }
    );

    const oldIds = Array.from({ length: context.chat.length }, (_value, index) => index);
    if (oldIds.length > 0) {
        await helper.deleteChatMessages(oldIds, { refresh: 'none' });
    }
    await helper.createChatMessages(
        [
            { role: 'user', message: 'B04_HISTORY_PRUNED_USER' },
            { role: 'assistant', message: 'B04_HISTORY_PRUNED_ASSISTANT' },
            { role: 'user', message: 'B04_HISTORY_KEEP_USER B04_REGEX_SOURCE' },
            { role: 'assistant', message: 'B04_HISTORY_KEEP_ASSISTANT' },
        ],
        { refresh: 'none' }
    );

    await new Promise(resolve => setTimeout(resolve, 1700));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const character = await helper.getCharacter('current');
    const entries = await helper.getLorebookEntries(currentWorldbook);
    const history = context.chat.map(message => String(message.mes ?? ''));
    const activePreset = helper.getPreset('in_use');
    const otherPreset = helper.getPreset(fixture.otherPreset);
    const regexProbe = helper.formatAsTavernRegexedString(
        'B04_REGEX_SOURCE',
        'user_input',
        'prompt',
        { depth: 1 }
    );
    const checks = {
        selectionStable:
            context.characterId === selectedId &&
            helper.getCurrentCharacterName() === currentName &&
            helper.getCurrentCharacterId() === currentAvatar,
        characterDescription:
            character.description.replaceAll('\r\n', '\n') ===
            'B04_CHARACTER_CARD\n<StatusPlaceHolderImpl/>',
        worldbookBound: helper.getCurrentCharPrimaryLorebook() === currentWorldbook,
        worldbookEntries:
            entries.length === 5 &&
            entries.every((entry, index) => entry.uid === index && entry.enabled),
        regex: regexProbe === 'B04_REGEX_APPLIED',
        history:
            history.length === 4 &&
            history[0] === 'B04_HISTORY_PRUNED_USER' &&
            history[3] === 'B04_HISTORY_KEEP_ASSISTANT',
        activePreset: activePreset.prompts.some(
            prompt =>
                prompt.id === 'b04PresetMacro' && prompt.content.includes('{{lastUserMessage}}')
        ),
        otherPreset: otherPreset.prompts.some(prompt => prompt.id === 'b04PresetDepth'),
        scriptsCleared: ['character', 'preset', 'global'].every(
            type => helper.getScriptTrees({ type }).length === 0
        ),
    };
    return {
        ok: Object.values(checks).every(Boolean),
        selectedId,
        currentName,
        currentAvatar,
        actualDescription: character.description,
        actualWorldbook: helper.getCurrentCharPrimaryLorebook(),
        entryCount: entries.length,
        history,
        regexProbe,
        checks,
    };
}

async function installArtifact(setup) {
    const context = window.SillyTavern.getContext();
    const helper = window.TavernHelper;
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
            其他预设名称: setup.otherPreset,
            应答格式: '聊天消息',
            关闭thinking: false,
            兼容假流式: false,
            随机头部: false,
            启用自动请求: false,
            请求方式: '依次请求，失败后重试',
            请求次数: 1,
            世界书条目白名单正则: 'B04_(?:ALLOW|DROP|DEPTH)',
            世界书条目黑名单正则: 'B04_DROP',
            模型来源: '自定义',
            api地址: setup.controls.legacyEndpoint,
            密钥: setup.controls.legacyKey,
            customApiKey: setup.controls.legacyKey,
            模型名称: setup.controls.legacyModel,
            pi: {
                provider: 'openai',
                api: 'openai-responses',
                authType: 'api_key',
                endpoint: setup.controls.piEndpoint,
                model: setup.controls.piModel,
                contextWindow: 8192,
                credentials: {},
                apiKeys: {
                    ['openai\n' + setup.controls.piEndpoint]: setup.controls.piKey,
                },
                customHeaders: '',
                customIncludeBody: '',
                customExcludeBody: '',
            },
            温度: 1,
            频率惩罚: 0,
            存在惩罚: 0,
            top_p: 1,
            top_k: 0,
            max_chat_history: 2,
            最大回复token数: 128,
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
    helper.replaceScriptTrees(
        [
            {
                type: 'script',
                enabled: true,
                name: setup.scriptName,
                id: setup.scriptId,
                content: 'import ' + JSON.stringify(setup.artifactUrl),
                info: '',
                button: { enabled: true, buttons: [] },
                data: {},
                export_with: { data: false, button: false },
            },
        ],
        { type: 'global' }
    );
    return true;
}

function selectFixtureCase(scriptName, route, source) {
    const iframe = [...document.querySelectorAll('iframe')].find(frame =>
        frame.id.startsWith('TH-script--' + scriptName)
    );
    if (!iframe?.contentDocument) {
        return { ok: false, reason: 'iframe-missing' };
    }
    const candidateDocuments = [document, iframe.contentDocument].filter(Boolean);
    const selectValue = value => {
        const select = candidateDocuments
            .flatMap(candidate => [...candidate.querySelectorAll('select')])
            .find(element => [...element.options].some(option => option.value === value));
        if (!select) {
            return false;
        }
        select.value = value;
        const EventConstructor = select.ownerDocument.defaultView.Event;
        select.dispatchEvent(new EventConstructor('input', { bubbles: true }));
        select.dispatchEvent(new EventConstructor('change', { bubbles: true }));
        return true;
    };
    const routeSelected = selectValue(route);
    const sourceSelected = selectValue(source);
    return { ok: routeSelected && sourceSelected };
}

async function captureFixtureCase(capture) {
    const context = window.SillyTavern.getContext();
    const helper = window.TavernHelper;
    const iframe = [...document.querySelectorAll('iframe')].find(frame =>
        frame.id.startsWith('TH-script--' + capture.scriptName)
    );
    if (!iframe?.contentWindow) {
        throw new Error('b04-iframe-missing');
    }
    const eventId = iframe.contentWindow.getButtonEvent('重试额外模型解析');
    const handlers = context.eventSource?.events?.[eventId];
    if (!Array.isArray(handlers) || handlers.length === 0) {
        throw new Error('b04-retry-handler-missing');
    }

    const readyEvent =
        helper.tavern_events?.CHAT_COMPLETION_SETTINGS_READY || capture.settingsReadyEvent;
    const originalTopFetch = window.fetch;
    const originalIframeFetch = iframe.contentWindow.fetch;
    const observations = {
        readyCount: 0,
        backendFetchCount: 0,
        providerFetchCount: 0,
        model: '',
        messages: null,
    };
    const readyListener = data => {
        const model = typeof data?.model === 'string' ? data.model : '';
        const expected =
            capture.source === '更多'
                ? model.startsWith(capture.captureModelPrefix)
                : model === capture.controls.legacyModel;
        if (!expected) {
            return;
        }
        observations.readyCount += 1;
        observations.model = model;
        observations.messages = structuredClone(data.messages);
    };
    const rejectFixed = (input, init, original, receiver) => {
        const rawUrl =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
        let url;
        try {
            url = new URL(rawUrl, window.location.href);
        } catch {
            return original.call(receiver, input, init);
        }
        if (url.pathname === '/api/backends/chat-completions/generate') {
            observations.backendFetchCount += 1;
            return Promise.reject(new DOMException('B04 fixed backend failure', 'AbortError'));
        }
        if (
            url.href.startsWith(capture.controls.piEndpoint) ||
            url.href.startsWith(capture.controls.legacyEndpoint)
        ) {
            observations.providerFetchCount += 1;
            return Promise.reject(new TypeError('B04 fixed provider failure'));
        }
        return original.call(receiver, input, init);
    };
    context.eventSource.on(readyEvent, readyListener);
    window.fetch = function (input, init) {
        return rejectFixed(input, init, originalTopFetch, this);
    };
    iframe.contentWindow.fetch = function (input, init) {
        return rejectFixed(input, init, originalIframeFetch, this);
    };

    let invocation;
    try {
        invocation = await Promise.race([
            Promise.resolve()
                .then(() => handlers.at(-1)())
                .then(
                    () => ({ settled: true, rejected: false }),
                    error => ({
                        settled: true,
                        rejected: true,
                        error: String(error && (error.message || error)),
                    })
                ),
            new Promise(resolve =>
                setTimeout(() => resolve({ settled: false, rejected: false }), 75_000)
            ),
        ]);
        await new Promise(resolve => setTimeout(resolve, 250));
    } finally {
        context.eventSource.removeListener(readyEvent, readyListener);
        window.fetch = originalTopFetch;
        iframe.contentWindow.fetch = originalIframeFetch;
    }
    return {
        ...observations,
        invocation,
        handlerCount: handlers.length,
        extraAnalysisEnded: window.Mvu?.isDuringExtraAnalysis?.() === false,
    };
}

function flattenMessageText(messages) {
    return messages
        .map(message => {
            if (typeof message?.content === 'string') {
                return message.content;
            }
            if (!Array.isArray(message?.content)) {
                return '';
            }
            return message.content
                .map(part => (typeof part?.text === 'string' ? part.text : ''))
                .join('\n');
        })
        .join('\n');
}

function validateCapturedPair(route, legacy, pi) {
    assertFixture(Array.isArray(legacy), 'legacy-messages-missing', route.id);
    assertFixture(Array.isArray(pi), 'pi-messages-missing', route.id);
    assertFixture(
        JSON.stringify(legacy) === JSON.stringify(pi),
        'legacy-pi-message-mismatch',
        route.id
    );
    const text = flattenMessageText(legacy);
    const json = JSON.stringify(legacy);
    for (const marker of [
        'B04_CHARACTER_CARD',
        'B04_WORLD_UPDATE_KEEP',
        'B04_WORLD_ALLOW_KEEP',
        'B04_WORLD_DEPTH_KEEP',
        'B04_HISTORY_KEEP_USER',
        'B04_HISTORY_KEEP_ASSISTANT',
        'B04_REGEX_APPLIED',
        '<past_observe>',
        '</past_observe>',
        '<must>',
    ]) {
        assertFixture(text.includes(marker), 'required-marker-missing', route.id + '/' + marker);
    }
    for (const marker of [
        'B04_HISTORY_PRUNED_USER',
        'B04_HISTORY_PRUNED_ASSISTANT',
        'B04_REGEX_SOURCE',
        'B04_WORLD_BLACKLIST_DROP',
        'B04_WORLD_PLOT_DROP',
        '<StatusPlaceHolderImpl/>',
        '{{lastUserMessage}}',
        CAPTURE_MODEL_PREFIX,
        CONTROLS.legacyEndpoint,
        CONTROLS.legacyKey,
        CONTROLS.legacyModel,
        CONTROLS.piEndpoint,
        CONTROLS.piKey,
    ]) {
        assertFixture(!json.includes(marker), 'forbidden-marker-present', route.id + '/' + marker);
    }
    if (route.id !== 'builtin_jailbreak') {
        assertFixture(text.includes('B04_PRESET_MACRO'), 'preset-macro-output-missing', route.id);
        assertFixture(
            text.includes('B04_PRESET_DEPTH_KEEP'),
            'preset-depth-output-missing',
            route.id
        );
    }
    assertFixture(
        legacy.every(
            message =>
                ['system', 'user', 'assistant', 'tool'].includes(message?.role) &&
                (typeof message?.content === 'string' || Array.isArray(message?.content))
        ),
        'invalid-message-shape',
        route.id
    );
}

async function removeRunRoot(runRoot) {
    if (!runRoot) {
        return true;
    }
    const resolved = path.resolve(runRoot);
    assertFixture(
        path.dirname(resolved) === path.resolve(os.tmpdir()) &&
            path.basename(resolved).startsWith(TEMP_PREFIX),
        'unsafe-run-root-cleanup'
    );
    await rm(resolved, { recursive: true, force: true });
    return !fs.existsSync(resolved);
}

async function removeProfileRoot(profile) {
    if (!profile?.separate) {
        return true;
    }
    const resolved = path.resolve(profile.profileRoot);
    assertFixture(
        path.dirname(resolved) === path.resolve(profile.allowedParent) &&
            path.basename(resolved).startsWith(FIREFOX_PROFILE_PREFIX),
        'unsafe-profile-root-cleanup'
    );
    await rm(resolved, { recursive: true, force: true });
    return !fs.existsSync(resolved);
}

function validateOutputDirectory(outputDirectory) {
    outputDirectory ||= defaultOutputDirectory;
    assertFixture(path.isAbsolute(outputDirectory), 'output-directory-must-be-absolute');
    const resolved = path.resolve(outputDirectory);
    assertFixture(resolved !== path.parse(resolved).root, 'unsafe-output-directory');
    assertFixture(fs.existsSync(resolved), 'output-directory-missing');
    assertFixture(fs.statSync(resolved).isDirectory(), 'output-path-not-directory');
    const existingFiles = fs.readdirSync(resolved).sort();
    const expectedFiles = ROUTES.map(route => route.id + '.json').sort();
    assertFixture(
        existingFiles.length === 0 ||
            (resolved === defaultOutputDirectory &&
                JSON.stringify(existingFiles) === JSON.stringify(expectedFiles)),
        'output-directory-not-empty'
    );
    return resolved;
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
    let cleanup = true;
    let failure;
    let failurePhase;

    try {
        const outputDirectory = validateOutputDirectory(process.env.MVU_PI_PROMPT_FIXTURE_OUTPUT);
        const stRoot = resolveSillyTavernRoot();
        assertFixture(stRoot, 'st-root-not-found');
        assertFixture(isFile(artifactPath), 'artifact-missing');
        assertFixture(isFile(characterCardPath), 'character-card-missing');
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
            {
                cwd: profile.profileRoot,
                env: isolatedEnvironment(profile.profileRoot),
            }
        );
        const driverBaseUrl = 'http://127.0.0.1:' + geckoPort;
        await waitForHttp(
            driverBaseUrl + '/status',
            geckoProcess,
            30_000,
            async response => response.ok && (await response.json())?.value?.ready === true
        );
        driver = webdriver(driverBaseUrl, () => sessionId);
        const session = await driver.createSession();
        sessionId = session?.sessionId;
        assertFixture(sessionId, 'webdriver-session-create-failed');
        const browserVersion = String(session?.capabilities?.browserVersion ?? '');
        const browserProfile = session?.capabilities?.['moz:profile'];
        assertFixture(
            typeof browserProfile === 'string' &&
                path
                    .resolve(browserProfile)
                    .startsWith(path.resolve(profile.profileRoot) + path.sep),
            'firefox-profile-not-isolated'
        );
        await driver.setTimeouts();

        phase = 'initialize-sillytavern';
        await driver.navigate(stUrl);
        await waitForBrowser(driver, () => document.readyState === 'complete', [], 30_000);
        const reset = await driver.executeAsync(
            'const done = arguments[arguments.length - 1];' +
                "fetch('/api/users/reset-settings', {" +
                "method: 'POST', headers: { 'Content-Type': 'application/json' }," +
                "body: JSON.stringify({ password: '' })" +
                '}).then(response => done({ ok: response.status === 204 || response.ok }))' +
                '.catch(() => done({ ok: false }));'
        );
        assertFixture(reset?.ok, 'settings-reset-failed');
        await driver.navigate(stUrl);
        await waitForBrowser(driver, () => document.readyState === 'complete', [], 30_000);
        for (let index = 0; index < 8; index += 1) {
            const popup = await clickPopup(driver, 'accept');
            if (!popup?.handled) {
                break;
            }
            await delay(300);
        }
        await waitForBrowser(driver, browserReadyForTavernHelper, [], 45_000);

        phase = 'import-character';
        const input = await driver.findElement('#character_import_file');
        const inputId = elementId(input);
        assertFixture(inputId, 'character-import-input-missing');
        await driver.setFileInput(inputId, characterCardPath);
        await waitForBrowser(driver, browserHasImportedCharacter, [], 45_000);
        const selected = await driver.execute(
            'const context = window.SillyTavern.getContext();' +
                'const index = context.characters.findIndex(character => ' +
                "String(character?.name ?? '').includes('青空'));" +
                'if (index < 0) return { ok: false };' +
                'window.__b04SelectionSettled = false;' +
                'Promise.resolve(context.selectCharacterById(index)).finally(' +
                '() => { window.__b04SelectionSettled = true; });' +
                'return { ok: true, index };'
        );
        assertFixture(selected?.ok, 'imported-character-not-found');
        const popupEvidence = await settlePopups(driver, 35_000);
        await waitForBrowser(driver, browserHasSelectedCharacter, [], 35_000);

        phase = 'prepare-prompt-fixture';
        const prepared = await driver.executeAsync(
            asyncBrowserScript(preparePromptFixture),
            [{ otherPreset: OTHER_PRESET }],
            120_000
        );
        assertFixture(prepared?.ok, 'fixture-browser-script-failed', prepared?.error);
        assertFixture(
            prepared.value?.ok,
            'fixture-readiness-failed',
            JSON.stringify(prepared.value ?? null)
        );

        phase = 'load-artifact';
        const artifactUrl =
            'http://127.0.0.1:' + artifactPort + '/bundle.js?sha=' + artifactHash.slice(0, 12);
        const installed = await driver.executeAsync(
            asyncBrowserScript(installArtifact),
            [
                {
                    artifactUrl,
                    scriptName: SCRIPT_NAME,
                    scriptId: SCRIPT_ID,
                    otherPreset: OTHER_PRESET,
                    controls: CONTROLS,
                },
            ],
            60_000
        );
        assertFixture(
            installed?.ok && installed.value,
            'artifact-install-failed',
            installed?.error
        );
        await waitForBrowser(driver, browserArtifactReady, [SCRIPT_NAME], 90_000);
        assertFixture(artifact.getRequestCount() >= 1, 'artifact-not-requested');

        phase = 'capture-six-cases';
        const captures = {};
        for (const route of ROUTES) {
            captures[route.id] = {};
            for (const source of ['自定义', '更多']) {
                const sourceId = source === '更多' ? 'pi' : 'legacy';
                phase = 'capture-' + route.id + '-' + sourceId;
                const selection = await driver.execute(
                    'return (' + selectFixtureCase.toString() + ').apply(null, arguments);',
                    [SCRIPT_NAME, route.value, source]
                );
                assertFixture(
                    selection?.ok,
                    'fixture-case-selection-failed',
                    route.id + '/' + sourceId + '/' + String(selection?.reason ?? '')
                );
                await delay(250);
                const captured = await driver.executeAsync(
                    asyncBrowserScript(captureFixtureCase),
                    [
                        {
                            scriptName: SCRIPT_NAME,
                            route: route.value,
                            source,
                            settingsReadyEvent: SETTINGS_READY_EVENT,
                            captureModelPrefix: CAPTURE_MODEL_PREFIX,
                            controls: CONTROLS,
                        },
                    ],
                    100_000
                );
                assertFixture(
                    captured?.ok,
                    'capture-browser-script-failed',
                    route.id + '/' + sourceId + '/' + String(captured?.error ?? '')
                );
                const evidence = captured.value;
                assertFixture(
                    evidence?.invocation?.settled,
                    'capture-invocation-timeout',
                    route.id + '/' + sourceId
                );
                assertFixture(
                    evidence.readyCount === 1,
                    'settings-ready-count-invalid',
                    route.id + '/' + sourceId + '/' + String(evidence?.readyCount)
                );
                assertFixture(
                    Array.isArray(evidence.messages),
                    'settings-ready-messages-missing',
                    route.id + '/' + sourceId
                );
                assertFixture(
                    evidence.backendFetchCount >= 1,
                    'backend-capture-fetch-missing',
                    route.id + '/' + sourceId
                );
                assertFixture(
                    evidence.extraAnalysisEnded,
                    'extra-analysis-not-reset',
                    route.id + '/' + sourceId
                );
                captures[route.id][sourceId] = evidence.messages;
            }
            validateCapturedPair(route, captures[route.id].legacy, captures[route.id].pi);
        }

        phase = 'write-fixtures';
        const version = await fetch(stUrl + '/version', {
            signal: AbortSignal.timeout(5_000),
        }).then(response => response.json());
        const tavernHelperVersion = await driver.execute(
            'return window.TavernHelper.getTavernHelperVersion();'
        );
        const provenance = {
            sillyTavernVersion: String(version?.pkgVersion ?? ''),
            sillyTavernRevision: String(version?.gitRevision ?? version?.gitBranch ?? ''),
            tavernHelperVersion: String(tavernHelperVersion ?? ''),
            firefoxVersion: browserVersion,
            artifactSha256: artifactHash,
            sourceCard: 'example/artifact/青空 理_mvu_update.png',
            dataRoot: 'isolated-temporary',
            realBrowserCapture: true,
        };
        for (const route of ROUTES) {
            const fixture = {
                schemaVersion: 1,
                route: route.value,
                provenance,
                normalization: [],
                allowedDifferences: [],
                legacy: captures[route.id].legacy,
                pi: captures[route.id].pi,
            };
            await writeFile(
                path.join(outputDirectory, route.id + '.json'),
                JSON.stringify(fixture, null, 2) + '\n',
                { mode: 0o600 }
            );
        }
        assertFixture(
            sha256(await readFile(artifactPath)) === artifactHash,
            'artifact-changed-during-capture'
        );
        process.stdout.write(
            JSON.stringify(
                {
                    ok: true,
                    outputDirectory,
                    fixtureFiles: ROUTES.map(route => route.id + '.json'),
                    artifactRequests: artifact.getRequestCount(),
                    rejectedEmbeddedScripts: popupEvidence.rejectedScripts,
                    provenance,
                },
                null,
                2
            ) + '\n'
        );
    } catch (error) {
        failure = error;
        failurePhase = phase;
    } finally {
        if (sessionId && driver) {
            try {
                await driver.deleteSession();
            } catch {
                cleanup = false;
            }
        }
        cleanup = (await closeServer(artifactServer).catch(() => false)) && cleanup;
        cleanup = (await stopProcess(geckoProcess).catch(() => false)) && cleanup;
        cleanup = (await stopProcess(stProcess).catch(() => false)) && cleanup;
        cleanup = (await removeProfileRoot(profile).catch(() => false)) && cleanup;
        cleanup = (await removeRunRoot(runRoot).catch(() => false)) && cleanup;
    }

    if (failure) {
        const code = failure instanceof FixtureError ? failure.code : 'unexpected-error';
        process.stdout.write(
            JSON.stringify(
                {
                    ok: false,
                    phase: failurePhase,
                    code,
                    details: String(failure.message ?? failure),
                    cleanup,
                },
                null,
                2
            ) + '\n'
        );
        process.exitCode = 1;
    } else if (!cleanup) {
        process.stdout.write(
            JSON.stringify(
                { ok: false, phase: 'cleanup', code: 'cleanup-failed', cleanup: false },
                null,
                2
            ) + '\n'
        );
        process.exitCode = 1;
    }
}

await main();
