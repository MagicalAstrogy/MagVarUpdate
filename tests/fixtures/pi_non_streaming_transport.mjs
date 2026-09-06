import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const module_urls = new Map();

// Compile the production TS modules without bundling or substituting any provider adapter.
function moduleUrl(filename) {
    if (module_urls.has(filename)) return module_urls.get(filename);
    const { outputText } = transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    });
    const code = outputText.replace(/from ['"]([^'"]+)['"]/g, (_, specifier) => {
        const target = specifier.startsWith('.')
            ? moduleUrl(resolve(dirname(filename), `${specifier}.ts`))
            : import.meta.resolve(specifier);
        return `from ${JSON.stringify(target)}`;
    });
    const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
    module_urls.set(filename, url);
    return url;
}

let current_case = 'loading';
try {
    globalThis.fetch = async () => {
        throw new Error('Unexpected real network request');
    };
    const { createPiNonStreamingFetch } = await import(
        moduleUrl(resolve(root, 'src/function/update/pi/non_streaming_fetch.ts'))
    );
    const { createSillyTavernProxyFetch } = await import(
        moduleUrl(resolve(root, 'src/function/update/pi/sillytavern_proxy.ts'))
    );
    const gateway = await import(moduleUrl(resolve(root, 'src/function/update/pi/pi_gateway.ts')));
    const { createGoogleProxyAwareApi } = await import(
        moduleUrl(resolve(root, 'src/function/update/pi/google_proxy_adapter.ts'))
    );
    const adapters = {
        'openai-completions': gateway.openAICompletionsApi(),
        'openai-responses': gateway.openAIResponsesApi(),
        'anthropic-messages': gateway.anthropicMessagesApi(),
        'google-generative-ai': createGoogleProxyAwareApi(gateway.googleGenerativeAIApi()),
        'mistral-conversations': gateway.mistralConversationsApi(),
    };
    const text = 'Variable update';
    const args = { value: 2, nested: { message: 'a "quoted" value' } };
    const chat_response = {
        id: 'chat-1',
        object: 'chat.completion',
        model: 'test-model',
        choices: [
            {
                index: 0,
                message: {
                    role: 'assistant',
                    content: text,
                    reasoning_content: 'Reasoning',
                    tool_calls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            function: { name: 'update', arguments: JSON.stringify(args) },
                        },
                        {
                            id: 'call-2',
                            type: 'function',
                            function: { name: 'update', arguments: '{"value":3}' },
                        },
                    ],
                },
                finish_reason: 'tool_calls',
            },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    };
    const responses_response = {
        id: 'resp-1',
        object: 'response',
        status: 'completed',
        output: [
            {
                id: 'rs_1',
                type: 'reasoning',
                summary: [{ type: 'summary_text', text: 'Reasoning' }],
            },
            {
                id: 'msg_1',
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text, annotations: [] }],
            },
            {
                id: 'fc_1',
                type: 'function_call',
                call_id: 'call-1',
                name: 'update',
                arguments: JSON.stringify(args),
            },
        ],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
    };
    const anthropic_response = {
        id: 'msg-1',
        type: 'message',
        role: 'assistant',
        model: 'test-model',
        content: [
            { type: 'thinking', thinking: 'Reasoning', signature: 'signature' },
            { type: 'text', text },
            { type: 'tool_use', id: 'call-1', name: 'update', input: args },
        ],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 10 },
    };
    const google_response = {
        responseId: 'gemini-1',
        candidates: [
            {
                index: 0,
                content: {
                    role: 'model',
                    parts: [
                        { text: 'Reasoning', thought: true, thoughtSignature: 'signature' },
                        { text },
                        { functionCall: { name: 'update', args } },
                    ],
                },
                finishReason: 'STOP',
            },
        ],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 },
    };
    const fixtures = {
        'openai-completions': chat_response,
        'openai-responses': responses_response,
        'anthropic-messages': anthropic_response,
        'google-generative-ai': google_response,
        'mistral-conversations': chat_response,
    };
    const context = {
        messages: [
            {
                role: 'user',
                content: [{ type: 'text', text: 'Update the variable' }],
                timestamp: Date.now(),
            },
        ],
        tools: [
            {
                name: 'update',
                description: 'Update a variable',
                parameters: { type: 'object', properties: { value: { type: 'number' } } },
            },
        ],
    };
    function model(api) {
        return {
            id: 'test-model',
            name: 'test-model',
            api,
            provider: 'test-provider',
            baseUrl: 'https://provider.test/v1',
            reasoning: false,
            input: ['text'],
            contextWindow: 128_000,
            maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        };
    }
    function run(api, fetch, signal) {
        return adapters[api]
            .stream(model(api), context, {
                apiKey: 'test-api-key',
                fetch,
                signal,
                maxTokens: 1024,
                maxRetries: 0,
            })
            .result();
    }

    for (const [api, fixture] of Object.entries(fixtures)) {
        current_case = `${api}: actual wire request and parsed text/tools`;
        let sent = 0;
        const fetch = createPiNonStreamingFetch(api, async (input, init) => {
            const request = new Request(input, init);
            const body = await request.json();
            assert.equal(request.headers.get('accept'), 'application/json');
            assert.equal(request.method, 'POST');
            if (api === 'google-generative-ai') {
                assert.ok(new URL(request.url).pathname.endsWith(':generateContent'));
                assert.equal(new URL(request.url).searchParams.has('alt'), false);
                assert.ok(body.contents.length);
                assert.equal(request.headers.get('x-goog-api-key'), 'test-api-key');
            } else {
                assert.equal(body.stream, false);
                assert.equal('stream_options' in body, false);
                assert.equal('tool_stream' in body, false);
                assert.ok(body.messages?.length || body.input?.length);
                assert.ok(request.headers.get('authorization') || request.headers.get('x-api-key'));
            }
            sent++;
            return Response.json(fixture, { headers: { 'x-test-response': 'preserved' } });
        });
        const result = await run(api, fetch);
        assert.equal(result.stopReason, 'toolUse', result.errorMessage);
        assert.equal(
            result.content
                .filter(block => block.type === 'text')
                .map(block => block.text)
                .join(''),
            text
        );
        const calls = result.content.filter(block => block.type === 'toolCall');
        assert.deepEqual(calls[0].arguments, args);
        if (api === 'openai-completions' || api === 'mistral-conversations') {
            assert.equal(calls.length, 2);
            assert.deepEqual(calls[1].arguments, { value: 3 });
        } else {
            assert.equal(calls.length, 1);
            assert.equal(
                result.content.find(block => block.type === 'thinking')?.thinking,
                'Reasoning'
            );
        }
        assert.equal(result.usage.input, 20);
        assert.equal(result.usage.output, 10);
        assert.equal(sent, 1);
    }

    current_case = 'proxy composition uses non-streaming HTTP and retains auth';
    let proxy_requests = 0;
    const proxy_fetch = createSillyTavernProxyFetch({
        baseUrl: 'https://provider.test/v1',
        origin: 'http://sillytavern.test',
        fetch: async (input, init) => {
            assert.ok(String(input).startsWith('/proxy/'));
            const target = decodeURIComponent(String(input).slice('/proxy/'.length));
            if (target.startsWith('data:')) return new Response('mvu-st-cors-proxy-probe');
            assert.ok(target.endsWith('/chat/completions'));
            assert.equal(JSON.parse(init.body).stream, false);
            assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-api-key');
            assert.equal(init.credentials, 'same-origin');
            proxy_requests++;
            return Response.json(chat_response);
        },
    });
    assert.equal(
        (
            await run(
                'openai-completions',
                createPiNonStreamingFetch('openai-completions', proxy_fetch)
            )
        ).stopReason,
        'toolUse'
    );
    assert.equal(proxy_requests, 1);

    current_case = 'provider errors and incomplete replies retain their terminal status';
    for (const [api, fixture] of [
        [
            'openai-completions',
            {
                ...chat_response,
                choices: [
                    { message: { role: 'assistant', content: 'partial' }, finish_reason: 'length' },
                ],
            },
        ],
        [
            'openai-responses',
            {
                ...responses_response,
                output: responses_response.output.slice(0, 2),
                status: 'incomplete',
                incomplete_details: { reason: 'max_output_tokens' },
            },
        ],
    ]) {
        const result = await run(
            api,
            createPiNonStreamingFetch(api, async () => Response.json(fixture))
        );
        assert.equal(result.stopReason, 'length', result.errorMessage);
    }
    const bad = await run(
        'openai-completions',
        createPiNonStreamingFetch('openai-completions', async () =>
            Response.json({ unexpected: 'body' })
        )
    );
    assert.equal(bad.stopReason, 'error');
    const denied = await run(
        'openai-completions',
        createPiNonStreamingFetch('openai-completions', async () =>
            Response.json({ error: { message: 'denied' } }, { status: 401 })
        )
    );
    assert.equal(denied.stopReason, 'error');

    current_case = 'native cancellation while waiting for a complete JSON response';
    const controller = new AbortController();
    let started;
    const dispatched = new Promise(resolve => {
        started = resolve;
    });
    const waiting = run(
        'openai-completions',
        createPiNonStreamingFetch('openai-completions', async (input, init) => {
            const request = new Request(input, init);
            return new Promise((_, reject) => {
                request.signal.addEventListener('abort', () => reject(request.signal.reason), {
                    once: true,
                });
                started();
            });
        }),
        controller.signal
    );
    await dispatched;
    controller.abort(new Error('User stopped generation'));
    assert.equal((await waiting).stopReason, 'aborted');

    current_case = 'non-generation traffic remains untouched';
    const request = new Request('https://provider.test/v1/models');
    const response = Response.json({ data: [] });
    const passthrough = createPiNonStreamingFetch('openai-completions', async (input, init) => {
        assert.equal(input, request);
        assert.equal(init, undefined);
        return response;
    });
    assert.equal(await passthrough(request), response);
    process.stdout.write('All non-streaming transport checks passed\n');
} catch (error) {
    process.stderr.write(`${current_case}: ${error.message}\n`);
    process.exitCode = 1;
}
