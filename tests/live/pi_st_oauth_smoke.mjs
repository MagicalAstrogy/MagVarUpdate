import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const TOKEN_ENDPOINT = 'https://platform.claude.com/v1/oauth/token';
const AUTHORIZATION_HOSTS = Object.freeze(['claude.ai']);

class OAuthSmokeError extends Error {
    constructor(code) {
        super(code);
        this.name = 'OAuthSmokeError';
        this.code = code;
    }
}

function assertOAuth(value, code) {
    if (!value) {
        throw new OAuthSmokeError(code);
    }
}

function assertChecks(checks, prefix) {
    for (const [name, passed] of Object.entries(checks)) {
        assertOAuth(passed, `${prefix}-${name}`);
    }
}

async function waitForBrowser(webDriver, script, args, code, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            if (await webDriver.execute(script, args, 10_000)) {
                return;
            }
        } catch {
            // A reload can invalidate one poll while Firefox swaps documents.
        }
        await delay(150);
    }
    throw new OAuthSmokeError(code);
}

function makeMockCredential() {
    const nonce = randomUUID().replaceAll('-', '');
    return {
        access: `mvu-oauth-smoke-access-${nonce}`,
        refresh: `mvu-oauth-smoke-refresh-${nonce}`,
    };
}

async function configureAnthropicOAuth(webDriver, scriptName) {
    return webDriver.executeAsync(
        `
        const [scriptName] = arguments;
        const done = arguments[arguments.length - 1];
        const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
        const findRoot = () => [...document.querySelectorAll('#extensions_settings2 > div')]
            .findLast(element => (element.textContent || '').includes('MVU Variable Framework'));
        const choose = (root, requiredValues, value) => {
            const select = [...root.querySelectorAll('select')].find(candidate => {
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
        const poll = async predicate => {
            const deadline = Date.now() + 15000;
            while (Date.now() < deadline) {
                const result = predicate();
                if (result) return result;
                await wait(100);
            }
            return undefined;
        };
        (async () => {
            const iframe = await poll(() => [...document.querySelectorAll('iframe')].find(frame =>
                frame.id.startsWith('TH-script--' + scriptName)
            ));
            const root = await poll(findRoot);
            if (!iframe?.contentWindow || !root) return done({ ok: false, stage: 'root' });

            choose(root, ['随AI输出', '额外模型解析'], '额外模型解析');
            await poll(() => [...root.querySelectorAll('select')].some(candidate =>
                [...candidate.options].some(option => option.value === '更多')
            ));
            choose(root, ['与插头相同', '自定义', '更多'], '更多');
            await poll(() => [...root.querySelectorAll('select')].some(candidate =>
                [...candidate.options].some(option => option.value === 'anthropic')
            ));
            choose(root, ['openai', 'openai-codex', 'anthropic', 'google'], 'anthropic');
            await poll(() => [...root.querySelectorAll('select')].some(candidate =>
                [...candidate.options].some(option => option.value === 'oauth')
            ));
            choose(root, ['api_key', 'oauth'], 'oauth');
            const status = await poll(() => root.querySelector('.mvu-oauth-status > span'));
            const source = [...root.querySelectorAll('select')].find(candidate =>
                [...candidate.options].some(option => option.value === '更多')
            );
            const provider = [...root.querySelectorAll('select')].find(candidate =>
                [...candidate.options].some(option => option.value === 'anthropic')
            );
            const auth = [...root.querySelectorAll('select')].find(candidate =>
                [...candidate.options].some(option => option.value === 'oauth')
            );
            const api = [...root.querySelectorAll('select')].find(candidate =>
                [...candidate.options].some(option => option.value === 'anthropic-messages')
            );
            done({
                ok: true,
                sourceMore: source?.value === '更多',
                providerAnthropic: provider?.value === 'anthropic',
                apiAnthropicMessages: api?.value === 'anthropic-messages',
                authOAuth: auth?.value === 'oauth',
                oauthVisible: !!status,
                initiallySignedOut: /not signed in|未登录/i.test(status?.textContent || ''),
                apiKeyHidden: root.querySelectorAll('input[type="password"]').length === 0,
            });
        })().catch(error => done({ ok: false, stage: String(error?.message || 'configure') }));
        `,
        [scriptName],
        25_000
    );
}

