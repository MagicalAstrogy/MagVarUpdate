import type { CredentialStore, FetchFunction } from '@/function/update/pi/pi_gateway';
import { JSDOM } from 'jsdom';

type LiveCase = Readonly<{
    name: string;
    provider: 'openai' | 'anthropic';
    api: 'openai-responses' | 'openai-completions' | 'anthropic-messages';
    endpoint: string;
    expectedPath: string;
    expectedAuthHeader: 'authorization' | 'x-api-key';
}>;

const LIVE_CASES: readonly LiveCase[] = [
    {
        name: 'openai-responses',
        provider: 'openai',
        api: 'openai-responses',
        endpoint: 'https://openrouter.ai/api/v1',
        expectedPath: '/api/v1/responses',
        expectedAuthHeader: 'authorization',
    },
    {
        name: 'anthropic-messages',
        provider: 'anthropic',
        api: 'anthropic-messages',
        endpoint: 'https://openrouter.ai/api',
        expectedPath: '/api/v1/messages',
        expectedAuthHeader: 'x-api-key',
    },
    {
        name: 'openai-completions',
        provider: 'openai',
        api: 'openai-completions',
        endpoint: 'https://openrouter.ai/api/v1',
        expectedPath: '/api/v1/chat/completions',
        expectedAuthHeader: 'authorization',
    },
] as const;
const LIVE_MODEL = process.env.MVU_PI_OPENROUTER_MODEL ?? 'inclusionai/ling-3.0-flash-fin:free';

let currentStage = 'bootstrap';

function makeCredentialStore(): CredentialStore {
    return {
        async read() {
            return undefined;
        },
        async list() {
            return [];
        },
        async modify(_provider, update) {
            return update(undefined);
        },
        async delete() {},
    };
}

async function main(): Promise<void> {
    currentStage = 'credential';
    const apiKey = process.env.MVU_PI_OPENROUTER_API_KEY ?? '';
    if (!apiKey) {
        throw new Error('missing live-test credential');
    }

    // Runtime imports reach Vue's browser runtime, the persisted credential store and i18n
    // modules. Provide a real, isolated DOM; the live request still supplies its own in-memory
    // CredentialStore and never initializes the Pinia settings store.
    currentStage = 'browser-locale-shim';
    const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
        url: 'http://127.0.0.1/',
    });
    Object.assign(globalThis, {
        window: dom.window,
        document: dom.window.document,
        localStorage: dom.window.localStorage,
        sessionStorage: dom.window.sessionStorage,
        Element: dom.window.Element,
        HTMLElement: dom.window.HTMLElement,
        Node: dom.window.Node,
        CustomEvent: dom.window.CustomEvent,
        SillyTavern: { getCurrentLocale: () => 'en' },
    });

    currentStage = 'runtime-import';
    const { runPiRequest } = await import('@/function/update/pi/runtime');
    const summaries: Array<Record<string, unknown>> = [];

    for (const [caseIndex, testCase] of LIVE_CASES.entries()) {
        currentStage = testCase.name;
        const observations: Array<{
            path: string;
            status: number;
            contentType: string | null;
            hasExplicitSignal: boolean;
            signalAbortedAtDispatch: boolean;
            hasExpectedAuth: boolean;
            allowOrigin: string | null;
        }> = [];
        const liveFetch: FetchFunction = async (input, init) => {
            const request = new Request(input, init);
            const headers = new Headers(request.headers);
            headers.set('origin', 'http://127.0.0.1:8000');
            const outbound = new Request(request, { headers });
            const response = await fetch(outbound);
            observations.push({
                path: new URL(outbound.url).pathname,
                status: response.status,
                contentType: response.headers.get('content-type'),
                hasExplicitSignal: init?.signal instanceof AbortSignal,
                signalAbortedAtDispatch: init?.signal?.aborted === true,
                hasExpectedAuth: outbound.headers.has(testCase.expectedAuthHeader),
                allowOrigin: response.headers.get('access-control-allow-origin'),
            });
            return response;
        };

        try {
            const result = await runPiRequest({
                settings: {
                    应答格式: '聊天消息',
                    密钥: apiKey,
                    最大回复token数: 512,
                    温度: 0,
                    top_p: 1,
                    top_k: 0,
                    频率惩罚: 0,
                    存在惩罚: 0,
                    pi: {
                        provider: testCase.provider,
                        api: testCase.api,
                        authType: 'api_key',
                        endpoint: testCase.endpoint,
                        model: LIVE_MODEL,
                        contextWindow: 200_000,
                        customHeaders: '',
                        customIncludeBody: '',
                        customExcludeBody: '',
                    },
                },
                messages: [{ role: 'user', content: 'Reply with exactly MVU_PI_OK' }],
                generationId: `openrouter-live-${testCase.api}`,
                credentialStore: makeCredentialStore(),
                fetch: liveFetch,
            });
            const passed =
                typeof result === 'string' &&
                result.includes('MVU_PI_OK') &&
                observations.length > 0 &&
                observations.every(observation => observation.path === testCase.expectedPath) &&
                observations.every(observation => observation.hasExplicitSignal) &&
                observations.every(observation => !observation.signalAbortedAtDispatch) &&
                observations.every(observation => observation.hasExpectedAuth) &&
                observations.every(observation => observation.allowOrigin === '*');
            summaries.push({
                name: testCase.name,
                ok: passed,
                requestCount: observations.length,
                pathMatched: observations.every(
                    observation => observation.path === testCase.expectedPath
                ),
                signalPresent: observations.every(observation => observation.hasExplicitSignal),
                authHeaderPresent: observations.every(observation => observation.hasExpectedAuth),
                corsAllowed: observations.every(observation => observation.allowOrigin === '*'),
                responseMatched: typeof result === 'string' && result.includes('MVU_PI_OK'),
            });
        } catch (error) {
            const rateLimited = observations.some(observation => observation.status === 429);
            summaries.push({
                name: testCase.name,
                ok: false,
                errorName: error instanceof Error ? error.name : 'UnknownError',
                errorMessage: error instanceof Error ? error.message.slice(0, 300) : null,
                errorCode:
                    typeof error === 'object' && error !== null && 'code' in error
                        ? String(error.code)
                        : null,
                observations,
            });
            if (rateLimited) {
                for (const skippedCase of LIVE_CASES.slice(caseIndex + 1)) {
                    summaries.push({
                        name: skippedCase.name,
                        ok: false,
                        skipped: 'upstream-rate-limit',
                    });
                }
                break;
            }
        }
    }

    console.log(JSON.stringify(summaries, null, 2));
    if (summaries.some(summary => summary.ok !== true)) {
        process.exitCode = 1;
    }
}

void main().catch(error => {
    console.error(
        JSON.stringify({
            ok: false,
            stage: currentStage,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            errorMessage: error instanceof Error ? error.message.slice(0, 240) : null,
        })
    );
    process.exitCode = 1;
});
