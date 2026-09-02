const CAPTURE_MODEL_PREFIX = 'mvu-pi-prompt-capture:';
const MAIN_MODEL = 'H03_MAIN_MODEL';
const MAIN_PROMPT_MARKER = 'H03_MAIN_ONLY_PROMPT';
const SEND_BUTTON_MAIN_MODEL = 'H03_SEND_BUTTON_MAIN_MODEL';
const SEND_BUTTON_USER_MARKER = 'H03_SEND_BUTTON_USER_MESSAGE';
const IMAGE_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfG8AAAAASUVORK5CYII=';
const LEGACY_OUTPUT_TEXT =
    "<UpdateVariable>\n_.set('\u7406.\u597d\u611f\u5ea6', 0, 7);\n</UpdateVariable>";

const PROVIDERS = Object.freeze({
    openai: Object.freeze({ api: 'openai-responses', model: 'gpt-4.1-mini' }),
    anthropic: Object.freeze({ api: 'anthropic-messages', model: 'claude-sonnet-4-5' }),
    google: Object.freeze({ api: 'google-generative-ai', model: 'gemini-2.5-flash' }),
});

class FeatureSmokeError extends Error {
    constructor(code) {
        super(code);
        this.name = 'FeatureSmokeError';
        this.code = code;
    }
}