async function installOAuthProbe(webDriver, scriptName, credential, mode = 'exchange') {
    return webDriver.execute(
        `
        const [scriptName, tokenEndpoint, authorizationHosts, accessValue, refreshValue, mode] = arguments;
        const iframe = [...document.querySelectorAll('iframe')].find(frame =>
            frame.id.startsWith('TH-script--' + scriptName)
        );
        if (!iframe?.contentWindow) return { ok: false };
        const w = iframe.contentWindow;
        const secrets = [accessValue, refreshValue];
        const containsSecret = value => {
            try {
                const text = typeof value === 'string' ? value : JSON.stringify(value);
                return secrets.some(secret => text?.includes(secret));
            } catch {
                return secrets.some(secret => String(value).includes(secret));
            }
        };
        const probe = {
            authorizationHosts,
            tokenEndpoint,
            accessValue,
            refreshValue,
            totalFetchCount: 0,
            tokenFetchCount: 0,
            tokenRequestShapeOk: false,
            tokenSignalPresent: false,
            tokenSignalLive: false,
            tokenUrlsExact: true,
            pkceVerifierMatches: false,
            consoleLeak: false,
            blockedUnexpectedOAuthRequests: 0,
            authUrl: '',
            authNavigationCount: 0,
            popups: [],
            controllers: [],
            restorers: [],
            mode,
        };

        const classifyOAuthUrl = rawUrl => {
            try {
                const url = new URL(String(rawUrl || ''), w.location.href);
                if (url.href === tokenEndpoint) return 'token';
                if (authorizationHosts.includes(url.hostname) &&
                    url.protocol === 'https:' && url.pathname === '/oauth/authorize') {
                    return 'authorization';
                }
            } catch {}
            return '';
        };

        const installRealmGuards = (realm, allowMockToken) => {
            const originalFetch = realm.fetch.bind(realm);
            realm.fetch = async function(input, init = {}) {
                const rawUrl = typeof input === 'string' ? input : String(input?.url || input);
                const oauthKind = classifyOAuthUrl(rawUrl);
                if (!oauthKind) return originalFetch(input, init);
                if (oauthKind !== 'token' || !allowMockToken) {
                    probe.blockedUnexpectedOAuthRequests += 1;
                    throw new TypeError('oauth-network-blocked-by-smoke');
                }

                probe.totalFetchCount += 1;
                probe.tokenFetchCount += 1;
                probe.tokenUrlsExact = probe.tokenUrlsExact && rawUrl === tokenEndpoint;
                let fields = {};
                try { fields = JSON.parse(String(init.body || '{}')); } catch {}
                const headers = new w.Headers(init.headers || {});
                probe.tokenSignalPresent = init.signal instanceof w.AbortSignal;
                probe.tokenSignalLive = probe.tokenSignalPresent && !init.signal.aborted;
                if (typeof fields.code_verifier === 'string' && probe.expectedChallenge) {
                    const digest = await w.crypto.subtle.digest(
                        'SHA-256',
                        new w.TextEncoder().encode(fields.code_verifier)
                    );
                    let binary = '';
                    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
                    const challenge = w.btoa(binary)
                        .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
                    probe.pkceVerifierMatches = challenge === probe.expectedChallenge;
                }
                probe.tokenRequestShapeOk =
                    init.method === 'POST' &&
                    headers.get('content-type') === 'application/json' &&
                    fields.grant_type === 'authorization_code' &&
                    fields.code === probe.expectedCode &&
                    fields.state === probe.expectedState &&
                    fields.redirect_uri === probe.expectedRedirect &&
                    typeof fields.code_verifier === 'string' &&
                    fields.code_verifier.length >= 32 &&
                    typeof fields.client_id === 'string' &&
                    fields.client_id.length > 0;
                if (mode === 'pending') {
                    probe.pendingExchangeStarted = true;
                    return new Promise((resolve, reject) => {
                        const abort = () => {
                            probe.pendingAbortObserved = true;
                            reject(new w.DOMException('Aborted', 'AbortError'));
                        };
                        if (init.signal?.aborted) abort();
                        else init.signal?.addEventListener('abort', abort, { once: true });
                    });
                }
                if (mode !== 'exchange') throw new Error('unexpected-token-endpoint');
                return new w.Response(JSON.stringify({
                    access_token: accessValue,
                    refresh_token: refreshValue,
                    expires_in: 3600,
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            };
            probe.restorers.push(() => { realm.fetch = originalFetch; });

            const xhrPrototype = realm.XMLHttpRequest?.prototype;
            if (xhrPrototype?.open) {
                const originalOpen = xhrPrototype.open;
                xhrPrototype.open = function(method, url, ...rest) {
                    if (classifyOAuthUrl(url)) {
                        probe.blockedUnexpectedOAuthRequests += 1;
                        throw new TypeError('oauth-network-blocked-by-smoke');
                    }
                    return originalOpen.call(this, method, url, ...rest);
                };
                probe.restorers.push(() => { xhrPrototype.open = originalOpen; });
            }

            if (typeof realm.navigator?.sendBeacon === 'function') {
                const originalSendBeacon = realm.navigator.sendBeacon.bind(realm.navigator);
                try {
                    realm.navigator.sendBeacon = (url, data) => {
                        if (classifyOAuthUrl(url)) {
                            probe.blockedUnexpectedOAuthRequests += 1;
                            return false;
                        }
                        return originalSendBeacon(url, data);
                    };
                    probe.restorers.push(() => { realm.navigator.sendBeacon = originalSendBeacon; });
                } catch {}
            }

            for (const constructorName of ['WebSocket', 'EventSource']) {
                const Original = realm[constructorName];
                if (typeof Original !== 'function') continue;
                function Guarded(url, ...rest) {
                    if (classifyOAuthUrl(url)) {
                        probe.blockedUnexpectedOAuthRequests += 1;
                        throw new TypeError('oauth-network-blocked-by-smoke');
                    }
                    return new Original(url, ...rest);
                }
                Object.setPrototypeOf(Guarded, Original);
                Guarded.prototype = Original.prototype;
                realm[constructorName] = Guarded;
                probe.restorers.push(() => { realm[constructorName] = Original; });
            }
        };

        installRealmGuards(w, true);
        installRealmGuards(window, false);

        probe.originalOpen = w.open;
        w.open = url => {
            let closed = false;
            const popup = {
                opener: { smoke: true },
                get closed() { return closed; },
                close() { closed = true; },
                focus() {},
                location: {
                    replace(value) {
                        probe.authUrl = String(value || '');
                        probe.authNavigationCount += 1;
                    },
                },
            };
            if (url && url !== 'about:blank') popup.location.replace(url);
            probe.popups.push(popup);
            return popup;
        };
        probe.originalParentOpen = window.open;
        window.open = (url, ...rest) => {
            if (classifyOAuthUrl(url)) {
                probe.blockedUnexpectedOAuthRequests += 1;
                return null;
            }
            return probe.originalParentOpen.call(window, url, ...rest);
        };

        probe.NativeAbortController = w.AbortController;
        function TrackingAbortController() {
            const controller = new probe.NativeAbortController();
            probe.controllers.push(controller);
            return controller;
        }
        Object.setPrototypeOf(TrackingAbortController, probe.NativeAbortController);
        TrackingAbortController.prototype = probe.NativeAbortController.prototype;
        w.AbortController = TrackingAbortController;

        const wrapConsole = realm => {
            const originals = {};
            for (const method of ['debug', 'info', 'log', 'warn', 'error']) {
                const original = realm.console[method].bind(realm.console);
                originals[method] = original;
                realm.console[method] = (...values) => {
                    if (values.some(containsSecret)) probe.consoleLeak = true;
                    return original(...values);
                };
            }
            probe.restorers.push(() => {
                for (const [method, original] of Object.entries(originals)) {
                    realm.console[method] = original;
                }
            });
        };
        wrapConsole(w);
        wrapConsole(window);
        probe.closePopups = () => probe.popups.forEach(popup => popup.close());
        probe.restore = () => {
            w.open = probe.originalOpen;
            window.open = probe.originalParentOpen;
            w.AbortController = probe.NativeAbortController;
            for (const restore of probe.restorers.reverse()) restore();
        };
        window.__mvuOAuthSmoke = { iframe, probe };
        return { ok: true };
        `,
        [
            scriptName,
            TOKEN_ENDPOINT,
            AUTHORIZATION_HOSTS,
            credential.access,
            credential.refresh,
            mode,
        ]
    );
}

