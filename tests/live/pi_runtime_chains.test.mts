/** 真实 SDK 和生产预检、转换、传输、结果处理的端到端测试，直接纳入 Jest 覆盖率。 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from '@jest/globals';
import { mkdirSync, writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import type { CredentialStore, FetchFunction } from '@/function/update/pi/pi_gateway';
import type { RunPiRequestInput } from '@/function/update/pi/runtime';
import {
    isLivePiCaseEnabled,
    livePiCases,
    liveProxyUrl,
    redactLivePiOutput,
    type LivePiCase,
} from './pi_live_cases';

const marker = 'MVU_PI_LIVE_OK';
// 生产转换器支持名字扩展，酒馆导出的 SendingMessage 类型暂未声明该字段。
const namedUser: SillyTavern.SendingMessage & { name: string } = {
    role: 'user',
    name: 'Tester',
    content: 'We are testing message conversion.',
};
const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const tool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'report_value',
        description: 'Report the exact string requested by the user.',
        parameters: {
            type: 'object',
            properties: { value: { type: 'string', enum: [marker] } },
            required: ['value'],
            additionalProperties: false,
        },
    },
};
const schema = { name: 'live_result', value: tool.function.parameters! };
const credentialStore: CredentialStore = {
    read: async () => undefined,
    list: async () => [],
    modify: async (_, update) => update(undefined),
    delete: async () => {},
};
let runtime: typeof import('@/function/update/pi/runtime');
let registry: typeof import('@/function/update/pi/controller_registry');
let endpoints: typeof import('@/function/update/pi/provider_target');
let localization: typeof import('@/function/update/pi/error_localization');
let dom: JSDOM;
let generation = 0;
const evidence: Array<Record<string, unknown>> = [];
const nativeResponseJson = Response.prototype.json;

beforeAll(async () => {
    // Node 的 Response.json 在宿主 realm 创建对象；Google SDK 还会用 Response 解析 SSE。
    // 在当前 Jest VM 中解析同一份真实响应正文，使普通对象语义与浏览器单 realm 一致。
    Response.prototype.json = async function () {
        return JSON.parse(await this.text());
    };
    dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
        url: liveProxyUrl || 'http://127.0.0.1/',
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
    runtime = await import('@/function/update/pi/runtime');
    registry = await import('@/function/update/pi/controller_registry');
    endpoints = await import('@/function/update/pi/provider_target');
    localization = await import('@/function/update/pi/error_localization');
});

afterEach(() => {
    expect(registry.getActivePiRequestIds()).toEqual([]);
});
afterAll(() => {
    Response.prototype.json = nativeResponseJson;
    mkdirSync('coverage/pi-live', { recursive: true });
    writeFileSync('coverage/pi-live/requests.json', JSON.stringify(evidence, null, 2));
    dom?.window.close();
});

/** 只使用测试提示词和显式连接，凭证不写入 Pinia，也不读写真实聊天或方案。 */
function settingsFor(testCase: LivePiCase, streaming = true) {
    return {
        应答格式: '聊天消息',
        密钥: testCase.apiKey,
        最大回复token数: 512,
        温度: 0,
        top_p: 1,
        top_k: 0,
        频率惩罚: 0,
        存在惩罚: 0,
        兼容假流式: streaming,
        pi: {
            provider: testCase.provider as string,
            api: testCase.api,
            authType: 'api_key',
            endpoint: testCase.provider === 'google' ? '' : testCase.endpoint,
            useProxy: false,
            model: testCase.model,
            contextWindow: 128_000,
            customHeaders: 'X-MVU-Live-Check: enabled\nX-MVU-Removed: null',
            customIncludeBody: '',
            customExcludeBody: '',
        },
    };
}

