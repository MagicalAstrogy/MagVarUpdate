import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const esm_packages = ['@earendil-works/pi-ai', '@google/genai'];
const allowed_modules = new Set([
    'pi_gateway.ts',
    'google_proxy_adapter.ts',
    'non_streaming_fetch.ts',
    'abort_signal.ts',
]);
const snap_gecko = '/snap/firefox/current/usr/lib/firefox/geckodriver';
const gecko_binary =
    process.env.MVU_GECKODRIVER ?? (existsSync(snap_gecko) ? snap_gecko : 'geckodriver');
const profile_parent = gecko_binary.startsWith('/snap/firefox/')
    ? path.join(os.homedir(), 'snap/firefox/common')
    : os.tmpdir();
await mkdir(profile_parent, { recursive: true });
const profile_root = await mkdtemp(path.join(profile_parent, 'mvu-pi-esm-'));

// This function runs inside Firefox. Only ESM modules come from the network; every provider
// request uses a local fake transport and synthetic credentials, including both OAuth routes.
async function browserSmoke() {
    const check = (condition, message) => {
        if (!condition) throw new Error(message);
    };
    const state = (window.piEsmSmoke = { phase: 'loading ESM' });
    try {
        const loadModule = name => import(`/pi/${name}.ts`);
        const gateway = await loadModule('pi_gateway');
        const { createGoogleProxyAwareApi, assertGoogleProxyAdapterCompatible } =
            await loadModule('google_proxy_adapter');
        const { createPiNonStreamingFetch } = await loadModule('non_streaming_fetch');
        check(
            Object.keys(gateway).filter(key => key.endsWith('_MODELS')).length === 34,
            'Missing provider catalogs'
        );
        assertGoogleProxyAdapterCompatible();
        const apis = {
            'openai-completions': gateway.openAICompletionsApi(),
            'openai-responses': gateway.openAIResponsesApi(),
            'anthropic-messages': gateway.anthropicMessagesApi(),
            'google-generative-ai': createGoogleProxyAwareApi(gateway.googleGenerativeAIApi()),
            'mistral-conversations': gateway.mistralConversationsApi(),
            'openai-codex-responses': gateway.openAICodexResponsesApi(),
        };
        const text = 'esm-ok';
        const responses = {
            id: 'resp-test',
            status: 'completed',
            output: [
                {
                    id: 'msg-test',
                    type: 'message',
                    role: 'assistant',
                    status: 'completed',
                    content: [{ type: 'output_text', text, annotations: [] }],
                },
            ],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        };
        const observed = [];
        for (const [api, adapter] of Object.entries(apis)) {
            state.phase = api;
            const codex = api === 'openai-codex-responses';
            const anthropic = api === 'anthropic-messages';
            const google = api === 'google-generative-ai';
            const token = codex
                ? `e30.${btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test-account' } }))}.signature`
                : anthropic
                  ? 'sk-ant-oat-test-credential'
                  : 'test-api-key';
            let dispatches = 0;
            const send = async (input, init) => {
                const request = new Request(input, init);
                const headers = request.headers;
                const body = await request.json();
                if (google) {
                    check(
                        request.url.includes(':generateContent'),
                        'Google must use non-streaming generateContent'
                    );
                    check(headers.get('x-goog-api-key') === token, 'Missing Google API key');
                } else {
                    check(body.stream === codex, `${api}: wrong HTTP streaming mode`);
                    check(
                        headers.get('authorization') === `Bearer ${token}`,
                        `${api}: missing bearer auth`
                    );
                }
                if (anthropic) {
                    check(
                        headers.get('anthropic-beta')?.includes('oauth-2025-04-20'),
                        'Missing Anthropic OAuth beta'
                    );
                    check(
                        headers.get('anthropic-beta')?.includes('claude-code-20250219'),
                        'Missing Claude Code beta'
                    );
                    check(headers.get('x-app') === 'cli', 'Missing Anthropic x-app');
                    check(
                        headers.get('user-agent')?.startsWith('claude-cli/'),
                        'Missing Anthropic User-Agent'
                    );
                    check(
                        headers.get('anthropic-version') === '2023-06-01',
                        'Missing Anthropic API version'
                    );
                }
                if (codex) {
                    check(
                        headers.get('chatgpt-account-id') === 'test-account',
                        'Missing Codex account ID'
                    );
                    check(headers.get('originator') === 'pi', 'Missing Codex originator');
                    check(
                        headers.get('openai-beta') === 'responses=experimental',
                        'Missing Codex Responses beta'
                    );
                    check(Boolean(headers.get('user-agent')), 'Missing Codex User-Agent');
                }
                observed.push({ api, headers: [...headers.keys()] });
                dispatches++;
                if (codex) {
                    return new Response(
                        `data: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: responses.output[0] })}\n\n` +
                            `data: ${JSON.stringify({ type: 'response.completed', response: responses })}\n\n`,
                        { headers: { 'content-type': 'text/event-stream' } }
                    );
                }
                if (api === 'openai-responses') return Response.json(responses);
                if (anthropic)
                    return Response.json({
                        id: 'msg-test',
                        type: 'message',
                        role: 'assistant',
                        model: 'test-model',
                        content: [{ type: 'text', text }],
                        stop_reason: 'end_turn',
                        usage: { input_tokens: 1, output_tokens: 1 },
                    });
                if (google)
                    return Response.json({
                        candidates: [
                            { content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' },
                        ],
                        usageMetadata: {
                            promptTokenCount: 1,
                            candidatesTokenCount: 1,
                            totalTokenCount: 2,
                        },
                    });
                return Response.json({
                    id: 'chat-test',
                    choices: [
                        {
                            index: 0,
                            message: { role: 'assistant', content: text },
                            finish_reason: 'stop',
                        },
                    ],
                    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                });
            };
            const model = {
                id: 'test-model',
                name: 'test-model',
                api,
                provider: codex ? 'openai-codex' : anthropic ? 'anthropic' : 'test-provider',
                baseUrl: 'https://provider.invalid/v1',
                reasoning: false,
                input: ['text'],
                contextWindow: 128_000,
                maxTokens: 4096,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            };
            const models = gateway.createModels({
                authContext: { env: async () => undefined, fileExists: async () => false },
                credentials: {
                    read: async () => undefined,
                    list: async () => [],
                    modify: async (_, update) => update(undefined),
                    delete: async () => {},
                },
            });
            models.setProvider(
                gateway.createProvider({
                    id: model.provider,
                    baseUrl: model.baseUrl,
                    models: [model],
                    api: { [api]: adapter },
                    auth: {
                        apiKey: {
                            name: 'test',
                            resolve: async () => ({ auth: { apiKey: token }, source: 'test' }),
                        },
                    },
                })
            );
            const result = await models
                .stream(
                    model,
                    {
                        messages: [
                            {
                                role: 'user',
                                content: [{ type: 'text', text: 'hello' }],
                                timestamp: Date.now(),
                            },
                        ],
                    },
                    {
                        apiKey: token,
                        fetch: codex ? send : createPiNonStreamingFetch(api, send),
                        maxTokens: 1024,
                        maxRetries: 0,
                        transport: 'sse',
                    }
                )
                .result();
            check(
                result.stopReason === 'stop',
                `${api}: ${result.errorMessage ?? result.stopReason}`
            );
            check(
                result.content
                    .filter(block => block.type === 'text')
                    .map(block => block.text)
                    .join('') === text,
                `${api}: wrong text`
            );
            check(dispatches === 1, `${api}: expected one request`);
        }
        state.phase = 'Google cancellation';
        for (const streaming of [false, true]) {
            const controller = new AbortController();
            let started;
            const dispatched = new Promise(resolve => {
                started = resolve;
            });
            const send = async (input, init) => {
                const request = new Request(input, init);
                return new Promise((_, reject) => {
                    request.signal.addEventListener('abort', () => reject(request.signal.reason), {
                        once: true,
                    });
                    started();
                });
            };
            const result = apis['google-generative-ai']
                .stream(
                    {
                        id: 'test-model',
                        name: 'test-model',
                        api: 'google-generative-ai',
                        provider: 'google',
                        baseUrl: 'https://provider.invalid/v1',
                        reasoning: false,
                        input: ['text'],
                        contextWindow: 128_000,
                        maxTokens: 4096,
                        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                    },
                    {
                        messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
                    },
                    {
                        apiKey: 'test-api-key',
                        signal: controller.signal,
                        maxRetries: 0,
                        fetch: streaming
                            ? send
                            : createPiNonStreamingFetch('google-generative-ai', send),
                    }
                )
                .result();
            await dispatched;
            controller.abort(new Error('User stopped generation'));
            check(
                (await result).stopReason === 'aborted',
                'Google cancellation must reach the transport'
            );
        }
        state.result = {
            catalogs: 34,
            adapters: observed,
            googleCancellation: ['streaming', 'non-streaming'],
        };
        state.done = true;
    } catch (error) {
        state.error = String(error?.message ?? error);
        state.done = true;
    }
}

const server = http.createServer((request, response) => {
    if (request.url === '/') {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<!doctype html><script type="module" src="/smoke.js"></script>');
        return;
    }
    response.setHeader('content-type', 'text/javascript');
    if (request.url === '/smoke.js') {
        response.end(`(${browserSmoke.toString()})();`);
        return;
    }
    const filename = request.url?.slice('/pi/'.length);
    if (!request.url?.startsWith('/pi/') || !allowed_modules.has(filename)) {
        response.writeHead(404);
        response.end();
        return;
    }
    const source = readFileSync(path.join(root, 'src/function/update/pi', filename), 'utf8');
    const { outputText } = transpileModule(source, {
        compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    });
    response.end(
        outputText.replace(/from ['"]([^'"]+)['"]/g, (_, specifier) => {
            const name = esm_packages.find(
                name => specifier === name || specifier.startsWith(`${name}/`)
            );
            const target = name
                ? `https://testingcf.jsdelivr.net/npm/${name}@${manifest.dependencies[name]}${specifier.slice(name.length)}/+esm`
                : `${specifier}.ts`;
            return `from ${JSON.stringify(target)}`;
        })
    );
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port_reservation = net.createServer();
await new Promise(resolve => port_reservation.listen(0, '127.0.0.1', resolve));
const driver_port = port_reservation.address().port;
await new Promise(resolve => port_reservation.close(resolve));
const driver = spawn(
    gecko_binary,
    [
        '--host',
        '127.0.0.1',
        '--port',
        String(driver_port),
        '--profile-root',
        profile_root,
        '--log',
        'error',
    ],
    { stdio: 'ignore', detached: true }
);
let spawn_error;
driver.on('error', error => {
    spawn_error = error;
});
let session_id;
async function command(method, route, body) {
    const response = await fetch(`http://127.0.0.1:${driver_port}${route}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
    });
    const { value } = await response.json();
    if (!response.ok) throw new Error(value?.message ?? `WebDriver HTTP ${response.status}`);
    return value;
}

try {
    const deadline = Date.now() + 20_000;
    while (true) {
        if (spawn_error) throw spawn_error;
        if (Date.now() > deadline) throw new Error('WebDriver startup timeout');
        try {
            await command('GET', '/status');
            break;
        } catch {
            await delay(200);
        }
    }
    const session = await command('POST', '/session', {
        capabilities: {
            alwaysMatch: {
                browserName: 'firefox',
                acceptInsecureCerts: true,
                'moz:firefoxOptions': { args: ['-headless'], prefs: { 'network.proxy.type': 0 } },
            },
        },
    });
    session_id = session.sessionId;
    assert.ok(session.capabilities['moz:profile'].startsWith(`${profile_root}${path.sep}`));
    await command('POST', `/session/${session_id}/url`, {
        url: `http://127.0.0.1:${server.address().port}/`,
    });
    const load_deadline = Date.now() + 90_000;
    let last_phase;
    while (true) {
        const state = await command('POST', `/session/${session_id}/execute/sync`, {
            script: 'return window.piEsmSmoke || null;',
            args: [],
        });
        if (state?.phase !== last_phase) {
            last_phase = state?.phase;
            process.stderr.write(`ESM browser check: ${last_phase ?? 'starting'}\n`);
        }
        if (state?.done) {
            if (state.error) throw new Error(`${state.phase}: ${state.error}`);
            process.stdout.write(`${JSON.stringify(state.result, null, 2)}\n`);
            break;
        }
        if (Date.now() > load_deadline) throw new Error(`ESM browser timeout: ${state?.phase}`);
        await delay(250);
    }
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
} finally {
    if (session_id) await command('DELETE', `/session/${session_id}`).catch(() => {});
    if (driver.pid && driver.exitCode === null) {
        try {
            process.kill(-driver.pid, 'SIGTERM');
        } catch {
            // The driver may have exited after closing its browser session.
        }
    }
    await new Promise(resolve => server.close(resolve));
    await rm(profile_root, { recursive: true, force: true });
}