async function beginAttempt(webDriver, scriptName) {
    return webDriver.executeAsync(
        `
        const [scriptName] = arguments;
        const done = arguments[arguments.length - 1];
        const state = window.__mvuOAuthSmoke;
        const root = [...document.querySelectorAll('#extensions_settings2 > div')]
            .findLast(element => (element.textContent || '').includes('MVU Variable Framework'));
        if (!state?.probe || !root) return done({ ok: false });
        const probe = state.probe;
        probe.controllerCheckpoint = probe.controllers.length;
        probe.popupCheckpoint = probe.popups.length;
        const status = root.querySelector('.mvu-oauth-status');
        const oauth = status?.closest('details') || root;
        const login = [...oauth.querySelectorAll('input[type="button"]')].find(input =>
            /^(sign in|login|登录)$/i.test(input.value)
        );
        if (!login) return done({ ok: false });
        login.click();
        const deadline = Date.now() + 10000;
        const poll = () => {
            const auth = [...oauth.querySelectorAll('input[type="text"]')].find(
                input => input.readOnly && input.value.startsWith('https://')
            );
            const callback = oauth.querySelector('input[type="password"]');
            const cancel = [...oauth.querySelectorAll('input[type="button"]')].find(input =>
                /cancel.*sign-in|cancel.*login|取消/i.test(input.value)
            );
            const complete = [...oauth.querySelectorAll('input[type="button"]')].find(input =>
                /complete.*sign-in|complete.*login|完成/i.test(input.value)
            );
            if (auth && callback && cancel && complete) {
                let parsed;
                try { parsed = new URL(auth.value); } catch {}
                const captured = probe.authUrl;
                const popup = probe.popups.at(-1);
                const authLink = [...oauth.querySelectorAll('a[href]')]
                    .find(link => link.href === auth.value);
                const scope = parsed?.searchParams.get('scope') || '';
                done({
                    ok: true,
                    attemptVisible: true,
                    authorizationReadonly: auth.readOnly,
                    authorizationEndpointExact:
                        parsed?.origin === 'https://claude.ai' &&
                        parsed?.pathname === '/oauth/authorize' &&
                        parsed?.username === '' && parsed?.password === '' && parsed?.hash === '',
                    redirectUriExact:
                        parsed?.searchParams.get('redirect_uri') ===
                        'http://localhost:53692/callback',
                    clientIdPresent: (parsed?.searchParams.get('client_id') || '').length > 0,
                    scopePresent:
                        scope.includes('org:create_api_key') &&
                        scope.includes('user:profile') &&
                        scope.includes('user:inference'),
                    codeFlagPresent: parsed?.searchParams.get('code') === 'true',
                    statePresent: (parsed?.searchParams.get('state') || '').length >= 16,
                    pkcePresent: (parsed?.searchParams.get('code_challenge') || '').length >= 32,
                    pkceMethodS256:
                        parsed?.searchParams.get('code_challenge_method') === 'S256',
                    responseTypeCode: parsed?.searchParams.get('response_type') === 'code',
                    popupIntercepted: probe.popups.length === probe.popupCheckpoint + 1,
                    popupNavigationCaptured:
                        probe.authNavigationCount > 0 && captured === auth.value,
                    popupOpenerCleared: popup?.opener === null,
                    authorizationLinkSafe:
                        authLink?.target === '_blank' &&
                        authLink?.relList.contains('noopener') &&
                        authLink?.relList.contains('noreferrer'),
                    callbackPassword: callback.type === 'password',
                    callbackAutocompleteOff: callback.autocomplete === 'off',
                    callbackSpellcheckOff: callback.spellcheck === false,
                    callbackEmpty: callback.value === '',
                    completeDisabled: complete.disabled,
                    tokenFetchCount: probe.tokenFetchCount,
                    authorizationNetworkBlocked:
                        probe.blockedUnexpectedOAuthRequests === 0 &&
                        probe.authNavigationCount > 0,
                });
                return;
            }
            if (Date.now() >= deadline) return done({ ok: false });
            setTimeout(poll, 100);
        };
        poll();
        `,
        [scriptName],
        15_000
    );
}

async function cancelAttempt(webDriver) {
    return webDriver.executeAsync(
        `
        const done = arguments[arguments.length - 1];
        const state = window.__mvuOAuthSmoke;
        const probe = state?.probe;
        const root = [...document.querySelectorAll('#extensions_settings2 > div')]
            .findLast(element => (element.textContent || '').includes('MVU Variable Framework'));
        const oauth = root?.querySelector('.mvu-oauth-status')?.closest('details');
        const cancel = [...oauth?.querySelectorAll('input[type="button"]') || []].find(input =>
            /cancel.*sign-in|cancel.*login|取消/i.test(input.value)
        );
        if (!probe || !oauth || !cancel) return done({ ok: false });
        cancel.click();
        const deadline = Date.now() + 5000;
        const poll = () => {
            const auth = [...oauth.querySelectorAll('input[type="text"]')].find(
                input => input.readOnly && input.value.startsWith('https://')
            );
            if (!auth) {
                const aborted = probe.controllers.slice(probe.controllerCheckpoint)
                    .some(controller => controller.signal.aborted);
                probe.popups.slice(probe.popupCheckpoint).forEach(popup => popup.close());
                const config = state.iframe.contentWindow.SillyTavern?.extensionSettings
                    ?.mvu_settings?.['额外模型解析配置'];
                done({
                    ok: true,
                    attemptCleared: true,
                    callbackCleared: !oauth.querySelector('input[type="password"]'),
                    cancelProgress: /cancel.*sign-in|取消登录/i.test(oauth.textContent || ''),
                    abortObserved: aborted,
                    popupClosedByHarness: probe.popups.slice(probe.popupCheckpoint)
                        .every(popup => popup.closed),
                    tokenFetchCount: probe.tokenFetchCount,
                    credentialAbsent: !config?.pi?.credentials?.anthropic,
                });
                return;
            }
            if (Date.now() >= deadline) return done({ ok: false });
            setTimeout(poll, 100);
        };
        poll();
        `,
        [],
        10_000
    );
}

async function rejectMismatchedState(webDriver) {
    return webDriver.executeAsync(
        `
        const done = arguments[arguments.length - 1];
        const state = window.__mvuOAuthSmoke;
        const probe = state?.probe;
        const root = [...document.querySelectorAll('#extensions_settings2 > div')]
            .findLast(element => (element.textContent || '').includes('MVU Variable Framework'));
        const oauth = root?.querySelector('.mvu-oauth-status')?.closest('details');
        const login = [...oauth?.querySelectorAll('input[type="button"]') || []].find(input =>
            /^(sign in|login|登录)$/i.test(input.value)
        );
        if (!probe || !oauth || !login) return done({ ok: false, stage: 'start' });
        probe.controllerCheckpoint = probe.controllers.length;
        probe.popupCheckpoint = probe.popups.length;
        login.click();
        const deadline = Date.now() + 12000;
        const waitForAttempt = () => {
            const auth = [...oauth.querySelectorAll('input[type="text"]')].find(
                input => input.readOnly && input.value.startsWith('https://')
            );
            const callback = oauth.querySelector('input[type="password"]');
            if (!auth || !callback) {
                if (Date.now() >= deadline) return done({ ok: false, stage: 'attempt' });
                setTimeout(waitForAttempt, 100);
                return;
            }
            const authorization = new URL(auth.value);
            const redirect = new URL(authorization.searchParams.get('redirect_uri'));
            redirect.hostname = '127.0.0.1';
            probe.mismatchCode = 'mvu-oauth-mismatch-' + crypto.randomUUID();
            redirect.searchParams.set('code', probe.mismatchCode);
            redirect.searchParams.set('state', authorization.searchParams.get('state') + '-wrong');
            callback.value = redirect.toString();
            callback.dispatchEvent(new Event('input', { bubbles: true }));
            callback.dispatchEvent(new Event('change', { bubbles: true }));
            setTimeout(() => {
                const complete = [...oauth.querySelectorAll('input[type="button"]')].find(input =>
                    /complete.*sign-in|complete.*login|完成/i.test(input.value)
                );
                if (!complete || complete.disabled) return done({ ok: false, stage: 'complete' });
                complete.click();
                const waitForError = () => {
                    const error = oauth.querySelector('.mvu-field-error');
                    const retainedAuth = [...oauth.querySelectorAll('input[type="text"]')].find(
                        input => input.readOnly && input.value.startsWith('https://')
                    );
                    const retainedComplete = [...oauth.querySelectorAll('input[type="button"]')]
                        .find(input => /complete.*sign-in|complete.*login|完成/i.test(input.value));
                    if (error?.textContent?.trim()) {
                        done({
                            ok: true,
                            localStateMismatchRejected:
                                /does not match the current sign-in attempt|state|状态/i.test(error.textContent),
                            attemptRetained: !!retainedAuth,
                            callbackCleared: !oauth.querySelector('input[type="password"]')?.value,
                            completeDisabled: retainedComplete?.disabled === true,
                            errorDoesNotEchoCallback: !error.textContent.includes(probe.mismatchCode),
                            tokenFetchCount: probe.tokenFetchCount,
                        });
                        return;
                    }
                    if (Date.now() >= deadline) return done({ ok: false, stage: 'error' });
                    setTimeout(waitForError, 100);
                };
                waitForError();
            }, 100);
        };
        waitForAttempt();
        `,
        [],
        20_000
    );
}