/** 留下必要的 HTTP 证据并继续调用真实服务；代理请求走指定酒馆的实际 /proxy 路由。 */
async function request(
    testCase: LivePiCase,
    label: string,
    overrides: Partial<RunPiRequestInput> = {},
    streaming = true
) {
    process.stderr.write(`Pi live: ${testCase.name} / ${label}\n`);
    const generationId = `pi-live-${++generation}`;
    const base = new URL(endpoints.normalizePiApiBaseEndpoint(testCase.api, testCase.endpoint));
    const observations: Array<{ body: any; status: number; proxied: boolean; error?: string }> = [];
    const eventTypes: string[] = [];
    const controller = new AbortController();
    const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(30_000),
        ...(overrides.signal ? [overrides.signal] : []),
    ]);
    const fetchImpl: FetchFunction = async (input, init) => {
        const rawUrl = input instanceof Request ? input.url : String(input);
        const proxied = rawUrl.startsWith('/proxy/');
        const target = proxied ? decodeURIComponent(rawUrl.slice('/proxy/'.length)) : rawUrl;
        const url = new URL(rawUrl, liveProxyUrl || dom.window.location.origin);
        if (target.startsWith('data:')) {
            expect(target).toBe('data:text/plain,mvu-st-cors-proxy-probe');
            return fetch(url, { ...init, redirect: 'error' });
        }
        const providerUrl = new URL(target);
        expect(providerUrl.origin === base.origin).toBe(true);
        const outbound =
            input instanceof Request ? new Request(input, init) : new Request(url, init);
        const headers = outbound.headers;
        const auth =
            testCase.provider === 'anthropic'
                ? headers.get('x-api-key')
                : testCase.provider === 'google'
                  ? headers.get('x-goog-api-key')
                  : headers.get('authorization')?.replace(/^Bearer /, '');
        expect(auth === testCase.apiKey).toBe(true);
        expect(headers.get('x-mvu-live-check')).toBe('enabled');
        expect(headers.has('x-mvu-removed')).toBe(false);
        expect(outbound.signal).toBeInstanceOf(AbortSignal);
        if (observations.length > 0) {
            controller.abort(new Error('Live test permits one generation request per call'));
            throw controller.signal.reason;
        }
        const body = await outbound.clone().json();
        if (testCase.provider === 'google') {
            expect(providerUrl.pathname).toBe(
                `/v1beta/models/${testCase.model}:${streaming ? 'streamGenerateContent' : 'generateContent'}`
            );
            expect(body.generationConfig.maxOutputTokens).toBe(512);
        } else {
            const suffix =
                testCase.api === 'openai-responses'
                    ? '/responses'
                    : testCase.api === 'anthropic-messages'
                      ? '/v1/messages'
                      : '/chat/completions';
            expect(providerUrl.pathname).toBe(`${base.pathname.replace(/\/$/, '')}${suffix}`);
            expect(body.model).toBe(testCase.model);
            expect(body.stream).toBe(streaming);
        }
        expect(JSON.stringify(body)).not.toContain('__mvu_pi_system_anchor_');
        const observation = { body, status: 0, proxied } as (typeof observations)[number];
        observations.push(observation);
        const response = await fetch(outbound, { redirect: 'error' });
        observation.status = response.status;
        if (!response.ok)
            observation.error = redactLivePiOutput(await response.clone().text()).slice(0, 1000);
        return response;
    };
    try {
        const result = await runtime.runPiRequest({
            settings: settingsFor(testCase, streaming),
            messages: [
                { role: 'system', content: 'Follow the requested output format exactly.' },
                {
                    role: 'user',
                    content: `Reply with exactly ${marker}, without punctuation or Markdown.`,
                },
            ],
            credentialStore,
            ...overrides,
            generationId,
            signal,
            fetch: fetchImpl,
            onProgress: async event => {
                eventTypes.push(event.type);
                await overrides.onProgress?.(event);
            },
        });
        expect(observations).toHaveLength(1);
        expect(observations[0].status).toBe(200);
        evidence.push({
            api: testCase.api,
            model: testCase.model,
            label,
            streaming,
            status: 200,
            proxied: observations[0].proxied,
            eventTypes,
        });
        return { result, body: observations[0].body, eventTypes };
    } catch (error) {
        evidence.push({
            api: testCase.api,
            model: testCase.model,
            label,
            streaming,
            statuses: observations.map(value => value.status),
            error: redactLivePiOutput(error instanceof Error ? error.message : error),
        });
        const providerErrors = observations.flatMap(value => (value.error ? [value.error] : []));
        if (signal.aborted && overrides.signal?.aborted) throw error;
        const sanitized = new Error(
            redactLivePiOutput(
                `${error instanceof Error ? error.message : error}${providerErrors.length ? `\n${providerErrors.join('\n')}` : ''}`
            )
        );
        if (error instanceof Error) sanitized.name = error.name;
        if (typeof error === 'object' && error !== null && 'code' in error)
            Object.assign(sanitized, { code: error.code });
        throw sanitized;
    }
}

