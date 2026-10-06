/** 理理角色卡的真实浏览器/API 回归：只观察传输和注入凭据，不替换模型响应。 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isLivePiCaseEnabled, livePiCases } from './pi_live_cases.ts';

const outputDirectory = resolve('coverage/pi-st-final');
const otherPreset = 'MVU configured live other preset';
const injectionId = 'MVU_CONFIGURED_LIVE_INSTRUCTION';
const routes = [
    ['current', '使用当前预设'],
    ['other', '使用其他预设'],
    ['builtin', '使用内置破限'],
];

function requireCheck(value, code) {
    if (!value) {
        const error = new Error(code);
        error.code = code;
        throw error;
    }
}

/** 每个脚本自行完成异步工作，外层只接收白名单证据与固定错误阶段。 */
async function browserCall(webDriver, fn, configuration) {
    const result = await webDriver.executeAsync(
        `const done = arguments[arguments.length - 1];
        Promise.resolve((${fn.toString()})(arguments[0])).then(
            value => done({ ok: true, value }),
            () => done({ ok: false, stage: window.__mvuConfiguredLive?.stage || 'setup' })
        );`,
        [configuration],
        30_000
    );
    requireCheck(result?.ok, `browser-${result?.stage || 'script'}`);
    return result.value;
}

/** 预设下拉框在面板挂载时读取保存列表，测试预设必须先于 MVU 脚本创建。 */
export async function preparePiStConfiguredLivePresets({ webDriver }) {
    await browserCall(
        webDriver,
        async configuration => {
            const helper = window.TavernHelper;
            const preset = structuredClone(helper.getPreset('in_use'));
            preset.settings = {
                ...preset.settings,
                max_context: 128000,
                max_completion_tokens: 1024,
                squash_system_messages: false,
            };
            await helper.replacePreset('in_use', preset, { render: 'none' });
            await helper.createOrReplacePreset(configuration.otherPreset, structuredClone(preset), {
                render: 'none',
            });
            return true;
        },
        { otherPreset }
    );
}

async function prepareBrowser(configuration) {
    const context = window.SillyTavern.getContext();
    const iframe = [...document.querySelectorAll('iframe')].find(frame =>
        frame.id.startsWith('TH-script--' + configuration.scriptName)
    );
    const event = iframe?.contentWindow.getButtonEvent('重试额外模型解析');
    const retry = context.eventSource.events[event]?.at(-1);
    if (!iframe?.contentWindow || !retry) throw new Error('missing-runtime');
    const data = window.Mvu.getMvuData({ type: 'message', message_id: 'latest' });
    if (!data?.stat_data?.理) throw new Error('missing-character-variables');
    const baseline = structuredClone(data);
    const affinityArray = Array.isArray(baseline.stat_data.理.好感度);
    if (affinityArray) baseline.stat_data.理.好感度[0] = 0;
    else baseline.stat_data.理.好感度 = 0;
    const character = context.characters[context.characterId]?.name || context.name2;
    if (!String(character).includes('理')) throw new Error('wrong-character');
    window.__mvuConfiguredLive = {
        stage: 'ready',
        frame: iframe.contentWindow,
        retry,
        baseline,
        affinityArray,
        character,
        originalTopFetch: window.fetch,
        originalFrameFetch: iframe.contentWindow.fetch,
    };
    return { character, affinityArray, historyCount: context.chat.length };
}