async function switchSourceClearsAttempt(webDriver) {
    return webDriver.executeAsync(
        `
        const done = arguments[arguments.length - 1];
        const state = window.__mvuOAuthSmoke;
        const probe = state?.probe;
        const root = [...document.querySelectorAll('#extensions_settings2 > div')]
            .findLast(element => (element.textContent || '').includes('MVU Variable Framework'));
        const source = [...root?.querySelectorAll('select') || []].find(candidate => {
            const values = [...candidate.options].map(option => option.value);
            return ['与插头相同', '自定义', '更多'].every(value => values.includes(value));
        });
        if (!probe || !root || !source) return done({ ok: false });
        const dispatch = () => {
            source.dispatchEvent(new Event('input', { bubbles: true }));
            source.dispatchEvent(new Event('change', { bubbles: true }));
        };
        source.value = '自定义';
        dispatch();
        const deadline = Date.now() + 10000;
        const waitForCustom = () => {
            if (source.value === '自定义' && !root.querySelector('.mvu-oauth-status')) {
                const abortObserved = probe.controllers.slice(probe.controllerCheckpoint)
                    .some(controller => controller.signal.aborted);
                source.value = '更多';
                dispatch();
                const waitForMore = () => {
                    const oauth = root.querySelector('.mvu-oauth-status')?.closest('details');
                    if (source.value === '更多' && oauth) {
                        const oldAuth = [...oauth.querySelectorAll('input[type="text"]')].find(
                            input => input.readOnly && input.value.startsWith('https://')
                        );
                        const config = state.iframe.contentWindow.SillyTavern?.extensionSettings
                            ?.mvu_settings?.['额外模型解析配置'];
                        probe.popups.slice(probe.popupCheckpoint).forEach(popup => popup.close());
                        done({
                            ok: true,
                            sourceSwitched: true,
                            oauthRemovedOnCustom: true,
                            sourceRestored: true,
                            oldAttemptNotRestored: !oldAuth && !oauth.querySelector('input[type="password"]'),
                            sourceSwitchAbortObserved: abortObserved,
                            popupClosedByHarness: probe.popups.slice(probe.popupCheckpoint)
                                .every(popup => popup.closed),
                            tokenFetchCount: probe.tokenFetchCount,
                            credentialAbsent: !config?.pi?.credentials?.anthropic,
                        });
                        return;
                    }
                    if (Date.now() >= deadline) return done({ ok: false });
                    setTimeout(waitForMore, 100);
                };
                waitForMore();
                return;
            }
            if (Date.now() >= deadline) return done({ ok: false });
            setTimeout(waitForCustom, 100);
        };
        waitForCustom();
        `,
        [],
        15_000
    );
}

async function completeValidLoopback(webDriver) {
    return webDriver.executeAsync(
        `
        const done = arguments[arguments.length - 1];
        const state = window.__mvuOAuthSmoke;
        const probe = state?.probe;
        const root = [...document.querySelectorAll('#extensions_settings2 > div')]
            .findLast(element => (element.textContent || '').includes('MVU Variable Framework'));
        const oauth = root?.querySelector('.mvu-oauth-status')?.closest('details');
        const login = [...oauth?.querySelectorAll('input[type="button"]') || []].find(input =>
            /^(sign in|login|登录)$/i.test(input.value)
        );
        if (!probe || !oauth || !login) return done({ ok: false, stage: 'start' });
        probe.controllerCheckpoint = probe.controllers.length;
        probe.popupCheckpoint = probe.popups.length;
        login.click();
        const deadline = Date.now() + 15000;
        const waitForAttempt = () => {
            const auth = [...oauth.querySelectorAll('input[type="text"]')].find(
                input => input.readOnly && input.value.startsWith('https://')
            );
            const callback = oauth.querySelector('input[type="password"]');
            if (!auth || !callback) {
                if (Date.now() >= deadline) return done({ ok: false, stage: 'attempt' });
                setTimeout(waitForAttempt, 100);
                return;
            }
            const authorization = new URL(auth.value);
            const redirectValue = authorization.searchParams.get('redirect_uri');
            const redirect = new URL(redirectValue);
            redirect.hostname = '127.0.0.1';
            probe.expectedCode = 'mvu-oauth-valid-' + crypto.randomUUID();
            probe.expectedState = authorization.searchParams.get('state');
            probe.expectedRedirect = redirectValue;
            probe.expectedChallenge = authorization.searchParams.get('code_challenge');
            redirect.searchParams.set('code', probe.expectedCode);
            redirect.searchParams.set('state', probe.expectedState);
            callback.value = redirect.toString();
            callback.dispatchEvent(new Event('input', { bubbles: true }));
            callback.dispatchEvent(new Event('change', { bubbles: true }));
            setTimeout(() => {
                const complete = [...oauth.querySelectorAll('input[type="button"]')].find(input =>
                    /complete.*sign-in|complete.*login|完成/i.test(input.value)
                );
                if (!complete || complete.disabled) return done({ ok: false, stage: 'complete' });
                complete.click();
                const waitForSuccess = () => {
                    const signedIn = /signed in|已登录/i.test(
                        oauth.querySelector('.mvu-oauth-status > span')?.textContent || ''
                    );
                    const signOut = [...oauth.querySelectorAll('input[type="button"]')].find(input =>
                        /^(sign out|logout|登出)$/i.test(input.value)
                    );
                    if (signedIn && signOut) {
                        const config = state.iframe.contentWindow.SillyTavern?.extensionSettings
                            ?.mvu_settings?.['额外模型解析配置'];
                        const credential = config?.pi?.credentials?.anthropic;
                        const displayed = [...document.querySelectorAll('input, textarea')]
                            .some(input => [probe.accessValue, probe.refreshValue]
                                .some(secret => String(input.value || '').includes(secret))) ||
                            [probe.accessValue, probe.refreshValue]
                                .some(secret => (document.body.textContent || '').includes(secret));
                        const profiles = JSON.stringify(config?.['api方案列表'] || []);
                        const credentialsOutsideAllowedSlot = JSON.stringify(Object.fromEntries(
                            Object.entries(config?.pi?.credentials || {})
                                .filter(([provider]) => provider !== 'anthropic')
                        ));
                        const disallowedSettings = JSON.stringify({
                            apiKeys: config?.pi?.apiKeys || {},
                            customApiKey: config?.customApiKey || '',
                            credentialsOutsideAllowedSlot,
                        });
                        const storageLeaked = [state.iframe.contentWindow.localStorage,
                            state.iframe.contentWindow.sessionStorage].some(storage =>
                            [...Array(storage.length).keys()].some(index => {
                                const key = storage.key(index);
                                const value = key === null ? '' : storage.getItem(key) || '';
                                return [probe.accessValue, probe.refreshValue]
                                    .some(secret => key?.includes(secret) || value.includes(secret));
                            })
                        );
                        const resources = [
                            ...performance.getEntriesByType('resource'),
                            ...state.iframe.contentWindow.performance.getEntriesByType('resource'),
                        ].map(entry => entry.name);
                        const realAuthRequests = resources.filter(value => {
                            try {
                                const url = new URL(value);
                                return probe.authorizationHosts.includes(url.hostname) &&
                                    url.pathname.includes('/oauth/authorize');
                            } catch { return false; }
                        }).length;
                        const realTokenRequests = resources
                            .filter(value => value === probe.tokenEndpoint).length;
                        probe.popups.slice(probe.popupCheckpoint).forEach(popup => popup.close());
                        done({
                            ok: true,
                            signedIn: true,
                            signOutPresent: true,
                            attemptCleared: ![...oauth.querySelectorAll('input[type="text"]')]
                                .some(input => input.readOnly && input.value.startsWith('https://')),
                            callbackCleared: !oauth.querySelector('input[type="password"]'),
                            successProgress: /sign-in succeeded|login succeeded|登录成功/i
                                .test(oauth.textContent || ''),
                            tokenFetchCount: probe.tokenFetchCount,
                            tokenRequestShapeOk: probe.tokenRequestShapeOk,
                            pkceVerifierMatches: probe.pkceVerifierMatches,
                            tokenSignalPresent: probe.tokenSignalPresent,
                            tokenSignalLive: probe.tokenSignalLive,
                            tokenUrlsExact: probe.tokenUrlsExact,
                            realTokenRequests,
                            realAuthRequests,
                            credentialMatchesMock:
                                credential?.type === 'oauth' &&
                                credential.access === probe.accessValue &&
                                credential.refresh === probe.refreshValue &&
                                typeof credential.expires === 'number',
                            tokenNotDisplayed: !displayed,
                            credentialAbsentFromProfiles:
                                !profiles.includes(probe.accessValue) &&
                                !profiles.includes(probe.refreshValue),
                            rootApiKeyDoesNotContainCredential:
                                config?.['密钥'] !== probe.accessValue &&
                                config?.['密钥'] !== probe.refreshValue,
                            credentialAbsentFromOtherSettings:
                                !disallowedSettings.includes(probe.accessValue) &&
                                !disallowedSettings.includes(probe.refreshValue),
                            toastDoesNotContainCredential:
                                ![...document.querySelectorAll('.toast-message')].some(toast =>
                                    [probe.accessValue, probe.refreshValue]
                                        .some(secret => (toast.textContent || '').includes(secret))
                                ),
                            storageDoesNotContainCredential: !storageLeaked,
                            consoleDoesNotContainCredential: !probe.consoleLeak,
                            noUnexpectedOAuthTransport:
                                probe.blockedUnexpectedOAuthRequests === 0,
                            popupClosedByHarness: probe.popups.slice(probe.popupCheckpoint)
                                .every(popup => popup.closed),
                        });
                        return;
                    }
                    if (Date.now() >= deadline) return done({ ok: false, stage: 'success' });
                    setTimeout(waitForSuccess, 100);
                };
                waitForSuccess();
            }, 100);
        };
        waitForAttempt();
        `,
        [],
        25_000
    );
}