for (const testCase of livePiCases) {
    const liveTest = isLivePiCaseEnabled(testCase) ? test : test.skip;
    describe(testCase.name, () => {
        liveTest.each([true, false])(
            'text with streaming=%s',
            async streaming => {
                const { result, eventTypes } = await request(testCase, 'text', {}, streaming);
                expect(typeof result === 'string' && result.trim() === marker).toBe(true);
                expect(eventTypes).toContain(streaming ? 'text_delta' : 'text_end');
            },
            40_000
        );

        liveTest(
            'tool call and tool-result history round trip',
            async () => {
                const messages: SillyTavern.SendingMessage[] = [
                    {
                        role: 'user',
                        content: `Call report_value exactly once with value "${marker}".`,
                    },
                ];
                const first = await request(testCase, 'tool', {
                    responseFormat: '工具调用',
                    tools: [tool],
                    messages,
                });
                expect(typeof first.result).toBe('object');
                const calls = (first.result as GenerateToolCallResult).tool_calls;
                expect(calls).toHaveLength(1);
                expect(calls[0].function.name).toBe('report_value');
                expect(JSON.parse(calls[0].function.arguments)).toEqual({ value: marker });
                const followup = await request(
                    testCase,
                    'tool-history',
                    {
                        responseFormat: '工具调用',
                        tools: [tool],
                        toolChoice: 'none',
                        messages: [
                            ...messages,
                            { role: 'assistant', content: '', tool_calls: calls },
                            {
                                role: 'tool',
                                content: JSON.stringify({ value: marker }),
                                tool_call_id: calls[0].id,
                            },
                            {
                                role: 'user',
                                content: `The tool is finished. Reply with exactly ${marker} as plain text.`,
                            },
                        ],
                    },
                    false
                );
                expect(
                    typeof followup.result === 'string' && followup.result.trim() === marker
                ).toBe(true);
                const historyPayload = JSON.stringify(followup.body);
                expect(historyPayload).toContain('report_value');
                expect(historyPayload).toContain(
                    {
                        'openai-responses': 'function_call_output',
                        'openai-completions': 'tool_call_id',
                        'anthropic-messages': 'tool_result',
                        'google-generative-ai': 'functionResponse',
                    }[testCase.api]
                );
            },
            75_000
        );

        liveTest(
            'native JSON Schema output through non-streaming transport',
            async () => {
                const { result } = await request(
                    testCase,
                    'json-schema',
                    {
                        responseFormat: '格式化输出',
                        jsonSchema: schema,
                        messages: [
                            {
                                role: 'user',
                                content: `Return JSON with the single property value equal to "${marker}".`,
                            },
                        ],
                    },
                    false
                );
                expect(typeof result).toBe('string');
                expect(JSON.parse(result as string)).toEqual({ value: marker });
            },
            40_000
        );

        if (testCase.provider === 'openai' || testCase.provider === 'google')
            liveTest(
                'v4 JSON object output',
                async () => {
                    const { result } = await request(testCase, 'json-object', {
                        responseFormat: '格式化输出(v4兼容)',
                        messages: [
                            {
                                role: 'user',
                                content: `Return JSON with the single property value equal to "${marker}".`,
                            },
                        ],
                    });
                    expect(JSON.parse(result as string)).toEqual({ value: marker });
                },
                40_000
            );

        liveTest(
            'named history and intermediate system conversion',
            async () => {
                const { result, body } = await request(testCase, 'context-system', {
                    messages: [
                        { role: 'system', content: 'Follow the requested output format exactly.' },
                        namedUser,
                        { role: 'assistant', content: 'Ready.' },
                        {
                            role: 'system',
                            content: 'Follow the final text instruction exactly.',
                        },
                        {
                            role: 'user',
                            content: `Reply with exactly ${marker}.`,
                        },
                    ],
                });
                expect(typeof result === 'string' && result.trim() === marker).toBe(true);
                expect(JSON.stringify(body)).toContain('Tester');
                expect(JSON.stringify(body)).toContain(
                    'Follow the final text instruction exactly.'
                );
            },
            40_000
        );

        if (
            testCase.provider === 'google' ||
            (testCase.name === 'OPENAI' &&
                /^https:\/\/openrouter\.ai(?::443)?\//i.test(testCase.endpoint))
        ) {
            liveTest(
                'catalogued model accepts image input',
                async () => {
                    const settings = settingsFor(testCase);
                    if (testCase.name === 'OPENAI') {
                        // 同一个 OpenRouter 目标使用其已登记目录，取得经过验证的图片能力。
                        expect(new URL(testCase.endpoint).hostname).toBe('openrouter.ai');
                        settings.pi.provider = 'openrouter';
                        settings.pi.endpoint = '';
                    }
                    const { result, body } = await request(testCase, 'catalog-image', {
                        settings,
                        messages: [
                            {
                                role: 'user',
                                content: [
                                    {
                                        type: 'text',
                                        text: `Ignore the image content and reply with exactly ${marker}.`,
                                    },
                                    {
                                        type: 'image_url',
                                        image_url: {
                                            url: `data:image/png;base64,${png}`,
                                            detail: 'low',
                                        },
                                    },
                                ],
                            },
                        ],
                    });
                    expect(typeof result === 'string' && result.trim() === marker).toBe(true);
                    expect(JSON.stringify(body)).toContain(png);
                },
                40_000
            );
        }

        liveTest(
            'custom body fields reach the native request',
            async () => {
                const settings = settingsFor(testCase, false);
                settings.pi.customIncludeBody =
                    testCase.provider === 'google'
                        ? 'config:\n  candidateCount: 1'
                        : 'metadata:\n  user_id: mvu-pi-live';
                settings.pi.customExcludeBody =
                    testCase.provider === 'google' ? '- config.stopSequences' : '- temperature';
                const { result, body } = await request(
                    testCase,
                    'custom-body',
                    { settings },
                    false
                );
                expect(typeof result === 'string' && result.trim() === marker).toBe(true);
                if (testCase.provider === 'google')
                    expect(body.generationConfig.candidateCount).toBe(1);
                else {
                    expect(body.metadata).toEqual({ user_id: 'mvu-pi-live' });
                    expect(body).not.toHaveProperty('temperature');
                }
            },
            40_000
        );

        if (testCase.name === 'RESPONSES') {
            liveTest(
                'maps an actual provider rejection without exposing credentials',
                async () => {
                    let caught: unknown;
                    try {
                        await request(
                            { ...testCase, model: 'mvu-live-nonexistent-model' },
                            'provider-rejection'
                        );
                    } catch (error) {
                        caught = error;
                    }
                    expect(caught).toMatchObject({ code: 'provider' });
                    const message = localization.getLocalizedPiErrorMessage(caught);
                    expect(message.trim().length).toBeGreaterThan(0);
                    expect(message.includes(testCase.apiKey)).toBe(false);
                    Object.assign(evidence.at(-1)!, { expectedFailure: true });
                },
                40_000
            );
            const proxyTest = isLivePiCaseEnabled(testCase) && liveProxyUrl ? test : test.skip;
            proxyTest(
                'custom endpoint through the real SillyTavern proxy',
                async () => {
                    const settings = settingsFor(testCase, false);
                    settings.pi.useProxy = true;
                    const { result } = await request(
                        testCase,
                        'sillytavern-proxy',
                        { settings },
                        false
                    );
                    expect(typeof result === 'string' && result.trim() === marker).toBe(true);
                    expect(evidence.at(-1)?.proxied).toBe(true);
                },
                40_000
            );
        }

        liveTest(
            'cancels an actual stream and releases its request controller',
            async () => {
                const controller = new AbortController();
                await expect(
                    request(testCase, 'cancel-stream', {
                        signal: controller.signal,
                        messages: [
                            {
                                role: 'user',
                                content: 'Count from 1 to 300, writing each number separately.',
                            },
                        ],
                        onProgress: event => {
                            if (event.type === 'text_delta')
                                controller.abort(new Error('Live test cancellation'));
                        },
                    })
                ).rejects.toMatchObject({ name: 'PiRequestAbortedError' });
                expect(controller.signal.aborted).toBe(true);
            },
            40_000
        );
    });
}

// 简化选项也是 Google 桥接公开的真实链路；在同一个 ESM 进程中记录思考配置和用量转换。
describe('GOOGLE simplified SDK options', () => {
    const google = livePiCases.find(testCase => testCase.provider === 'google')!;
    const liveTest = isLivePiCaseEnabled(google) ? test : test.skip;
    liveTest.each([undefined, 'low'] as const)(
        'reasoning=%s uses instance fetch and maps usage',
        async reasoning => {
            const gateway = await import('@/function/update/pi/pi_gateway');
            const { createGoogleProxyAwareApi } = await import(
                '@/function/update/pi/google_proxy_adapter'
            );
            const model = gateway.GOOGLE_MODELS[google.model as keyof typeof gateway.GOOGLE_MODELS];
            expect(model).toBeDefined();
            const adapter = createGoogleProxyAwareApi(gateway.googleGenerativeAIApi());
            let requests = 0;
            const nativeFetch = globalThis.fetch;
            const stream = adapter.streamSimple(
                model,
                {
                    messages: [
                        {
                            role: 'user',
                            content: `Reply with exactly ${marker}, without punctuation, Markdown, or explanation.`,
                            timestamp: Date.now(),
                        },
                    ],
                },
                {
                    apiKey: google.apiKey,
                    maxTokens: 512,
                    temperature: 0,
                    reasoning,
                    maxRetries: 0,
                    signal: AbortSignal.timeout(30_000),
                    fetch: async (input, init) => {
                        const outbound = new Request(input, init);
                        expect(new URL(outbound.url).origin).toBe(new URL(google.endpoint).origin);
                        expect(outbound.headers.get('x-goog-api-key') === google.apiKey).toBe(true);
                        expect(++requests).toBe(1);
                        return nativeFetch(outbound, { redirect: 'error' });
                    },
                }
            );
            const eventTypes: string[] = [];
            for await (const event of stream) eventTypes.push(event.type);
            const result = await stream.result();
            if (result.stopReason !== 'stop')
                throw new Error(redactLivePiOutput(result.errorMessage || result.stopReason));
            expect(
                result.content
                    .filter(block => block.type === 'text')
                    .map(block => block.text)
                    .join('')
                    .trim()
            ).toBe(marker);
            expect(result.usage.input).toBeGreaterThan(0);
            expect(result.usage.output).toBeGreaterThan(0);
            expect(eventTypes).toContain('text_delta');
            expect(globalThis.fetch).toBe(nativeFetch);
            evidence.push({
                api: google.api,
                model: google.model,
                label: `stream-simple-${reasoning || 'off'}`,
                status: 200,
                requests,
                eventTypes,
            });
        },
        40_000
    );
});

/** 真实预检与转换器必须在这些场景中先拒绝请求，再允许任何网络发送。 */
describe('production guards without network', () => {
    const base: LivePiCase = {
        name: 'guard',
        provider: 'openai',
        api: 'openai-responses',
        endpoint: 'https://example.invalid/v1',
        apiKey: 'test-only-no-network',
        model: 'gpt-4.1-mini',
    };
    test.each([
        'budget',
        'invalid-context',
        'unsupported-image',
        'protected-payload',
        'unsupported-format',
    ])('%s rejects before sending', async failure => {
        let dispatched = false;
        const settings = settingsFor(base);
        const messages: SillyTavern.SendingMessage[] = [{ role: 'user', content: marker }];
        if (failure === 'budget') {
            settings.pi.contextWindow = 600;
            messages[0].content = marker.repeat(500);
        } else if (failure === 'unsupported-format') {
            settings.应答格式 = '格式化输出(v4兼容)';
            settings.pi.provider = 'anthropic';
            settings.pi.api = 'anthropic-messages';
            settings.pi.endpoint = 'https://example.invalid';
            settings.pi.model = 'claude-haiku-4-5';
        } else if (failure === 'invalid-context')
            messages[0].content = [
                {
                    type: 'image_url',
                    image_url: { url: 'https://example.invalid/image.png', detail: 'low' },
                },
            ];
        else if (failure === 'unsupported-image')
            messages[0].content = [
                {
                    type: 'image_url',
                    image_url: { url: `data:image/png;base64,${png}`, detail: 'low' },
                },
            ];
        else settings.pi.customIncludeBody = 'model: forbidden-override';
        let caught: unknown;
        try {
            await runtime.runPiRequest({
                settings,
                messages,
                generationId: `guard-${failure}`,
                credentialStore,
                fetch: async () => {
                    dispatched = true;
                    throw new Error('Unexpected network request');
                },
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeDefined();
        expect(dispatched).toBe(false);
        expect(localization.getLocalizedPiErrorMessage(caught)).not.toContain(
            'test-only-no-network'
        );
    });
});