async function configureCase(configuration) {
    const state = window.__mvuConfiguredLive;
    const helper = window.TavernHelper;
    const context = window.SillyTavern.getContext();
    state.stage = 'configure';
    state.cleanupTransport?.();
    const docs = [document, state.frame.document];
    const tick = () => new Promise(resolve => setTimeout(resolve, 120));
    const fields = () => docs.flatMap(doc => [...doc.querySelectorAll('.mvu-field')]);
    const byLabel = expression =>
        fields().find(field =>
            expression.test(field.querySelector('.mvu-field__label')?.textContent || '')
        );
    const setInput = (input, value) => {
        if (!input) throw new Error('missing-input');
        input.value = value;
        const Event = input.ownerDocument.defaultView.Event;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const choose = (values, value) => {
        const select = docs
            .flatMap(doc => [...doc.querySelectorAll('select')])
            .find(select =>
                values.every(value => [...select.options].some(option => option.value === value))
            );
        setInput(select, value);
    };
    choose(['更多', '自定义', '与插头相同'], '更多');
    await tick();
    const source = JSON.stringify([configuration.provider, configuration.api, 'api_key']);
    choose([source], source);
    await tick();
    state.stage = 'connection-fields';
    const grid = docs
        .flatMap(doc => [...doc.querySelectorAll('.mvu-field-grid')])
        .find(grid => grid.querySelector('.mvu-pi-model-controls'));
    const model = grid.querySelector('.mvu-pi-model-controls input[type="text"]');
    const endpoint = [...grid.querySelectorAll('input[type="text"]')].find(
        input => input !== model
    );
    if (endpoint)
        setInput(endpoint, configuration.provider === 'google' ? '' : configuration.endpoint);
    await tick();
    setInput(grid.querySelector('input[type="password"]'), '  ' + configuration.placeholder + '  ');
    setInput(model, configuration.model);
    await tick();
    setInput(
        byLabel(/上下文窗口|context window/i)?.querySelector('input'),
        configuration.provider === 'google' ? '' : '128000'
    );
    setInput(byLabel(/最大回复 token|maximum response tokens/i)?.querySelector('input'), '1024');
    const headerInput = byLabel(/自定义请求头|custom request headers/i)?.querySelector('textarea');
    if (headerInput) setInput(headerInput, configuration.customHeaders);
    else if (configuration.customHeaders) throw new Error('missing-header-input');
    choose(['聊天消息', '工具调用', '格式化输出'], configuration.format);
    choose(['使用当前预设', '使用其他预设', '使用内置破限'], configuration.route);
    await tick();
    state.stage = 'saved-preset-selection';
    if (configuration.route === '使用其他预设')
        choose([configuration.otherPreset], configuration.otherPreset);
    const streaming = byLabel(/兼容假流式|pseudo-streaming compatibility/i)?.querySelector(
        'input[type="checkbox"]'
    );
    if (!streaming) throw new Error('missing-stream-control');
    streaming.checked = configuration.streaming;
    streaming.dispatchEvent(
        new streaming.ownerDocument.defaultView.Event('change', { bubbles: true })
    );
    await tick();

    state.stage = 'variable-baseline';
    const last = context.chat.length - 1;
    await window.Mvu.replaceMvuData(structuredClone(state.baseline), {
        type: 'message',
        message_id: last - 1,
    });
    await window.Mvu.replaceMvuData(structuredClone(state.baseline), {
        type: 'message',
        message_id: last,
    });
    await helper.setChatMessages(
        [
            {
                message_id: last,
                message: `MVU_CONFIGURED_LIVE_CASE ${configuration.id}. 理的好感度从0变成${configuration.value}，其他变量不变。\n<StatusPlaceHolderImpl/>`,
            },
        ],
        { refresh: 'none' }
    );
    const path = '/理/好感度' + (state.affinityArray ? '/0' : '');
    const instruction = [
        'MVU_CONFIGURED_LIVE_INSTRUCTION: deterministic integration test for the existing character.',
        `Set only 理.好感度 to ${configuration.value}; leave every other variable unchanged.`,
        `For text responses, return exactly <UpdateVariable>_.set('理.好感度', 0, ${configuration.value});</UpdateVariable>.`,
        `For the provided tool, call it once with delta="_.set('理.好感度', 0, ${configuration.value});" and analysis="Live test.".`,
        `For JSON Schema/JSON Object responses return {"analysis":"Live test.","json_patch":[{"op":"replace","path":"${path}","value":${configuration.value}}]}.`,
    ].join('\n');
    await context.setExtensionPrompt(configuration.injectionId, instruction, 1, 0, false, 0);
    state.invocation = { settled: false, rejected: false };
    state.observation = {
        captureRequests: 0,
        intermediateSystemsCaptured: false,
        requests: [],
        stopClicked: false,
        abortObserved: false,
    };
    const settings = context.extensionSettings.mvu_settings.额外模型解析配置;
    return {
        provider: settings.pi.provider,
        api: settings.pi.api,
        model: settings.pi.model,
        route: settings.破限方案,
        format: settings.应答格式,
        streaming: settings.兼容假流式,
        placeholder: settings.密钥.trim() === configuration.placeholder,
    };
}

/** 凭据只保存在 fetch 闭包中；面板和可持久化设置始终使用占位值。 */
function installTransport(configuration) {
    const state = window.__mvuConfiguredLive;
    const observation = state.observation;
    state.stage = 'transport';
    const secret = configuration.apiKey;
    const redact = value =>
        String(value)
            .replaceAll(secret, '<redacted>')
            .replace(/AIza[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{12,}/g, '<redacted>');
    const wrappers = [];
    for (const [realm, original] of [
        [window, state.originalTopFetch],
        [state.frame, state.originalFrameFetch],
    ]) {
        const wrapped = async (input, init) => {
            const url = new URL(
                typeof input === 'string' ? input : input.url || String(input),
                window.location.href
            );
            const request = new realm.Request(
                typeof input === 'string' ? url : input.clone?.() || input,
                init
            );
            const body =
                request.method === 'POST'
                    ? await request
                          .clone()
                          .json()
                          .catch(() => undefined)
                    : undefined;
            if (
                url.origin === window.location.origin &&
                url.pathname.endsWith('/generate') &&
                String(body?.model || '').startsWith('mvu-pi-prompt-capture:')
            ) {
                observation.captureRequests += 1;
                const firstUser = body.messages.findIndex(message => message.role === 'user');
                observation.intermediateSystemsCaptured =
                    firstUser >= 0 &&
                    body.messages.slice(firstUser + 1).some(message => message.role === 'system');
            }
            const generation =
                url.origin === configuration.origin &&
                request.method === 'POST' &&
                (url.pathname.endsWith('/responses') ||
                    url.pathname.endsWith('/chat/completions') ||
                    url.pathname.endsWith('/messages') ||
                    /:(streamGenerateContent|generateContent)$/.test(url.pathname));
            if (!generation) return original.call(realm, input, init);
            if (observation.requests.length)
                throw new realm.DOMException('Live test permits one request', 'AbortError');
            const expectedAuth =
                configuration.authHeader === 'authorization'
                    ? 'Bearer ' + configuration.placeholder
                    : configuration.placeholder;
            const headers = new realm.Headers(request.headers);
            const record = {
                path: url.pathname,
                authMatched: headers.get(configuration.authHeader) === expectedAuth,
                signalPresent: request.signal instanceof realm.AbortSignal,
                streaming:
                    configuration.provider === 'google'
                        ? url.pathname.endsWith(':streamGenerateContent')
                        : body?.stream === true,
                hasTool: JSON.stringify(body?.tools || []).length > 2,
                hasSchema: /response(JsonSchema|Schema|_format)|json_schema/.test(
                    JSON.stringify(body)
                ),
                hasJsonObject: JSON.stringify(body).includes('"type":"json_object"'),
                instructionPresent: JSON.stringify(body).includes(
                    'MVU_CONFIGURED_LIVE_INSTRUCTION'
                ),
                anchorsAbsent: !JSON.stringify(body).includes('__mvu_pi_system_anchor_'),
                status: null,
            };
            observation.requests.push(record);
            if (!record.authMatched) throw new Error('Credential placeholder mismatch');
            headers.set(
                configuration.authHeader,
                configuration.authHeader === 'authorization' ? 'Bearer ' + secret : secret
            );
            request.signal.addEventListener(
                'abort',
                () => {
                    observation.abortObserved = true;
                },
                { once: true }
            );
            const outbound = new realm.Request(request, { headers });
            try {
                const response = await original.call(realm, outbound);
                record.status = response.status;
                record.responseType = response.type;
                record.contentType = response.headers.get('content-type')?.split(';')[0];
                if (!response.ok) {
                    const error = await response
                        .clone()
                        .json()
                        .catch(() => ({}));
                    record.providerError = redact(
                        error?.error?.message || error?.message || 'HTTP error'
                    ).slice(0, 600);
                }
                if (configuration.abort) {
                    const stop = document.getElementById('mes_stop');
                    observation.stopClicked = !!stop && getComputedStyle(stop).display !== 'none';
                    stop?.click();
                }
                return response;
            } catch (error) {
                record.fetchError = ['AbortError', 'TypeError'].includes(error?.name)
                    ? error.name
                    : 'Error';
                throw error;
            }
        };
        realm.fetch = wrapped;
        wrappers.push([realm, original, wrapped]);
    }
    state.cleanupTransport = () => {
        for (const [realm, original] of wrappers) realm.fetch = original;
        delete state.cleanupTransport;
    };
    state.stage = 'invoke';
    Promise.resolve()
        .then(() => state.retry())
        .then(
            () => {
                state.invocation.settled = true;
            },
            () => {
                Object.assign(state.invocation, { settled: true, rejected: true });
            }
        );
    return { started: true };
}

function readCase() {
    const state = window.__mvuConfiguredLive;
    const data = window.Mvu.getMvuData({ type: 'message', message_id: 'latest' });
    const value = data?.stat_data?.理?.好感度;
    return {
        ...state.observation,
        ...state.invocation,
        value: Array.isArray(value) ? value[0] : value,
        analysisEnded: window.Mvu.isDuringExtraAnalysis() === false,
        updateWritten: String(window.SillyTavern.getContext().chat.at(-1)?.mes || '').includes(
            '<UpdateVariable>'
        ),
    };
}

export async function runPiStConfiguredLiveSmoke(options) {
    const { webDriver, scriptName } = options;
    await mkdir(outputDirectory, { recursive: true });
    const prepared = await browserCall(webDriver, prepareBrowser, { scriptName, otherPreset });
    const scenarios = livePiCases
        .filter(isLivePiCaseEnabled)
        .flatMap(testCase => {
            const origin = new URL(testCase.endpoint).origin;
            const base = {
                ...testCase,
                origin,
                placeholder: 'mvu-live-placeholder-' + testCase.name,
                authHeader:
                    testCase.provider === 'google'
                        ? 'x-goog-api-key'
                        : testCase.provider === 'anthropic'
                          ? 'x-api-key'
                          : 'authorization',
                customHeaders:
                    testCase.provider === 'anthropic' && origin === 'https://openrouter.ai'
                        ? 'anthropic-version: null\nanthropic-beta: null\nanthropic-dangerous-direct-browser-access: null'
                        : '',
                otherPreset,
                injectionId,
            };
            return [
                ...routes.flatMap(([name, route], index) => [
                    {
                        ...base,
                        id: `${testCase.name}/${name}/text`,
                        route,
                        format: '聊天消息',
                        streaming: index !== 1,
                    },
                    {
                        ...base,
                        id: `${testCase.name}/${name}/tool`,
                        route,
                        format: '工具调用',
                        streaming: true,
                    },
                    {
                        ...base,
                        id: `${testCase.name}/${name}/schema`,
                        route,
                        format: '格式化输出',
                        streaming: false,
                    },
                ]),
                ...(testCase.provider === 'openai'
                    ? [
                          {
                              ...base,
                              id: `${testCase.name}/current/json-object`,
                              route: routes[0][1],
                              format: '格式化输出(v4兼容)',
                              streaming: false,
                          },
                      ]
                    : []),
                ...(['GOOGLE', 'RESPONSES'].includes(testCase.name)
                    ? [
                          {
                              ...base,
                              id: `${testCase.name}/current/abort`,
                              route: routes[0][1],
                              format: '聊天消息',
                              streaming: true,
                              abort: true,
                          },
                      ]
                    : []),
            ];
        })
        .filter(scenario => {
            const filters = (process.env.MVU_PI_ST_CONFIGURED_CASE || '')
                .split(',')
                .filter(Boolean);
            return !filters.length || filters.some(filter => scenario.id.includes(filter));
        });
    requireCheck(scenarios.length, 'no-configured-live-cases');
    const report = {
        ok: false,
        scope: 'real-sillytavern-browser-provider-requests',
        character: prepared.character,
        artifactHash: options.artifactHash,
        browserVersion: options.browserVersion,
        cases: [],
        checks: {
            artifactLoaded: options.artifactBundleRequests > 0,
            firefoxProfileTemporary: options.firefoxProfileTemporary,
        },
    };
    try {
        for (const [index, scenario] of scenarios.entries()) {
            const testCase = { ...scenario, value: 7 + index };
            process.stderr.write(`[pi-st-live] ${testCase.id}\n`);
            const result = {
                id: testCase.id,
                model: testCase.model,
                route: testCase.route,
                responseFormat: testCase.format,
                streaming: testCase.streaming,
                expectedValue: testCase.abort ? 0 : testCase.value,
                ok: false,
            };
            report.cases.push(result);
            try {
                const configured = await browserCall(webDriver, configureCase, testCase);
                requireCheck(
                    configured.placeholder &&
                        configured.provider === testCase.provider &&
                        configured.api === testCase.api &&
                        configured.model === testCase.model &&
                        configured.route === testCase.route &&
                        configured.format === testCase.format &&
                        configured.streaming === testCase.streaming,
                    'configuration-mismatch'
                );
                await browserCall(webDriver, installTransport, testCase);
                const deadline = Date.now() + 60_000;
                do {
                    await delay(250);
                    result.evidence = await webDriver.execute(`return (${readCase.toString()})();`);
                } while (!result.evidence.settled && Date.now() < deadline);
                const evidence = result.evidence;
                const request = evidence.requests[0];
                requireCheck(evidence.settled, 'invocation-timeout');
                requireCheck(
                    evidence.captureRequests === 1 && evidence.intermediateSystemsCaptured,
                    'capture-layout-mismatch'
                );
                requireCheck(
                    evidence.requests.length === 1 &&
                        request?.authMatched &&
                        request.signalPresent &&
                        request.anchorsAbsent &&
                        request.instructionPresent &&
                        request.streaming === testCase.streaming,
                    'request-evidence-mismatch'
                );
                requireCheck(request.status >= 200 && request.status < 300, 'provider-http-error');
                requireCheck(request.responseType === 'cors', 'browser-cors-not-observed');
                requireCheck(evidence.analysisEnded, 'analysis-still-active');
                if (testCase.abort) {
                    requireCheck(
                        evidence.stopClicked &&
                            evidence.abortObserved &&
                            !evidence.updateWritten &&
                            evidence.value === 0,
                        'cancel-did-not-preserve-state'
                    );
                } else {
                    requireCheck(
                        !evidence.rejected &&
                            evidence.updateWritten &&
                            evidence.value === testCase.value,
                        'variable-result-mismatch'
                    );
                    if (testCase.format === '工具调用')
                        requireCheck(request.hasTool, 'missing-tool-definition');
                    if (testCase.format === '格式化输出')
                        requireCheck(request.hasSchema, 'missing-schema');
                    if (testCase.format === '格式化输出(v4兼容)')
                        requireCheck(request.hasJsonObject, 'missing-json-object-format');
                }
                result.ok = true;
            } catch (error) {
                result.error = error?.code || 'live-case-failed';
                await webDriver
                    .execute(
                        `document.getElementById('mes_stop')?.click(); window.__mvuConfiguredLive?.cleanupTransport?.();`
                    )
                    .catch(() => {});
            }
            await writeFile(
                resolve(outputDirectory, 'configured-cases.json'),
                JSON.stringify(report, null, 2)
            );
        }
    } finally {
        report.checks.fetchRestored = await webDriver
            .execute(
                `
            const state = window.__mvuConfiguredLive;
            state?.cleanupTransport?.();
            const restored = window.fetch === state.originalTopFetch && state.frame.fetch === state.originalFrameFetch;
            window.SillyTavern.getContext().setExtensionPrompt(arguments[0], '', 1, 0, false, 0);
            delete window.__mvuConfiguredLive;
            return restored;
        `,
                [injectionId]
            )
            .catch(() => false);
        report.ok =
            report.cases.length === scenarios.length &&
            report.cases.every(result => result.ok) &&
            Object.values(report.checks).every(Boolean);
        await writeFile(
            resolve(outputDirectory, 'configured-cases.json'),
            JSON.stringify(report, null, 2)
        );
    }
    requireCheck(report.ok, 'configured-live-cases-failed');
    return report;
}