async function readReloadedStatus(webDriver, scriptName, credential, expectedSignedIn) {
    return webDriver.execute(
        `
        const [scriptName, tokenEndpoint, authorizationHosts, accessValue, refreshValue,
            expectedSignedIn] = arguments;
        const iframe = [...document.querySelectorAll('iframe')].find(frame =>
            frame.id.startsWith('TH-script--' + scriptName)
        );
        const root = [...document.querySelectorAll('#extensions_settings2 > div')]
            .findLast(element => (element.textContent || '').includes('MVU Variable Framework'));
        const oauth = root?.querySelector('.mvu-oauth-status')?.closest('details');
        if (!iframe?.contentWindow || !root || !oauth) return { ok: false };
        const status = oauth.querySelector('.mvu-oauth-status > span')?.textContent || '';
        const config = iframe.contentWindow.SillyTavern?.extensionSettings
            ?.mvu_settings?.['额外模型解析配置'];
        const credential = config?.pi?.credentials?.anthropic;
        const displayed = [...document.querySelectorAll('input, textarea')]
            .some(input => [accessValue, refreshValue]
                .some(secret => String(input.value || '').includes(secret))) ||
            [accessValue, refreshValue]
                .some(secret => (document.body.textContent || '').includes(secret));
        const credentialsOutsideAllowedSlot = JSON.stringify(Object.fromEntries(
            Object.entries(config?.pi?.credentials || {})
                .filter(([provider]) => provider !== 'anthropic')
        ));
        const disallowedSettings = JSON.stringify({
            apiKeys: config?.pi?.apiKeys || {},
            customApiKey: config?.customApiKey || '',
            profiles: config?.['api方案列表'] || [],
            credentialsOutsideAllowedSlot,
            rootApiKey: config?.['密钥'] || '',
        });
        const resources = [
            ...performance.getEntriesByType('resource'),
            ...iframe.contentWindow.performance.getEntriesByType('resource'),
        ].map(entry => entry.name);
        const realAuthRequests = resources.filter(value => {
            try {
                const url = new URL(value);
                return authorizationHosts.includes(url.hostname) &&
                    url.pathname.includes('/oauth/authorize');
            } catch { return false; }
        }).length;
        const signedIn = /signed in|已登录/i.test(status);
        const signedOut = /not signed in|未登录/i.test(status);
        const login = [...oauth.querySelectorAll('input[type="button"]')]
            .some(input => /^(sign in|login|登录)$/i.test(input.value));
        const logout = [...oauth.querySelectorAll('input[type="button"]')]
            .some(input => /^(sign out|logout|登出)$/i.test(input.value));
        return {
            ok: true,
            expectedStateVisible: expectedSignedIn ? signedIn && logout : signedOut && login,
            credentialStateCorrect: expectedSignedIn
                ? credential?.type === 'oauth' &&
                    credential.access === accessValue &&
                    credential.refresh === refreshValue &&
                    typeof credential.expires === 'number'
                : !credential,
            tokenNotDisplayed: !displayed,
            credentialAbsentFromOtherSettings:
                !disallowedSettings.includes(accessValue) &&
                !disallowedSettings.includes(refreshValue),
            realTokenRequests: resources.filter(value => value === tokenEndpoint).length,
            realAuthRequests,
        };
        `,
        [
            scriptName,
            TOKEN_ENDPOINT,
            AUTHORIZATION_HOSTS,
            credential.access,
            credential.refresh,
            expectedSignedIn,
        ]
    );
}

async function flushSettings(webDriver, scriptName) {
    const result = await webDriver.executeAsync(
        `
        const [scriptName] = arguments;
        const done = arguments[arguments.length - 1];
        const iframe = [...document.querySelectorAll('iframe')].find(frame =>
            frame.id.startsWith('TH-script--' + scriptName)
        );
        const saveSettings = iframe?.contentWindow?.builtin?.saveSettings ||
            iframe?.contentWindow?.TavernHelper?.builtin?.saveSettings ||
            window.TavernHelper?.builtin?.saveSettings;
        if (typeof saveSettings !== 'function') return done({ ok: false });
        setTimeout(() => {
            Promise.resolve(saveSettings()).then(
                () => done({ ok: true }),
                () => done({ ok: false })
            );
        }, 250);
        `,
        [scriptName],
        15_000
    );
    assertOAuth(result?.ok, 'settings-flush');
}