function assertFeature(value, code) {
    if (!value) {
        throw new FeatureSmokeError(code);
    }
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const trace = label => {
    if (process.env.MVU_PI_ST_FEATURE_TRACE === '1') {
        process.stderr.write(`[pi-st-features] ${label}\n`);
    }
};

async function configurePi(webDriver, provider, responseFormat, apiOverride) {
    trace(`configure:${provider}:${responseFormat}:start`);
    const definition = PROVIDERS[provider];
    assertFeature(definition, `unknown-provider-${provider}`);
    const api = apiOverride ?? definition.api;
    const result = await webDriver.executeAsync(
        `
        const [scriptName, provider, api, model, responseFormat] = arguments;
        const done = arguments[arguments.length - 1];
        (async () => {
            const iframe = [...document.querySelectorAll('iframe')].find(frame =>
                frame.id.startsWith('TH-script--' + scriptName)
            );
            const state = window.__mvuFeatureSmoke;
            if (!iframe?.contentDocument || !state) return done({ ok: false, stage: 'missing-state' });
            const doc = iframe.contentDocument;
            const candidateDocuments = [document, doc];
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
                choose(['openai', 'openai-codex', 'anthropic', 'google'], provider);
                await tick();
                choose([api], api);
                await tick();

                const grid = candidateDocuments.flatMap(owner => [...owner.querySelectorAll('.mvu-field-grid')]).find(candidate =>
                    candidate.querySelector('.mvu-pi-model-controls')
                );
                if (!grid) throw new Error('pi-grid');
                const modelInput = grid.querySelector('.mvu-pi-model-controls input[type="text"]');
                const endpointInput = [...grid.querySelectorAll('input[type="text"]')].find(
                    input => input !== modelInput
                );
                if (endpointInput) setInput(endpointInput, '');
                const keyInput = grid.querySelector('input[type="password"]');
                if (keyInput) setInput(keyInput, state.fakeKeys[provider]);
                setInput(modelInput, model);
                await tick();
                const contextField = candidateDocuments
                    .flatMap(owner => [...owner.querySelectorAll('.mvu-field')])
                    .find(field => /context window|上下文窗口/i.test(
                        field.querySelector('.mvu-field__label')?.textContent || ''
                    ));
                const contextInput = contextField?.querySelector('input[type="number"]');
                if (!contextInput) throw new Error('context-window');
                setInput(contextInput, '');
                choose(['聊天消息', '工具调用', '格式化输出'], responseFormat);
                await tick();

                const source = candidateDocuments.flatMap(owner => [...owner.querySelectorAll('select')]).find(candidate =>
                    [...candidate.options].some(option => option.value === '更多')
                );
                const format = candidateDocuments.flatMap(owner => [...owner.querySelectorAll('select')]).find(candidate =>
                    [...candidate.options].some(option => option.value === '工具调用')
                );
                done({
                    ok: source?.value === '更多' && format?.value === responseFormat,
                    provider,
                    api,
                    modelValue: modelInput?.value,
                    keyPresent: Boolean(keyInput?.value),
                    endpointEmpty: !endpointInput || endpointInput.value === '',
                });
            } catch (error) {
                done({ ok: false, stage: String(error?.message || 'configure') });
            }
        })();
        `,
        [activeScriptName, provider, api, definition.model, responseFormat],
        30_000
    );
    assertFeature(
        result?.ok,
        `configure-${provider}-${responseFormat}-${result?.stage ?? 'failed'}`
    );
    assertFeature(result.api === api, `configure-api-${provider}`);
    assertFeature(result.modelValue === definition.model, `configure-model-${provider}`);
    assertFeature(result.keyPresent, `configure-key-${provider}`);
    assertFeature(result.endpointEmpty, `configure-endpoint-${provider}`);
    trace(`configure:${provider}:${responseFormat}:done`);
}

let activeScriptName = '';

async function invokeRetry(webDriver, scenario, { image = false, expectRejected = false } = {}) {
    trace(`invoke:${scenario}:start`);
    const started = await webDriver.execute(
        `
        const [scenario, injectImage] = arguments;
        const state = window.__mvuFeatureSmoke;
        if (!state?.retryHandler) return { started: false };
        state.scenario = scenario;
        state.injectImage = injectImage;
        state.scenarioStart = state.providerRequests.length;
        state.currentInvocation = { scenario, settled: false, rejected: false };
        setTimeout(() => {
            Promise.resolve().then(() => state.retryHandler()).then(
                () => { Object.assign(state.currentInvocation, { settled: true, rejected: false }); },
                () => { Object.assign(state.currentInvocation, { settled: true, rejected: true }); }
            );
        }, 250);
        return { started: true };
        `,
        [scenario, image]
    );
    assertFeature(started?.started, `invoke-not-started-${scenario}`);
    const deadline = Date.now() + 45_000;
    let result;
    while (Date.now() < deadline) {
        try {
            result = await webDriver.execute(
                `
            const state = window.__mvuFeatureSmoke;
            const invocation = state?.currentInvocation;
            return {
                settled: invocation?.scenario === arguments[0] && invocation.settled === true,
                rejected: invocation?.rejected === true,
                providerRequests: state ? state.providerRequests.length - state.scenarioStart : -1,
                captureRequests: state?.captureRequests ?? -1,
                lastRequest: state?.providerRequests.at(-1) || null,
            };
                `,
                [scenario],
                5_000
            );
        } catch {
            throw new FeatureSmokeError(
                `webdriver-poll-${scenario}-capture-${result?.captureRequests ?? 'unknown'}-provider-${result?.providerRequests ?? 'unknown'}`
            );
        }
        if (result?.settled) break;
        await wait(500);
    }
    assertFeature(result?.settled, `invoke-timeout-${scenario}`);
    assertFeature(result.rejected === expectRejected, `invoke-rejection-${scenario}`);
    trace(`invoke:${scenario}:done`);
    return result;
}

async function runAbortCase(webDriver, provider) {
    await configurePi(webDriver, provider, '聊天消息');
    const started = await webDriver.execute(
        `
        const state = window.__mvuFeatureSmoke;
        state.scenario = 'abort-' + arguments[0];
        state.scenarioStart = state.providerRequests.length;
        state.pendingInvocation = new Promise(resolve => setTimeout(resolve, 250))
            .then(() => state.retryHandler()).then(
                () => ({ settled: true, rejected: false }),
                () => ({ settled: true, rejected: true })
            );
        return true;
        `,
        [provider]
    );
    assertFeature(started, `abort-start-${provider}`);
    const reached = await webDriver.executeAsync(
        `
        const done = arguments[arguments.length - 1];
        const state = window.__mvuFeatureSmoke;
        const deadline = Date.now() + 30000;
        const poll = () => {
            const request = state.providerRequests.at(-1);
            if (request?.scenario === 'abort-' + arguments[0]) return done({ reached: true });
            if (Date.now() >= deadline) return done({ reached: false });
            setTimeout(poll, 50);
        };
        poll();
        `,
        [provider],
        35_000
    );
    assertFeature(reached?.reached, `abort-provider-not-reached-${provider}`);
    const stopped = await webDriver.executeAsync(
        `
        const done = arguments[arguments.length - 1];
        const state = window.__mvuFeatureSmoke;
        Promise.resolve().then(() => state.stopHandler());
        Promise.race([
            state.pendingInvocation,
            new Promise(resolve => setTimeout(() => resolve({ settled: false }), 10000)),
        ]).then(invocation => {
            const pending = state.pendingProvider;
            done({
                invocation,
                signalAborted: pending?.signal?.aborted === true,
                abortObserved: pending?.abortObserved === true,
            });
        });
        `,
        [],
        15_000
    );
    assertFeature(stopped?.invocation?.settled, `abort-invocation-unsettled-${provider}`);
    assertFeature(stopped.signalAborted && stopped.abortObserved, `abort-signal-${provider}`);
    return true;
}

async function configureLegacy(webDriver, source) {
    const result = await webDriver.executeAsync(
        `
        const [scriptName, source] = arguments;
        const done = arguments[arguments.length - 1];
        (async () => {
            const iframe = [...document.querySelectorAll('iframe')].find(frame =>
                frame.id.startsWith('TH-script--' + scriptName)
            );
            const doc = iframe?.contentDocument;
            if (!doc) return done({ ok: false });
            const select = [document, doc].flatMap(owner => [...owner.querySelectorAll('select')]).find(candidate => {
                const values = [...candidate.options].map(option => option.value);
                return ['与插头相同', '自定义', '更多'].every(value => values.includes(value));
            });
            select.value = source;
            select.dispatchEvent(new select.ownerDocument.defaultView.Event('change', { bubbles: true }));
            await new Promise(resolve => iframe.contentWindow.setTimeout(resolve, 100));
            if (source === '自定义') {
                const grid = [document, doc].flatMap(owner => [...owner.querySelectorAll('.mvu-field-grid')]).find(candidate =>
                    candidate.querySelector('input[type="password"]')
                );
                const texts = [...(grid?.querySelectorAll('input[type="text"]') || [])];
                const password = grid?.querySelector('input[type="password"]');
                const fire = (input, value) => {
                    input.value = value;
                    const EventConstructor = input.ownerDocument.defaultView.Event;
                    input.dispatchEvent(new EventConstructor('input', { bubbles: true }));
                    input.dispatchEvent(new EventConstructor('change', { bubbles: true }));
                };
                if (texts[0]) fire(texts[0], 'https://h03-legacy.invalid/v1');
                if (password) fire(password, 'H03_LEGACY_FAKE');
                if (texts.at(-1)) fire(texts.at(-1), 'H03_LEGACY_MODEL');
            }
            done({ ok: select.value === source });
        })().catch(() => done({ ok: false }));
        `,
        [activeScriptName, source],
        20_000
    );
    assertFeature(result?.ok, `legacy-configure-${source}`);
}

async function runConcurrency(webDriver) {
    await configurePi(webDriver, 'openai', '聊天消息');
    const setup = await webDriver.executeAsync(
        `
        const [mainModel, mainPromptMarker] = arguments;
        const done = arguments[arguments.length - 1];
        let stage = 'initialize';
        (async () => {
            const state = window.__mvuFeatureSmoke;
            const context = window.SillyTavern.getContext();
            const fire = (selector, value, eventName) => {
                const element = document.querySelector(selector);
                if (!element) throw new Error(selector);
                if (element.type === 'checkbox') element.checked = value;
                else element.value = value;
                element.dispatchEvent(new Event(eventName, { bubbles: true }));
            };
            stage = 'configure-main-api';
            fire('#main_api', 'openai', 'change');
            fire('#custom_api_url_text', 'https://h03-main.invalid/v1', 'input');
            fire('#custom_model_id', mainModel, 'input');
            fire('#stream_toggle', false, 'change');
            fire('#chat_completion_source', 'custom', 'change');
            stage = 'connect';
            document.querySelector('#api_button_openai')?.click();
            const connectionDeadline = Date.now() + 5000;
            while (
                (state.statusRequests === 0 ||
                    window.SillyTavern.getContext().onlineStatus === 'no_connection') &&
                Date.now() < connectionDeadline
            ) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            stage = 'prompt';
            state.scenario = 'concurrency';
            state.mainPromptMarker = mainPromptMarker;
            state.mainPromptSeen = false;
            state.mainPromptHasPiTask = false;
            state.piPromptHasMainMarker = false;
            stage = 'generate';
            state.mainInvocation = context.sendGenerationRequest('normal', {
                prompt: [{ role: 'user', content: mainPromptMarker }],
            }).then(
                () => ({ settled: true, rejected: false }),
                () => ({ settled: true, rejected: true })
            );
            const deadline = Date.now() + 20000;
            while (!state.mainPending && Date.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            done({
                reached: Boolean(state.mainPending),
                mainPromptSeen: state.mainPromptSeen,
                online: window.SillyTavern.getContext().onlineStatus !== 'no_connection',
                statusRequests: state.statusRequests,
            });
        })().catch(error => done({
            reached: false,
            stage: typeof stage === 'string' ? stage : 'unknown',
            errorName: String(error?.name || 'Error'),
        }));
        `,
        [MAIN_MODEL, MAIN_PROMPT_MARKER],
        30_000
    );
    assertFeature(
        setup?.reached && setup.mainPromptSeen,
        `concurrency-main-not-reached-stage-${setup?.stage ?? 'wait'}-error-${setup?.errorName ?? 'none'}-online-${Boolean(setup?.online)}-status-${setup?.statusRequests ?? 0}-prompt-${Boolean(setup?.mainPromptSeen)}`
    );

    const piStarted = await webDriver.execute(`
        const state = window.__mvuFeatureSmoke;
        state.piInvocation = new Promise(resolve => setTimeout(resolve, 250))
            .then(() => state.retryHandler()).then(
                () => ({ settled: true, rejected: false }),
                error => {
                    state.piInvocationError = {
                        name: String(error?.name || 'Error'),
                        code: String(error?.code || 'none'),
                        category: /abort|cancel|stop|中止|取消/i.test(String(error?.message || ''))
                            ? 'abort'
                            : /token|context|上下文/i.test(String(error?.message || ''))
                              ? 'token'
                              : /config|配置|provider|模型|model/i.test(String(error?.message || ''))
                                ? 'configuration'
                                : /prompt|捕获|生成/i.test(String(error?.message || ''))
                                  ? 'prompt'
                                  : 'other',
                    };
                    return { settled: true, rejected: true };
                }
            );
        return true;
    `);
    assertFeature(piStarted, 'concurrency-pi-not-started');
    const reached = await webDriver.executeAsync(
        `
        const done = arguments[arguments.length - 1];
        const state = window.__mvuFeatureSmoke;
        const deadline = Date.now() + 30000;
        const poll = () => {
            if (state.pendingProvider?.scenario === 'concurrency') return done({ reached: true });
            if (state.piInvocationError) return done({
                reached: false,
                captureRequests: state.captureRequests,
                providerRequests: state.providerRequests.length,
                extraAnalysis: window.Mvu?.isDuringExtraAnalysis?.() === true,
                errorName: state.piInvocationError.name,
                errorCode: state.piInvocationError.code,
                errorCategory: state.piInvocationError.category,
            });
            if (Date.now() >= deadline) return done({
                reached: false,
                captureRequests: state.captureRequests,
                providerRequests: state.providerRequests.length,
                extraAnalysis: window.Mvu?.isDuringExtraAnalysis?.() === true,
                errorName: state.piInvocationError?.name || 'none',
                errorCode: state.piInvocationError?.code || 'none',
                errorCategory: state.piInvocationError?.category || 'none',
            });
            setTimeout(poll, 50);
        };
        poll();
    `,
        [],
        35_000
    );
    assertFeature(
        reached?.reached,
        `concurrency-pi-provider-not-reached-capture-${reached?.captureRequests ?? 'unknown'}-provider-${reached?.providerRequests ?? 'unknown'}-active-${Boolean(reached?.extraAnalysis)}-error-${reached?.errorName ?? 'unknown'}-${reached?.errorCode ?? 'unknown'}-${reached?.errorCategory ?? 'unknown'}`
    );

    const evidence = await webDriver.executeAsync(
        `
        const done = arguments[arguments.length - 1];
        const state = window.__mvuFeatureSmoke;
        const context = window.SillyTavern.getContext();
        Promise.resolve().then(() => state.stopHandler());
        setTimeout(async () => {
            const piAborted = state.pendingProvider?.signal?.aborted === true;
            const mainAliveAfterPiStop = state.mainPending?.signal?.aborted === false;
            context.stopGeneration();
            const settled = await Promise.race([
                Promise.all([state.mainInvocation, state.piInvocation]).then(() => true),
                new Promise(resolve => setTimeout(() => resolve(false), 10000)),
            ]);
            done({
                settled,
                piAborted,
                mainAliveAfterPiStop,
                mainAbortedAfterOwnStop: state.mainPending?.signal?.aborted === true,
                mainModelMatches: state.mainModelMatches === true,
                mainSourceCustom: state.mainSourceCustom === true,
                mainPromptSeen: state.mainPromptSeen,
                mainPromptHasPiTask: state.mainPromptHasPiTask,
                piPromptHasMainMarker: state.piPromptHasMainMarker,
            });
        }, 100);
        `,
        [],
        15_000
    );
    assertFeature(evidence?.settled, 'concurrency-unsettled');
    assertFeature(evidence.piAborted, 'concurrency-pi-not-aborted');
    assertFeature(evidence.mainAliveAfterPiStop, 'concurrency-pi-stop-hit-main');
    assertFeature(evidence.mainAbortedAfterOwnStop, 'concurrency-main-not-aborted');
    assertFeature(evidence.mainModelMatches && evidence.mainSourceCustom, 'concurrency-main-route');
    assertFeature(
        evidence.mainPromptSeen && !evidence.mainPromptHasPiTask,
        'concurrency-main-prompt'
    );
    assertFeature(!evidence.piPromptHasMainMarker, 'concurrency-pi-prompt');
    return evidence;
}

async function runSendButtonConcurrency(webDriver) {
    await configurePi(webDriver, 'openai', '聊天消息');
    const setup = await webDriver.executeAsync(
        `
        const [mainModel, userMarker] = arguments;
        const done = arguments[arguments.length - 1];
        let stage = 'initialize';
        (async () => {
            const state = window.__mvuFeatureSmoke;
            const context = window.SillyTavern.getContext();
            const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
            const fire = (selector, value, eventName) => {
                const element = document.querySelector(selector);
                if (!element) throw new Error(selector);
                if (element.type === 'checkbox') element.checked = value;
                else element.value = value;
                element.dispatchEvent(new Event(eventName, { bubbles: true }));
            };

            stage = 'fresh-state';
            if (document.body.dataset.generating === 'true') {
                context.stopGeneration();
                const idleDeadline = Date.now() + 5000;
                while (
                    document.body.dataset.generating === 'true' &&
                    Date.now() < idleDeadline
                ) {
                    await delay(50);
                }
            }
            if (document.body.dataset.generating === 'true') throw new Error('generation-not-idle');
            context.activateSendButtons();

            stage = 'configure-main-api';
            fire('#main_api', 'openai', 'change');
            fire('#custom_api_url_text', 'https://h03-send-main.invalid/v1', 'input');
            fire('#custom_model_id', mainModel, 'input');
            fire('#stream_toggle', false, 'change');
            fire('#chat_completion_source', 'custom', 'change');
            stage = 'connect';
            const statusRequestsBeforeConnect = state.statusRequests;
            document.querySelector('#api_button_openai')?.click();
            const connectionDeadline = Date.now() + 15000;
            while (
                (state.statusRequests === statusRequestsBeforeConnect ||
                    window.SillyTavern.getContext().onlineStatus === 'no_connection') &&
                Date.now() < connectionDeadline
            ) {
                await delay(100);
            }
            if (window.SillyTavern.getContext().onlineStatus === 'no_connection') {
                throw new Error('main-offline');
            }

            stage = 'listeners';
            state.scenario = 'send-button-concurrency';
            state.sendMainModel = mainModel;
            state.sendUserMarker = userMarker;
            state.sendMainPending = null;
            state.sendPiPromptSeen = false;
            state.sendPiPromptHasUserMarker = false;
            state.sendPiPromptHasPiTask = false;
            state.sendMainReadyCount = 0;
            state.sendCaptureReadyCount = 0;
            state.sendEvents = {
                generationStarted: 0,
                generationStartedNormal: 0,
                generationAfterCommands: 0,
                messageSent: 0,
                generationStopped: 0,
                generationEnded: 0,
                unhandledRejection: 0,
            };
            const eventTypes = context.eventTypes;
            const listeners = {
                generationStarted: type => {
                    state.sendEvents.generationStarted += 1;
                    if (type === 'normal') state.sendEvents.generationStartedNormal += 1;
                },
                generationAfterCommands: () => { state.sendEvents.generationAfterCommands += 1; },
                messageSent: () => { state.sendEvents.messageSent += 1; },
                generationStopped: () => { state.sendEvents.generationStopped += 1; },
                generationEnded: () => { state.sendEvents.generationEnded += 1; },
                unhandledRejection: event => {
                    state.sendEvents.unhandledRejection += 1;
                    state.sendUnhandledName = String(event?.reason?.name || 'Error');
                    const rawMessage = String(event?.reason?.message || '');
                    let safeMessage = rawMessage.replaceAll(
                        'https://h03-send-main.invalid/v1',
                        '<fake-url>'
                    );
                    for (const fakeKey of Object.values(state.fakeKeys)) {
                        safeMessage = safeMessage.replaceAll(fakeKey, '<fake-key>');
                    }
                    state.sendUnhandledMessage =
                        state.sendUnhandledName === 'TypeError'
                            ? safeMessage.slice(0, 160)
                            : 'other-message-length-' + rawMessage.length;
                    state.sendUnhandledCategory = /server|ping|network/i.test(rawMessage)
                        ? 'network'
                        : /command|slash/i.test(rawMessage)
                          ? 'command'
                          : 'other';
                },
            };
            context.eventSource.on(eventTypes.GENERATION_STARTED, listeners.generationStarted);
            context.eventSource.on(eventTypes.GENERATION_AFTER_COMMANDS, listeners.generationAfterCommands);
            context.eventSource.on(eventTypes.MESSAGE_SENT, listeners.messageSent);
            context.eventSource.on(eventTypes.GENERATION_STOPPED, listeners.generationStopped);
            context.eventSource.on(eventTypes.GENERATION_ENDED, listeners.generationEnded);
            window.addEventListener('unhandledrejection', listeners.unhandledRejection);
            state.sendEventListeners = { eventTypes, listeners };

            stage = 'pi-provider';
            state.sendPiInvocation = new Promise(resolve => setTimeout(resolve, 250))
                .then(() => state.retryHandler()).then(
                    () => ({ settled: true, rejected: false }),
                    error => ({
                        settled: true,
                        rejected: true,
                        name: String(error?.name || 'Error'),
                        code: String(error?.code || 'none'),
                    })
                ).then(result => {
                    state.sendPiInvocationResult = result;
                    return result;
                });
            const piDeadline = Date.now() + 30000;
            while (
                state.pendingProvider?.scenario !== 'send-button-concurrency' &&
                !state.sendPiInvocationResult &&
                Date.now() < piDeadline
            ) {
                await delay(50);
            }
            if (state.pendingProvider?.scenario !== 'send-button-concurrency') {
                const result = state.sendPiInvocationResult;
                throw new Error(
                    'pi-not-pending-' +
                        state.sendCaptureReadyCount +
                        '-' +
                        Boolean(result?.settled) +
                        '-' +
                        Boolean(result?.rejected) +
                        '-' +
                        String(result?.name || 'none') +
                        '-' +
                        String(result?.code || 'none')
                );
            }

            stage = 'send-button';
            const textarea = document.querySelector('#send_textarea');
            const sendButton = document.querySelector('#send_but');
            if (!textarea || !sendButton) throw new Error('send-controls-missing');
            const chatLengthBefore = context.chat.length;
            textarea.value = userMarker;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            textarea.focus();
            sendButton.click();

            const requestDeadline = Date.now() + 30000;
            while (!state.sendMainPending && Date.now() < requestDeadline) await delay(50);
            const userMessages = context.chat.filter(
                message => message?.is_user === true && message?.mes === userMarker
            );
            done({
                reached: Boolean(state.sendMainPending),
                stage,
                online: window.SillyTavern.getContext().onlineStatus !== 'no_connection',
                isGenerating: document.body.dataset.generating === 'true',
                textareaCleared: textarea.value === '',
                chatDelta: context.chat.length - chatLengthBefore,
                userMessageCount: userMessages.length,
                events: { ...state.sendEvents },
                readyCount: state.sendMainReadyCount,
                mainPromptSeen: state.sendMainPromptSeen === true,
                mainPromptHasPiTask: state.sendMainPromptHasPiTask === true,
                mainFetchPromptSeen: state.sendMainFetchPromptSeen === true,
                mainFetchHasPiTask: state.sendMainFetchHasPiTask === true,
                mainModelMatches: state.sendMainModelMatches === true,
                mainSourceCustom: state.sendMainSourceCustom === true,
                captureReadyCount: state.sendCaptureReadyCount,
                piPromptSeen: state.sendPiPromptSeen,
                piPromptHasUserMarker: state.sendPiPromptHasUserMarker,
                piPromptHasPiTask: state.sendPiPromptHasPiTask,
                buttonDisabled: sendButton.matches(':disabled'),
                unhandledName: state.sendUnhandledName || 'none',
                unhandledCategory: state.sendUnhandledCategory || 'none',
                unhandledMessage: state.sendUnhandledMessage || 'none',
            });
        })().catch(error => done({
            reached: false,
            stage,
            errorName: String(error?.name || 'Error'),
            errorCode: String(error?.message || 'unknown').slice(0, 80),
        }));
        `,
        [SEND_BUTTON_MAIN_MODEL, SEND_BUTTON_USER_MARKER],
        75_000
    );
    assertFeature(
        setup?.reached,
        `send-button-main-not-reached-stage-${setup?.stage ?? 'wait'}-error-${setup?.errorName ?? 'none'}-${setup?.errorCode ?? 'none'}-online-${Boolean(setup?.online)}-generating-${Boolean(setup?.isGenerating)}-events-${setup?.events?.generationStarted ?? 0}-${setup?.events?.generationStartedNormal ?? 0}-${setup?.events?.generationAfterCommands ?? 0}-${setup?.events?.messageSent ?? 0}-${setup?.events?.generationStopped ?? 0}-${setup?.events?.generationEnded ?? 0}-ready-${setup?.readyCount ?? 0}-chat-${setup?.chatDelta ?? 'unknown'}-${setup?.userMessageCount ?? 'unknown'}-textarea-${Boolean(setup?.textareaCleared)}-unhandled-${setup?.events?.unhandledRejection ?? 0}-${setup?.unhandledName ?? 'none'}-${setup?.unhandledCategory ?? 'none'}-${setup?.unhandledMessage ?? 'none'}`
    );
    assertFeature(
        setup.textareaCleared && setup.chatDelta >= 1 && setup.userMessageCount === 1,
        'send-button-user-message'
    );
    assertFeature(
        setup.events?.generationStarted >= 1 &&
            setup.events?.generationAfterCommands >= 1 &&
            setup.events?.messageSent >= 1,
        'send-button-generation-events'
    );
    assertFeature(
        setup.readyCount === 1 &&
            setup.mainPromptSeen &&
            setup.mainFetchPromptSeen &&
            !setup.mainPromptHasPiTask &&
            !setup.mainFetchHasPiTask &&
            setup.mainModelMatches &&
            setup.mainSourceCustom,
        'send-button-main-prompt'
    );
    assertFeature(
        setup.captureReadyCount === 1 &&
            setup.piPromptSeen &&
            !setup.piPromptHasUserMarker &&
            setup.piPromptHasPiTask,
        'send-button-pi-prompt'
    );

    const evidence = await webDriver.executeAsync(
        `
        const done = arguments[arguments.length - 1];
        (async () => {
            const state = window.__mvuFeatureSmoke;
            const context = window.SillyTavern.getContext();
            const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
            await Promise.resolve(state.stopHandler());
            await delay(100);
            const piPending = state.pendingProvider;
            const piAborted = piPending?.signal?.aborted === true && piPending?.abortObserved === true;
            const mainAliveAfterPiStop =
                state.sendMainPending?.signal?.aborted === false &&
                state.sendMainPending?.abortObserved === false;
            const providerCountBeforeMainStop = state.providerRequests.length;
            const stopButton = document.querySelector('#mes_stop');
            const stopButtonPresent = Boolean(stopButton);
            const stopButtonVisible =
                Boolean(stopButton) && window.getComputedStyle(stopButton).display !== 'none';
            const generationStoppedBeforeMainStop = state.sendEvents.generationStopped;
            stopButton?.click();
            const idleDeadline = Date.now() + 10000;
            while (
                (!state.sendMainPending?.abortObserved ||
                    document.body.dataset.generating === 'true') &&
                Date.now() < idleDeadline
            ) {
                await delay(50);
            }
            const piInvocation = await Promise.race([
                state.sendPiInvocation,
                delay(10000).then(() => ({ settled: false })),
            ]);
            const registration = state.sendEventListeners;
            if (registration) {
                const { eventTypes, listeners } = registration;
                context.eventSource.removeListener(eventTypes.GENERATION_STARTED, listeners.generationStarted);
                context.eventSource.removeListener(
                    eventTypes.GENERATION_AFTER_COMMANDS,
                    listeners.generationAfterCommands
                );
                context.eventSource.removeListener(eventTypes.MESSAGE_SENT, listeners.messageSent);
                context.eventSource.removeListener(
                    eventTypes.GENERATION_STOPPED,
                    listeners.generationStopped
                );
                context.eventSource.removeListener(eventTypes.GENERATION_ENDED, listeners.generationEnded);
                window.removeEventListener('unhandledrejection', listeners.unhandledRejection);
                state.sendEventListeners = null;
            }
            done({
                piInvocation,
                piAborted,
                mainAliveAfterPiStop,
                mainAbortedAfterOwnStop:
                    state.sendMainPending?.signal?.aborted === true &&
                    state.sendMainPending?.abortObserved === true,
                mainStopDidNotDispatchProvider:
                    state.providerRequests.length === providerCountBeforeMainStop,
                mainStopEventObserved:
                    state.sendEvents.generationStopped > generationStoppedBeforeMainStop,
                stopButtonPresent,
                stopButtonVisible,
                generationIdle: document.body.dataset.generating !== 'true',
                textareaEmpty: document.querySelector('#send_textarea')?.value === '',
                userMessageStillPresent: context.chat.some(
                    message => message?.is_user === true && message?.mes === state.sendUserMarker
                ),
                events: { ...state.sendEvents },
            });
        })().catch(error => done({
            errorName: String(error?.name || 'Error'),
            errorCode: String(error?.message || 'unknown').slice(0, 80),
        }));
        `,
        [],
        25_000
    );
    assertFeature(
        evidence?.piInvocation?.settled,
        `send-button-pi-unsettled-${evidence?.errorName ?? 'none'}-${evidence?.errorCode ?? 'none'}`
    );
    assertFeature(evidence.piAborted, 'send-button-pi-not-aborted');
    assertFeature(evidence.mainAliveAfterPiStop, 'send-button-pi-stop-hit-main');
    assertFeature(
        evidence.stopButtonPresent && evidence.stopButtonVisible,
        'send-button-main-stop-missing'
    );
    assertFeature(evidence.mainAbortedAfterOwnStop, 'send-button-main-not-aborted');
    assertFeature(evidence.mainStopEventObserved, 'send-button-main-stop-event');
    assertFeature(evidence.mainStopDidNotDispatchProvider, 'send-button-main-stop-hit-pi');
    assertFeature(evidence.generationIdle, 'send-button-generation-not-idle');
    assertFeature(
        evidence.textareaEmpty && evidence.userMessageStillPresent,
        'send-button-final-chat'
    );
    assertFeature(evidence.events?.generationStopped >= 1, 'send-button-stop-event');
    return { ...setup, ...evidence };
}

export async function runPiStFeatureSmoke({
    webDriver,
    scriptName,
    artifactBundleRequests,
    artifactHashStable,
    firefoxProfileTemporary,
    embeddedScriptsRejected,
}) {
    activeScriptName = scriptName;
    const installed = await webDriver.execute(
        `
        const [scriptName, capturePrefix, imageDataUrl, mainModel, mainPromptMarker, legacyOutputText] = arguments;
        let stage = 'start';
        try {
            const context = window.SillyTavern.getContext();
            const helper = window.TavernHelper;
            const iframe = [...document.querySelectorAll('iframe')].find(frame =>
                frame.id.startsWith('TH-script--' + scriptName)
            );
            if (!iframe?.contentWindow) return { ok: false, stage: 'iframe' };
            const retryEvent = iframe.contentWindow.getButtonEvent('重试额外模型解析');
            const stopEvent = iframe.contentWindow.getButtonEvent('停止 Pi 额外模型解析');
            const retryHandlers = context.eventSource?.events?.[retryEvent];
            const stopHandlers = context.eventSource?.events?.[stopEvent];
            if (!retryHandlers?.length || !stopHandlers?.length) return { ok: false, stage: 'handlers' };

            const state = {
                originalTopFetch: window.fetch,
                originalFrameFetch: iframe.contentWindow.fetch,
                frame: iframe.contentWindow,
                retryHandler: retryHandlers.at(-1),
                stopHandler: stopHandlers.at(-1),
                scenario: 'idle',
                injectImage: false,
                providerRequests: [],
                captureRequests: 0,
                legacyRequests: 0,
                statusRequests: 0,
                unexpectedExternal: 0,
                fakeKeys: {
                    openai: 'H03_OPENAI_FAKE',
                    anthropic: 'H03_ANTHROPIC_FAKE',
                    google: 'H03_GOOGLE_FAKE',
                },
                mainModel,
                mainPromptMarker,
            };
            const jsonResponse = (realm, value) => new realm.Response(JSON.stringify(value), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
            const abortError = realm => new realm.DOMException('Aborted', 'AbortError');
            const pending = (realm, signal, target) => new Promise((resolve, reject) => {
                target.signal = signal;
                const abort = () => {
                    target.abortObserved = true;
                    reject(abortError(realm));
                };
                if (signal?.aborted) abort();
                else signal?.addEventListener('abort', abort, { once: true });
            });
            const sse = (realm, lines) => new realm.Response(lines.join(''), {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
            });
            const dataLine = value => 'data: ' + JSON.stringify(value) + '\\n\\n';
            const eventLine = value => 'event: ' + value.type + '\\n' + dataLine(value);
            const outputText = '<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>';
            const structuredText = JSON.stringify({ analysis: 'mock', json_patch: [] });

            window.fetch = async function(input, init = {}) {
                const rawUrl = typeof input === 'string' ? input : input?.url;
                let url;
                try { url = new URL(rawUrl, window.location.href); } catch {
                    return state.originalTopFetch.call(window, input, init);
                }
                if (url.origin !== window.location.origin) {
                    state.unexpectedExternal += 1;
                    return Promise.reject(new Error('unexpected-external-fetch'));
                }
                if (url.pathname === '/api/backends/chat-completions/status') {
                    state.statusRequests += 1;
                    return jsonResponse(window, { data: [], bypass: true });
                }
                if (url.pathname !== '/api/backends/chat-completions/generate') {
                    return state.originalTopFetch.call(window, input, init);
                }
                let body = {};
                try { body = JSON.parse(typeof init.body === 'string' ? init.body : '{}'); } catch {}
                const signal = init.signal || input?.signal;
                if (typeof body.model === 'string' && body.model.startsWith(capturePrefix)) {
                    state.captureRequests += 1;
                    return Promise.reject(abortError(window));
                }
                if (state.scenario === 'concurrency') {
                    state.mainModelMatches = body.model === state.mainModel;
                    state.mainSourceCustom = body.chat_completion_source === 'custom';
                    state.mainPending = { signal, abortObserved: false };
                    return pending(window, signal, state.mainPending);
                }
                if (state.scenario === 'send-button-concurrency') {
                    const promptText = JSON.stringify(body.messages ?? body.prompt ?? []);
                    state.sendMainModelMatches = body.model === state.sendMainModel;
                    state.sendMainSourceCustom = body.chat_completion_source === 'custom';
                    state.sendMainFetchPromptSeen = promptText.includes(state.sendUserMarker);
                    state.sendMainFetchHasPiTask = promptText.includes('<must>');
                    state.sendMainPending = { signal, abortObserved: false };
                    return pending(window, signal, state.sendMainPending);
                }
                state.legacyRequests += 1;
                state.lastLegacy = {
                    source: body.chat_completion_source || '',
                    signalPresent: Boolean(signal),
                    responseText: legacyOutputText,
                };
                return jsonResponse(window, {
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content: legacyOutputText },
                        finish_reason: 'stop',
                    }],
                });
            };

            iframe.contentWindow.fetch = async function(input, init = {}) {
                const rawUrl = typeof input === 'string' ? input : input?.url;
                const url = new iframe.contentWindow.URL(rawUrl, iframe.contentWindow.location.href);
                const sameOrigin = url.origin === iframe.contentWindow.location.origin ||
                    url.origin === window.location.origin;
                let api = '';
                if (url.hostname === 'api.openai.com' && url.pathname.endsWith('/responses')) api = 'openai-responses';
                else if (url.hostname === 'api.openai.com' && url.pathname.endsWith('/chat/completions')) api = 'openai-completions';
                else if (url.hostname === 'api.anthropic.com' && url.pathname.endsWith('/messages')) api = 'anthropic-messages';
                else if (url.hostname === 'generativelanguage.googleapis.com' && url.pathname.includes(':streamGenerateContent')) api = 'google-generative-ai';
                if (!api) {
                    if (sameOrigin) {
                        return state.originalFrameFetch.call(iframe.contentWindow, input, init);
                    }
                    state.unexpectedExternal += 1;
                    return Promise.reject(new Error('unexpected-external-fetch'));
                }

                let bodyText = typeof init.body === 'string' ? init.body : '';
                if (!bodyText && input?.clone) {
                    try { bodyText = await input.clone().text(); } catch {}
                }
                let body = {};
                try { body = JSON.parse(bodyText || '{}'); } catch {}
                const headers = new iframe.contentWindow.Headers(input?.headers || undefined);
                new iframe.contentWindow.Headers(init.headers || undefined).forEach((value, key) => headers.set(key, value));
                const signal = init.signal || input?.signal;
                const provider = api.startsWith('openai') ? 'openai' : api.startsWith('anthropic') ? 'anthropic' : 'google';
                const key = state.fakeKeys[provider];
                const authOk = provider === 'openai'
                    ? headers.get('authorization') === 'Bearer ' + key
                    : provider === 'anthropic'
                      ? headers.get('x-api-key') === key
                      : headers.get('x-goog-api-key') === key || url.searchParams.get('key') === key;
                const serialized = JSON.stringify(body);
                const tools = Array.isArray(body.tools) ? body.tools : [];
                const toolName = api === 'openai-responses'
                    ? tools[0]?.name
                    : api === 'openai-completions'
                      ? tools[0]?.function?.name
                      : api === 'anthropic-messages'
                        ? tools[0]?.name
                        : body.tools?.[0]?.functionDeclarations?.[0]?.name;
                const request = {
                    scenario: state.scenario,
                    provider,
                    api,
                    signalPresent: Boolean(signal),
                    authOk,
                    hasTool: Boolean(toolName),
                    requiredToolChoice: api === 'openai-responses'
                        ? body.tool_choice === 'required'
                        : api === 'anthropic-messages'
                          ? body.tool_choice?.type === 'any' || body.tool_choice?.type === 'tool'
                          : api === 'google-generative-ai'
                            ? serialized.includes('ANY')
                            : body.tool_choice === 'required',
                    hasDataImage: serialized.includes('data:image/png;base64') ||
                        (serialized.includes('image/png') && serialized.includes('iVBORw0KGgo')),
                    hasNativeSchema: api === 'openai-responses'
                        ? body.text?.format?.type === 'json_schema'
                        : /response_?mime_?type|responseMimeType/.test(serialized) &&
                          serialized.includes('application/json'),
                };
                state.providerRequests.push(request);
                if (
                    state.scenario === 'concurrency' ||
                    state.scenario === 'send-button-concurrency' ||
                    state.scenario.startsWith('abort-')
                ) {
                    state.pendingProvider = { signal, abortObserved: false, scenario: state.scenario };
                    return pending(iframe.contentWindow, signal, state.pendingProvider);
                }

                const args = JSON.stringify({ analysis: 'mock', delta: '[    ]' });
                const wantsTool = state.scenario.startsWith('tool-');
                const wantsStructured = state.scenario === 'structured-google';
                if (api === 'openai-responses') {
                    const item = wantsTool
                        ? { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: toolName, arguments: args, status: 'completed' }
                        : { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: wantsStructured ? structuredText : outputText, annotations: [] }] };
                    return sse(iframe.contentWindow, [
                        dataLine({ type: 'response.created', response: { id: 'resp_1', status: 'in_progress' } }),
                        dataLine({ type: 'response.output_item.added', output_index: 0, item }),
                        dataLine({ type: 'response.output_item.done', output_index: 0, item }),
                        dataLine({ type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }),
                        'data: [DONE]\\n\\n',
                    ]);
                }
                if (api === 'openai-completions') {
                    const delta = wantsTool
                        ? { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: toolName, arguments: args } }] }
                        : { content: outputText };
                    return sse(iframe.contentWindow, [
                        dataLine({ id: 'chatcmpl_1', choices: [{ index: 0, delta, finish_reason: null }] }),
                        dataLine({ id: 'chatcmpl_1', choices: [{ index: 0, delta: {}, finish_reason: wantsTool ? 'tool_calls' : 'stop' }] }),
                        'data: [DONE]\\n\\n',
                    ]);
                }
                if (api === 'anthropic-messages') {
                    const block = wantsTool
                        ? { type: 'tool_use', id: 'toolu_1', name: toolName, input: {} }
                        : { type: 'text', text: '' };
                    const delta = wantsTool
                        ? { type: 'input_json_delta', partial_json: args }
                        : { type: 'text_delta', text: outputText };
                    return sse(iframe.contentWindow, [
                        eventLine({ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }),
                        eventLine({ type: 'content_block_start', index: 0, content_block: block }),
                        eventLine({ type: 'content_block_delta', index: 0, delta }),
                        eventLine({ type: 'content_block_stop', index: 0 }),
                        eventLine({ type: 'message_delta', delta: { stop_reason: wantsTool ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } }),
                        eventLine({ type: 'message_stop' }),
                    ]);
                }
                const part = wantsTool
                    ? { functionCall: { id: 'call_1', name: toolName, args: { analysis: 'mock', delta: '[    ]' } } }
                    : { text: wantsStructured ? structuredText : outputText };
                return sse(iframe.contentWindow, [dataLine({
                    responseId: 'resp_1',
                    candidates: [{ content: { role: 'model', parts: [part] }, finishReason: 'STOP' }],
                    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
                })]);
            };

            const readyEvent = helper.tavern_events?.CHAT_COMPLETION_SETTINGS_READY || 'chat_completion_settings_ready';
            state.readyEvent = readyEvent;
            state.readyListener = data => {
                const messages = Array.isArray(data?.messages) ? data.messages : [];
                const text = JSON.stringify(messages);
                if (data?.model === state.mainModel) {
                    state.mainPromptSeen = text.includes(state.mainPromptMarker);
                    state.mainPromptHasPiTask = text.includes('<must>');
                    return;
                }
                if (data?.model === state.sendMainModel) {
                    state.sendMainReadyCount += 1;
                    state.sendMainPromptSeen = text.includes(state.sendUserMarker);
                    state.sendMainPromptHasPiTask = text.includes('<must>');
                    return;
                }
                if (typeof data?.model !== 'string' || !data.model.startsWith(capturePrefix)) return;
                if (state.scenario === 'concurrency') {
                    state.piPromptHasMainMarker = text.includes(state.mainPromptMarker);
                }
                if (state.scenario === 'send-button-concurrency') {
                    state.sendCaptureReadyCount += 1;
                    state.sendPiPromptSeen = true;
                    state.sendPiPromptHasUserMarker = text.includes(state.sendUserMarker);
                    state.sendPiPromptHasPiTask = text.includes('<must>');
                }
                if (!state.injectImage) return;
                const user = [...messages].reverse().find(message => message?.role === 'user');
                if (!user) return;
                const original = typeof user.content === 'string' ? user.content : '';
                user.content = [
                    { type: 'text', text: original },
                    { type: 'image_url', image_url: { url: imageDataUrl } },
                ];
                state.injectImage = false;
            };
            context.eventSource.on(readyEvent, state.readyListener);
            window.__mvuFeatureSmoke = state;
            return { ok: true };
        } catch {
            return { ok: false, stage };
        }
        `,
        [
            scriptName,
            CAPTURE_MODEL_PREFIX,
            IMAGE_DATA_URL,
            MAIN_MODEL,
            MAIN_PROMPT_MARKER,
            LEGACY_OUTPUT_TEXT,
        ]
    );
    assertFeature(installed?.ok, `feature-install-${installed?.stage ?? 'failed'}`);
    trace('install:done');

    const checks = {};
    const concurrency = await runConcurrency(webDriver);
    checks.concurrentPromptIsolation =
        concurrency.mainPromptSeen &&
        !concurrency.mainPromptHasPiTask &&
        !concurrency.piPromptHasMainMarker;
    checks.concurrentStopIsolation =
        concurrency.piAborted &&
        concurrency.mainAliveAfterPiStop &&
        concurrency.mainAbortedAfterOwnStop;

    for (const testCase of [
        { provider: 'openai', api: 'openai-responses', name: 'openaiResponsesText' },
        { provider: 'openai', api: 'openai-completions', name: 'openaiCompletionsText' },
        { provider: 'anthropic', api: 'anthropic-messages', name: 'anthropicText' },
        { provider: 'google', api: 'google-generative-ai', name: 'googleText' },
    ]) {
        await configurePi(webDriver, testCase.provider, '聊天消息', testCase.api);
        const textResult = await invokeRetry(webDriver, `text-${testCase.api}`);
        checks[testCase.name] =
            textResult.providerRequests === 1 &&
            textResult.lastRequest?.provider === testCase.provider &&
            textResult.lastRequest?.api === testCase.api &&
            textResult.lastRequest?.authOk === true &&
            textResult.lastRequest?.hasTool === false;
    }

    for (const provider of ['openai', 'anthropic', 'google']) {
        await configurePi(webDriver, provider, '工具调用');
        const tool = await invokeRetry(webDriver, `tool-${provider}`, {
            image: provider === 'openai',
        });
        checks[`${provider}ToolRequest`] =
            tool.providerRequests === 1 &&
            tool.lastRequest?.provider === provider &&
            tool.lastRequest?.hasTool === true &&
            tool.lastRequest?.requiredToolChoice === true &&
            tool.lastRequest?.authOk === true;
        if (provider === 'openai') {
            checks.openaiDataUrlImage = tool.lastRequest?.hasDataImage === true;
        }
    }

    await configurePi(webDriver, 'google', '格式化输出');
    const structured = await invokeRetry(webDriver, 'structured-google');
    checks.googleNativeStructured =
        structured.providerRequests === 1 && structured.lastRequest?.hasNativeSchema === true;

    await configurePi(webDriver, 'anthropic', '格式化输出');
    const beforeUnsupported = await webDriver.execute(
        `return window.__mvuFeatureSmoke.providerRequests.length;`
    );
    const unsupported = await invokeRetry(webDriver, 'structured-anthropic', {
        expectRejected: true,
    });
    const afterUnsupported = await webDriver.execute(
        `return window.__mvuFeatureSmoke.providerRequests.length;`
    );
    checks.anthropicStructuredRejectedPreflight =
        unsupported.providerRequests === 0 && beforeUnsupported === afterUnsupported;

    for (const provider of ['openai', 'anthropic', 'google']) {
        checks[`${provider}Abort`] = await runAbortCase(webDriver, provider);
    }
    const legacyBaseline = await webDriver.executeAsync(
        `
        const done = arguments[arguments.length - 1];
        (async () => {
            const context = window.SillyTavern.getContext();
            const previousMessageId = context.chat.length - 2;
            const current = window.Mvu.getMvuData({ type: 'message', message_id: 'latest' });
            if (previousMessageId < 0 || !current?.stat_data) {
                return done({ ok: false, previousMessageId });
            }
            await window.Mvu.replaceMvuData(structuredClone(current), {
                type: 'message',
                message_id: previousMessageId,
            });
            const previous = window.Mvu.getMvuData({
                type: 'message',
                message_id: previousMessageId,
            });
            const affinity = previous?.stat_data?.['\u7406']?.['\u597d\u611f\u5ea6'];
            done({
                ok: Boolean(previous?.stat_data),
                previousMessageId,
                affinity: Array.isArray(affinity) ? affinity[0] : affinity,
            });
        })().catch(error => done({ ok: false, error: String(error?.message || error) }));
        `,
        [],
        15_000
    );
    assertFeature(
        legacyBaseline?.ok && legacyBaseline.affinity === 0,
        `legacy-baseline-${legacyBaseline?.error ?? legacyBaseline?.previousMessageId ?? 'missing'}`
    );
    const providerCountBeforeLegacy = await webDriver.execute(
        `return window.__mvuFeatureSmoke.providerRequests.length;`
    );
    const legacyFinalResults = [];
    for (const source of ['自定义', '与插头相同']) {
        await configureLegacy(webDriver, source);
        const before = await webDriver.execute(`
            const state = window.__mvuFeatureSmoke;
            return {
                providerRequests: state.providerRequests.length,
                legacyRequests: state.legacyRequests,
            };
        `);
        const legacy = await invokeRetry(webDriver, `legacy-${source}`);
        const after = await webDriver.execute(`
            const state = window.__mvuFeatureSmoke;
            return {
                providerRequests: state.providerRequests.length,
                legacyRequests: state.legacyRequests,
            };
        `);
        const finalResult = await webDriver.execute(`
            const state = window.__mvuFeatureSmoke;
            const context = window.SillyTavern.getContext();
            const lastMessage = context.chat.at(-1);
            const messageText = String(lastMessage?.mes ?? lastMessage?.message ?? '');
            const updateResults = messageText.match(/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/g) ?? [];
            const baseMessage = messageText
                .replaceAll(/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/g, '')
                .replaceAll('<StatusPlaceHolderImpl/>', '')
                .trim();
            const variables = window.Mvu.getMvuData({ type: 'message', message_id: 'latest' });
            const affinity = variables?.stat_data?.['\u7406']?.['\u597d\u611f\u5ea6'];
            return {
                messageText,
                baseMessage,
                transportResponse: state.lastLegacy?.responseText ?? null,
                updateResult: updateResults.at(-1) ?? null,
                updateCount: updateResults.length,
                appliedValue: Array.isArray(affinity) ? affinity[0] : affinity,
                statData: JSON.stringify(variables?.stat_data ?? null),
                displayData: JSON.stringify(variables?.display_data ?? null),
                deltaData: JSON.stringify(variables?.delta_data ?? null),
            };
        `);
        legacyFinalResults.push({ source, ...finalResult });
        trace(
            `legacy:${source}:before-${JSON.stringify(before)}:after-${JSON.stringify(after)}:invocation-${JSON.stringify(legacy)}:result-${JSON.stringify({ transportResponse: finalResult.transportResponse, updateResult: finalResult.updateResult, updateCount: finalResult.updateCount, appliedValue: finalResult.appliedValue, statDataBytes: finalResult.statData.length, displayDataBytes: finalResult.displayData.length, deltaDataBytes: finalResult.deltaData.length })}`
        );
        checks[source === '自定义' ? 'legacyCustomRoute' : 'legacySameRoute'] =
            legacy.settled === true &&
            after.providerRequests - before.providerRequests === 0 &&
            after.legacyRequests - before.legacyRequests === 1 &&
            finalResult.updateCount === 1 &&
            finalResult.transportResponse === LEGACY_OUTPUT_TEXT &&
            finalResult.updateResult === LEGACY_OUTPUT_TEXT &&
            finalResult.appliedValue === 7;
    }
    const providerCountAfterLegacy = await webDriver.execute(
        `return window.__mvuFeatureSmoke.providerRequests.length;`
    );
    checks.legacyNeverUsedPi = providerCountAfterLegacy === providerCountBeforeLegacy;
    checks.legacyFinalResultEquivalent =
        legacyFinalResults.length === 2 &&
        legacyFinalResults[0].transportResponse === legacyFinalResults[1].transportResponse &&
        legacyFinalResults[0].updateResult === legacyFinalResults[1].updateResult &&
        legacyFinalResults[0].baseMessage === legacyFinalResults[1].baseMessage;
    checks.legacyFinalUpdateEquivalent =
        legacyFinalResults.length === 2 &&
        legacyFinalResults[0].statData === legacyFinalResults[1].statData &&
        legacyFinalResults[0].displayData === legacyFinalResults[1].displayData &&
        legacyFinalResults[0].deltaData === legacyFinalResults[1].deltaData;

    const sendButtonConcurrency = await runSendButtonConcurrency(webDriver);
    checks.sendButtonUserMessage =
        sendButtonConcurrency.textareaCleared &&
        sendButtonConcurrency.chatDelta >= 1 &&
        sendButtonConcurrency.userMessageCount === 1 &&
        sendButtonConcurrency.userMessageStillPresent;
    checks.sendButtonPromptIsolation =
        sendButtonConcurrency.readyCount === 1 &&
        sendButtonConcurrency.captureReadyCount === 1 &&
        sendButtonConcurrency.mainPromptSeen &&
        sendButtonConcurrency.mainFetchPromptSeen &&
        !sendButtonConcurrency.mainPromptHasPiTask &&
        !sendButtonConcurrency.mainFetchHasPiTask &&
        sendButtonConcurrency.mainModelMatches &&
        sendButtonConcurrency.mainSourceCustom &&
        sendButtonConcurrency.piPromptSeen &&
        !sendButtonConcurrency.piPromptHasUserMarker &&
        sendButtonConcurrency.piPromptHasPiTask;
    checks.sendButtonStopIsolation =
        sendButtonConcurrency.piAborted &&
        sendButtonConcurrency.mainAliveAfterPiStop &&
        sendButtonConcurrency.mainAbortedAfterOwnStop &&
        sendButtonConcurrency.mainStopDidNotDispatchProvider;
    checks.sendButtonLifecycle =
        sendButtonConcurrency.events?.generationStarted >= 1 &&
        sendButtonConcurrency.events?.generationAfterCommands >= 1 &&
        sendButtonConcurrency.events?.messageSent >= 1 &&
        sendButtonConcurrency.events?.generationStopped >= 1 &&
        sendButtonConcurrency.stopButtonPresent &&
        sendButtonConcurrency.stopButtonVisible &&
        sendButtonConcurrency.mainStopEventObserved &&
        sendButtonConcurrency.isGenerating &&
        sendButtonConcurrency.generationIdle &&
        sendButtonConcurrency.textareaEmpty;

    const finalEvidence = await webDriver.execute(
        `
        const state = window.__mvuFeatureSmoke;
        const context = window.SillyTavern.getContext();
        context.eventSource.removeListener(state.readyEvent, state.readyListener);
        window.fetch = state.originalTopFetch;
        state.frame.fetch = state.originalFrameFetch;
        const result = {
            providerRequests: state.providerRequests.length,
            captureRequests: state.captureRequests,
            legacyRequests: state.legacyRequests,
            statusRequests: state.statusRequests,
            unexpectedExternal: state.unexpectedExternal,
            fetchRestored: window.fetch === state.originalTopFetch && state.frame.fetch === state.originalFrameFetch,
            extraAnalysisEnded: window.Mvu?.isDuringExtraAnalysis?.() === false,
        };
        delete window.__mvuFeatureSmoke;
        return result;
        `
    );
    checks.noUnexpectedExternalFetch = finalEvidence.unexpectedExternal === 0;
    checks.fetchRestored = finalEvidence.fetchRestored;
    checks.extraAnalysisEnded = finalEvidence.extraAnalysisEnded;
    checks.artifactLoaded = artifactBundleRequests >= 1;
    checks.artifactHashStable = artifactHashStable;
    checks.firefoxProfileTemporary = firefoxProfileTemporary;

    for (const [name, passed] of Object.entries(checks)) {
        assertFeature(passed, `assertion-${name}`);
    }

    return {
        ok: true,
        scope: 'mock-browser-protocol-evidence',
        counts: {
            artifactBundleRequests,
            providerRequests: finalEvidence.providerRequests,
            captureRequests: finalEvidence.captureRequests,
            legacyRequests: finalEvidence.legacyRequests,
            statusRequests: finalEvidence.statusRequests,
            rejectedEmbeddedScripts: embeddedScriptsRejected,
        },
        checks,
        diagnostics: {
            sendButtonConcurrencyOrder: 'pi-provider-before-send-button',
            retryAfterPendingMain:
                'not used: after send, the pending user message is the last chat floor, so retry-extra-model settles without dispatching a Pi request',
        },
        limitations: [
            'No real provider account, TLS/CORS, quota, entitlement, or server-side cancellation was exercised.',
            'OAuth authorization, token refresh against a real provider, and provider acceptance remain release-manual checks.',
            'The full SillyTavern send-button prompt path and the lower-level production chat-completion transport entry were both exercised against browser-local protocol mocks.',
        ],
    };
}