async function signOutThroughConfirmation(webDriver, scriptName) {
    const opened = await webDriver.executeAsync(
        `
        const done = arguments[arguments.length - 1];
        const probe = window.__mvuOAuthSmoke?.probe;
        const root = [...document.querySelectorAll('#extensions_settings2 > div')]
            .findLast(element => (element.textContent || '').includes('MVU Variable Framework'));
        const oauth = root?.querySelector('.mvu-oauth-status')?.closest('details');
        const signOut = [...oauth?.querySelectorAll('input[type="button"]') || []].find(input =>
            /^(sign out|logout|登出)$/i.test(input.value)
        );
        if (!signOut) return done({ ok: false });
        signOut.click();
        const deadline = Date.now() + 5000;
        const poll = () => {
            const dialog = [...document.querySelectorAll('dialog.popup')]
                .find(candidate => candidate.open && candidate.getClientRects().length > 0);
            const affirmative = dialog?.querySelector('.popup-button-ok');
            if (dialog && affirmative) {
                done({
                    ok: true,
                    confirmationVisible: true,
                    affirmativePresent: true,
                    confirmationMentionsCredential: /credential|凭据/i.test(dialog.textContent || ''),
                    confirmationDoesNotContainCredential:
                        !!probe &&
                        ![probe.accessValue, probe.refreshValue]
                            .some(secret => (dialog.textContent || '').includes(secret)),
                });
                return;
            }
            if (Date.now() >= deadline) return done({ ok: false });
            setTimeout(poll, 100);
        };
        poll();
        `,
        [],
        10_000
    );
    if (!opened?.ok) return opened;

    return webDriver.executeAsync(
        `
        const done = arguments[arguments.length - 1];
        const probe = window.__mvuOAuthSmoke?.probe;
        const dialog = [...document.querySelectorAll('dialog.popup')]
            .find(candidate => candidate.open && candidate.getClientRects().length > 0);
        const affirmative = dialog?.querySelector('.popup-button-ok');
        if (!affirmative) return done({ ok: false });
        affirmative.click();
        const deadline = Date.now() + 10000;
        const poll = () => {
            const root = [...document.querySelectorAll('#extensions_settings2 > div')]
                .findLast(element => (element.textContent || '').includes('MVU Variable Framework'));
            const iframe = [...document.querySelectorAll('iframe')]
                .find(frame => frame.id.startsWith('TH-script--' + arguments[1]));
            const oauth = root?.querySelector('.mvu-oauth-status')?.closest('details');
            const signedOut = /not signed in|未登录/i.test(
                oauth?.querySelector('.mvu-oauth-status > span')?.textContent || ''
            );
            const login = [...oauth?.querySelectorAll('input[type="button"]') || []]
                .some(input => /^(sign in|login|登录)$/i.test(input.value));
            const config = iframe?.contentWindow?.SillyTavern?.extensionSettings
                ?.mvu_settings?.['额外模型解析配置'];
            if (signedOut && login && !config?.pi?.credentials?.anthropic) {
                const resources = [
                    ...performance.getEntriesByType('resource'),
                    ...iframe.contentWindow.performance.getEntriesByType('resource'),
                ].map(entry => entry.name);
                done({
                    ok: true,
                    ...arguments[0],
                    confirmed: true,
                    confirmationClosed: ![...document.querySelectorAll('dialog.popup')]
                        .some(candidate => candidate.open),
                    signedOut: true,
                    signInRestored: true,
                    signOutRemoved: ![...oauth.querySelectorAll('input[type="button"]')]
                        .some(input => /^(sign out|logout|登出)$/i.test(input.value)),
                    credentialDeleted: true,
                    logoutProgress: /signed out|logged out|已登出/i.test(oauth.textContent || ''),
                    realTokenRequests: resources.filter(value => value === arguments[2]).length,
                    guardedTokenFetchCount: probe?.tokenFetchCount ?? -1,
                    noUnexpectedOAuthTransport:
                        probe?.blockedUnexpectedOAuthRequests === 0,
                    consoleDoesNotContainCredential: probe?.consoleLeak === false,
                });
                return;
            }
            if (Date.now() >= deadline) return done({ ok: false });
            setTimeout(poll, 100);
        };
        poll();
        `,
        [opened, scriptName, TOKEN_ENDPOINT],
        15_000
    );
}

async function beginAttemptThenUnload(webDriver, scriptName, credential) {
    const installed = await installOAuthProbe(webDriver, scriptName, credential, 'reject');
    assertOAuth(installed?.ok, 'unload-probe-install');
    const attempt = await beginAttempt(webDriver, scriptName);
    assertChecks(
        {
            visible: attempt?.ok && attempt.attemptVisible,
            popupIntercepted: attempt?.popupIntercepted,
            noTokenFetch: attempt?.tokenFetchCount === 0,
        },
        'unload-attempt'
    );

    return webDriver.executeAsync(
        `
        const done = arguments[arguments.length - 1];
        const state = window.__mvuOAuthSmoke;
        if (!state?.probe) return done({ ok: false });
        const probe = state.probe;
        window.__mvuOAuthUnloadSmoke = state;
        window.TavernHelper.replaceScriptTrees([], { type: 'global' });
        const deadline = Date.now() + 10000;
        const poll = () => {
            const iframePresent = [...document.querySelectorAll('iframe')]
                .some(frame => frame.id.startsWith('TH-script--' + arguments[0]));
            const panelPresent = [...document.querySelectorAll('#extensions_settings2 > div')]
                .some(element => (element.textContent || '').includes('MVU Variable Framework'));
            if (!iframePresent && !panelPresent) {
                const abortObserved = probe.controllers.slice(probe.controllerCheckpoint)
                    .some(controller => controller.signal.aborted);
                probe.closePopups();
                const popupClosedByHarness = probe.popups.every(popup => popup.closed);
                const tokenFetchCount = probe.tokenFetchCount;
                const consoleLeak = probe.consoleLeak;
                delete window.__mvuOAuthSmoke;
                delete window.__mvuOAuthUnloadSmoke;
                done({
                    ok: true,
                    panelRemoved: true,
                    iframeRemoved: true,
                    attemptAbortObserved: abortObserved,
                    popupClosedByHarness,
                    tokenFetchCount,
                    consoleDoesNotContainCredential: !consoleLeak,
                    globalScriptRemoved:
                        window.TavernHelper.getScriptTrees({ type: 'global' }).length === 0,
                });
                return;
            }
            if (Date.now() >= deadline) return done({ ok: false });
            setTimeout(poll, 100);
        };
        poll();
        `,
        [scriptName],
        15_000
    );
}

async function bestEffortBrowserCleanup(webDriver) {
    try {
        await webDriver.execute(`
            for (const state of [window.__mvuOAuthSmoke, window.__mvuOAuthUnloadSmoke]) {
                try { state?.probe?.closePopups?.(); } catch {}
                try { state?.probe?.restore?.(); } catch {}
            }
            try { window.TavernHelper?.replaceScriptTrees?.([], { type: 'global' }); } catch {}
            delete window.__mvuOAuthSmoke;
            delete window.__mvuOAuthUnloadSmoke;
            return true;
        `);
    } catch {
        // The outer harness still destroys the isolated browser session and data root.
    }
}

export async function runPiStOAuthSmoke({
    webDriver,
    scriptName,
    artifactBundleRequests,
    artifactHashStable,
    firefoxProfileTemporary,
    embeddedScriptsRejected,
}) {
    const credential = makeMockCredential();
    let completed = false;
    try {
        const configured = await configureAnthropicOAuth(webDriver, scriptName);
        assertOAuth(configured?.ok, `configure-${configured?.stage ?? 'failed'}`);
        assertChecks(
            {
                sourceMore: configured.sourceMore,
                providerAnthropic: configured.providerAnthropic,
                apiAnthropicMessages: configured.apiAnthropicMessages,
                authOAuth: configured.authOAuth,
                oauthVisible: configured.oauthVisible,
                initiallySignedOut: configured.initiallySignedOut,
                apiKeyHidden: configured.apiKeyHidden,
            },
            'configure'
        );

        const probeInstalled = await installOAuthProbe(webDriver, scriptName, credential);
        assertOAuth(probeInstalled?.ok, 'probe-install');

        const initialAttempt = await beginAttempt(webDriver, scriptName);
        assertOAuth(initialAttempt?.ok, 'attempt-start');
        assertChecks(
            {
                visible: initialAttempt.attemptVisible,
                authorizationReadonly: initialAttempt.authorizationReadonly,
                authorizationEndpointExact: initialAttempt.authorizationEndpointExact,
                redirectUriExact: initialAttempt.redirectUriExact,
                clientIdPresent: initialAttempt.clientIdPresent,
                scopePresent: initialAttempt.scopePresent,
                codeFlagPresent: initialAttempt.codeFlagPresent,
                statePresent: initialAttempt.statePresent,
                pkcePresent: initialAttempt.pkcePresent,
                pkceMethodS256: initialAttempt.pkceMethodS256,
                responseTypeCode: initialAttempt.responseTypeCode,
                popupIntercepted: initialAttempt.popupIntercepted,
                popupNavigationCaptured: initialAttempt.popupNavigationCaptured,
                popupOpenerCleared: initialAttempt.popupOpenerCleared,
                authorizationLinkSafe: initialAttempt.authorizationLinkSafe,
                callbackPassword: initialAttempt.callbackPassword,
                callbackAutocompleteOff: initialAttempt.callbackAutocompleteOff,
                callbackSpellcheckOff: initialAttempt.callbackSpellcheckOff,
                callbackEmpty: initialAttempt.callbackEmpty,
                completeDisabled: initialAttempt.completeDisabled,
                noTokenFetch: initialAttempt.tokenFetchCount === 0,
                authorizationNetworkBlocked: initialAttempt.authorizationNetworkBlocked,
            },
            'attempt'
        );

        const cancelled = await cancelAttempt(webDriver);
        assertOAuth(cancelled?.ok, 'cancel');
        assertChecks(
            {
                attemptCleared: cancelled.attemptCleared,
                callbackCleared: cancelled.callbackCleared,
                cancelProgress: cancelled.cancelProgress,
                abortObserved: cancelled.abortObserved,
                popupClosedByHarness: cancelled.popupClosedByHarness,
                noTokenFetch: cancelled.tokenFetchCount === 0,
                credentialAbsent: cancelled.credentialAbsent,
            },
            'cancel'
        );

        const mismatch = await rejectMismatchedState(webDriver);
        assertOAuth(mismatch?.ok, `mismatch-${mismatch?.stage ?? 'failed'}`);
        assertChecks(
            {
                locallyRejected: mismatch.localStateMismatchRejected,
                attemptRetained: mismatch.attemptRetained,
                callbackCleared: mismatch.callbackCleared,
                completeDisabled: mismatch.completeDisabled,
                errorDoesNotEchoCallback: mismatch.errorDoesNotEchoCallback,
                noTokenFetch: mismatch.tokenFetchCount === 0,
            },
            'mismatch'
        );

        const switched = await switchSourceClearsAttempt(webDriver);
        assertOAuth(switched?.ok, 'source-switch');
        assertChecks(
            {
                sourceSwitched: switched.sourceSwitched,
                oauthRemovedOnCustom: switched.oauthRemovedOnCustom,
                sourceRestored: switched.sourceRestored,
                oldAttemptNotRestored: switched.oldAttemptNotRestored,
                abortObserved: switched.sourceSwitchAbortObserved,
                popupClosedByHarness: switched.popupClosedByHarness,
                noTokenFetch: switched.tokenFetchCount === 0,
                credentialAbsent: switched.credentialAbsent,
            },
            'source-switch'
        );

        const success = await completeValidLoopback(webDriver);
        assertOAuth(success?.ok, `success-${success?.stage ?? 'failed'}`);
        assertChecks(
            {
                signedIn: success.signedIn,
                signOutPresent: success.signOutPresent,
                attemptCleared: success.attemptCleared,
                callbackCleared: success.callbackCleared,
                successProgress: success.successProgress,
                oneMockExchange: success.tokenFetchCount === 1,
                tokenRequestShapeOk: success.tokenRequestShapeOk,
                pkceVerifierMatches: success.pkceVerifierMatches,
                tokenSignalPresent: success.tokenSignalPresent,
                tokenSignalLive: success.tokenSignalLive,
                tokenUrlsExact: success.tokenUrlsExact,
                noRealTokenRequest: success.realTokenRequests === 0,
                noRealAuthorizationRequest: success.realAuthRequests === 0,
                credentialMatchesMock: success.credentialMatchesMock,
                tokenNotDisplayed: success.tokenNotDisplayed,
                credentialAbsentFromProfiles: success.credentialAbsentFromProfiles,
                rootApiKeyDoesNotContainCredential: success.rootApiKeyDoesNotContainCredential,
                credentialAbsentFromOtherSettings: success.credentialAbsentFromOtherSettings,
                toastDoesNotContainCredential: success.toastDoesNotContainCredential,
                storageDoesNotContainCredential: success.storageDoesNotContainCredential,
                consoleDoesNotContainCredential: success.consoleDoesNotContainCredential,
                noUnexpectedOAuthTransport: success.noUnexpectedOAuthTransport,
                popupClosedByHarness: success.popupClosedByHarness,
            },
            'success'
        );

        await flushSettings(webDriver, scriptName);
        const browserUrl = await webDriver.execute('return window.location.href;');
        await webDriver.navigate(browserUrl);
        await waitForBrowser(
            webDriver,
            `
                const iframe = [...document.querySelectorAll('iframe')].find(frame =>
                    frame.id.startsWith('TH-script--' + arguments[0])
                );
                const root = [...document.querySelectorAll('#extensions_settings2 > div')]
                    .findLast(element => (element.textContent || '').includes('MVU Variable Framework'));
                return !!iframe?.contentWindow && /signed in|已登录/i.test(
                    root?.querySelector('.mvu-oauth-status > span')?.textContent || ''
                );
            `,
            [scriptName],
            'reload-signed-in-timeout',
            45_000
        );
        const reloadedSignedIn = await readReloadedStatus(webDriver, scriptName, credential, true);
        assertOAuth(reloadedSignedIn?.ok, 'reload-signed-in');
        assertChecks(
            {
                stateRestored: reloadedSignedIn.expectedStateVisible,
                credentialRestored: reloadedSignedIn.credentialStateCorrect,
                tokenNotDisplayed: reloadedSignedIn.tokenNotDisplayed,
                credentialAbsentFromOtherSettings:
                    reloadedSignedIn.credentialAbsentFromOtherSettings,
                noTokenExchange: reloadedSignedIn.realTokenRequests === 0,
                noAuthorizationRequest: reloadedSignedIn.realAuthRequests === 0,
            },
            'reload-signed-in'
        );

        const logoutProbeInstalled = await installOAuthProbe(
            webDriver,
            scriptName,
            credential,
            'reject'
        );
        assertOAuth(logoutProbeInstalled?.ok, 'logout-probe-install');
        const signedOut = await signOutThroughConfirmation(webDriver, scriptName);
        assertOAuth(signedOut?.ok, 'sign-out');
        assertChecks(
            {
                confirmationVisible: signedOut.confirmationVisible,
                affirmativePresent: signedOut.affirmativePresent,
                confirmationMentionsCredential: signedOut.confirmationMentionsCredential,
                confirmationDoesNotContainCredential:
                    signedOut.confirmationDoesNotContainCredential,
                confirmed: signedOut.confirmed,
                confirmationClosed: signedOut.confirmationClosed,
                signedOut: signedOut.signedOut,
                signInRestored: signedOut.signInRestored,
                signOutRemoved: signedOut.signOutRemoved,
                credentialDeleted: signedOut.credentialDeleted,
                logoutProgress: signedOut.logoutProgress,
                noTokenExchange: signedOut.realTokenRequests === 0,
                noGuardedTokenFetch: signedOut.guardedTokenFetchCount === 0,
                noUnexpectedOAuthTransport: signedOut.noUnexpectedOAuthTransport,
                consoleDoesNotContainCredential: signedOut.consoleDoesNotContainCredential,
            },
            'sign-out'
        );

        await flushSettings(webDriver, scriptName);
        await webDriver.navigate(browserUrl);
        await waitForBrowser(
            webDriver,
            `
                const iframe = [...document.querySelectorAll('iframe')].find(frame =>
                    frame.id.startsWith('TH-script--' + arguments[0])
                );
                const root = [...document.querySelectorAll('#extensions_settings2 > div')]
                    .findLast(element => (element.textContent || '').includes('MVU Variable Framework'));
                return !!iframe?.contentWindow && /not signed in|未登录/i.test(
                    root?.querySelector('.mvu-oauth-status > span')?.textContent || ''
                );
            `,
            [scriptName],
            'reload-signed-out-timeout',
            45_000
        );
        const reloadedSignedOut = await readReloadedStatus(
            webDriver,
            scriptName,
            credential,
            false
        );
        assertOAuth(reloadedSignedOut?.ok, 'reload-signed-out');
        assertChecks(
            {
                stateRestored: reloadedSignedOut.expectedStateVisible,
                credentialAbsent: reloadedSignedOut.credentialStateCorrect,
                tokenNotDisplayed: reloadedSignedOut.tokenNotDisplayed,
                credentialAbsentFromOtherSettings:
                    reloadedSignedOut.credentialAbsentFromOtherSettings,
                noTokenExchange: reloadedSignedOut.realTokenRequests === 0,
                noAuthorizationRequest: reloadedSignedOut.realAuthRequests === 0,
            },
            'reload-signed-out'
        );

        const unloaded = await beginAttemptThenUnload(webDriver, scriptName, credential);
        assertOAuth(unloaded?.ok, 'unload');
        assertChecks(
            {
                panelRemoved: unloaded.panelRemoved,
                iframeRemoved: unloaded.iframeRemoved,
                attemptAbortObserved: unloaded.attemptAbortObserved,
                popupClosedByHarness: unloaded.popupClosedByHarness,
                noTokenFetch: unloaded.tokenFetchCount === 0,
                consoleDoesNotContainCredential: unloaded.consoleDoesNotContainCredential,
                globalScriptRemoved: unloaded.globalScriptRemoved,
            },
            'unload'
        );

        const checks = {
            artifactLoaded: artifactBundleRequests >= 1,
            artifactHashStable,
            firefoxProfileTemporary,
            embeddedScriptsRejected: embeddedScriptsRejected >= 1,
            loginAttempt: initialAttempt.attemptVisible,
            cancelCleanup: cancelled.attemptCleared && cancelled.abortObserved,
            stateMismatchLocalOnly:
                mismatch.localStateMismatchRejected && mismatch.tokenFetchCount === 0,
            sourceSwitchCleanup:
                switched.oldAttemptNotRestored && switched.sourceSwitchAbortObserved,
            validLoopbackMockExchange:
                success.signedIn && success.tokenFetchCount === 1 && success.tokenRequestShapeOk,
            signedInReloadRestored:
                reloadedSignedIn.expectedStateVisible && reloadedSignedIn.realTokenRequests === 0,
            confirmedLogout:
                signedOut.confirmed &&
                signedOut.credentialDeleted &&
                signedOut.realTokenRequests === 0,
            signedOutReloadRestored:
                reloadedSignedOut.expectedStateVisible && reloadedSignedOut.credentialStateCorrect,
            unloadCleanup:
                unloaded.panelRemoved && unloaded.iframeRemoved && unloaded.attemptAbortObserved,
            noRealAuthorizationRequest:
                success.realAuthRequests === 0 &&
                reloadedSignedIn.realAuthRequests === 0 &&
                reloadedSignedOut.realAuthRequests === 0,
            noRealTokenRequest:
                success.realTokenRequests === 0 &&
                reloadedSignedIn.realTokenRequests === 0 &&
                signedOut.realTokenRequests === 0 &&
                reloadedSignedOut.realTokenRequests === 0,
            credentialNeverDisplayed:
                success.tokenNotDisplayed &&
                reloadedSignedIn.tokenNotDisplayed &&
                reloadedSignedOut.tokenNotDisplayed,
            credentialNotLeaked:
                success.credentialAbsentFromProfiles &&
                success.rootApiKeyDoesNotContainCredential &&
                success.credentialAbsentFromOtherSettings &&
                success.toastDoesNotContainCredential &&
                success.storageDoesNotContainCredential &&
                success.consoleDoesNotContainCredential &&
                unloaded.consoleDoesNotContainCredential,
            finalCredentialAbsent: reloadedSignedOut.credentialStateCorrect,
            popupInterceptedAndHarnessClosed:
                initialAttempt.popupIntercepted &&
                cancelled.popupClosedByHarness &&
                switched.popupClosedByHarness &&
                success.popupClosedByHarness &&
                unloaded.popupClosedByHarness,
        };
        assertChecks(checks, 'final');
        completed = true;
        return {
            ok: true,
            counts: {
                artifactBundleRequests,
                mockTokenExchanges: success.tokenFetchCount,
                realAuthorizationRequests: success.realAuthRequests,
                realTokenRequests: success.realTokenRequests,
            },
            checks,
        };
    } finally {
        if (!completed) {
            await bestEffortBrowserCleanup(webDriver);
        }
    }
}
