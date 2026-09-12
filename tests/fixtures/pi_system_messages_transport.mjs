/** 使用锁定版本的真实 Pi 适配器检查实际 HTTP 正文，所有网络请求均由本地 fetch 拦截。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as zlib from 'node:zlib';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const urls = new Map();
function moduleUrl(filename) {
    if (urls.has(filename)) return urls.get(filename);
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
    urls.set(filename, url);
    return url;
}
globalThis.fetch = async () => {
    throw new Error('Unexpected real network request');
};
const load = filename => import(moduleUrl(resolve(root, `src/function/update/pi/${filename}.ts`)));
const { toPiContext } = await load('context_adapter');
const { createPiSystemMessageBridge } = await load('system_messages');
const { transformPiPayload } = await load('payload');
const { createPiNonStreamingFetch } = await load('non_streaming_fetch');
const { createGoogleProxyAwareApi } = await load('google_proxy_adapter');
const gateway = await load('pi_gateway');
const adapters = {
    'openai-completions': gateway.openAICompletionsApi(),
    'openai-responses': gateway.openAIResponsesApi(),
    'openai-codex-responses': gateway.openAICodexResponsesApi(),
    'anthropic-messages': gateway.anthropicMessagesApi(),
    'mistral-conversations': gateway.mistralConversationsApi(),
    'google-generative-ai': createGoogleProxyAwareApi(gateway.googleGenerativeAIApi()),
};
const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfG8AAAAASUVORK5CYII=';
const image = {
    type: 'image_url',
    image_url: { url: `data:image/png;base64,${PNG}`, detail: 'auto' },
};
const tool = (id, name) => ({ id, type: 'function', function: { name, arguments: '{"value":1}' } });

/** 让真实适配器生成并发送请求，然后用确定性 400 结束；本测试只检查发送的内容。 */
async function capture(api, input, { baseline = false, nonStreaming = false } = {}) {
    const adapted = toPiContext(input);
    const bridge = baseline ? undefined : createPiSystemMessageBridge(adapted, api);
    const model = {
        id:
            api === 'anthropic-messages'
                ? 'claude-opus-4-8'
                : api === 'google-generative-ai'
                  ? 'gemini-2.5-flash'
                  : 'test-model',
        name: 'Test',
        api,
        provider:
            api === 'anthropic-messages'
                ? 'anthropic'
                : api === 'openai-codex-responses'
                  ? 'openai-codex'
                  : 'openai',
        baseUrl:
            api === 'openai-codex-responses'
                ? 'https://chatgpt.com/backend-api'
                : 'https://example.com',
        reasoning: false,
        input: ['text', 'image'],
        contextWindow: 128000,
        maxTokens: 4096,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    let body;
    let calls = 0;
    const send = async (input, init) => {
        calls++;
        const request = new Request(input, init);
        const bytes = Buffer.from(await request.arrayBuffer());
        // Codex 的 Node 传输会压缩请求，校验解压后的实际正文。
        body = JSON.parse(
            (request.headers.get('content-encoding') === 'zstd'
                ? zlib.zstdDecompressSync(bytes)
                : bytes
            ).toString('utf8')
        );
        return Response.json(
            { error: { type: 'invalid_request_error', message: 'local capture complete' } },
            { status: 400 }
        );
    };
    const token =
        api === 'openai-codex-responses'
            ? `e30.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test-account' } })).toString('base64url')}.signature`
            : 'test-api-key';
    const stream = adapters[api].stream(model, bridge?.context ?? adapted.context, {
        apiKey: token,
        maxTokens: 128,
        maxRetries: 0,
        transport: 'sse',
        cacheRetention: 'none',
        fetch: nonStreaming ? createPiNonStreamingFetch(api, send) : send,
        onPayload: payload => {
            const transformed = transformPiPayload(payload, { api });
            return bridge ? bridge.restore(transformed) : transformed;
        },
    });
    const result = await stream.result();
    assert.equal(
        calls,
        1,
        `${api}: no request: ${bridge?.failure?.message ?? result.errorMessage}`
    );
    assert.ok(body, `${api}: could not read request: ${result.errorMessage}`);
    bridge?.assertRestored();
    assert.ok(!JSON.stringify(body).includes('__mvu_pi_system_anchor_'), `${api}: leaked anchor`);
    return body;
}
const entries = (api, body) =>
    api === 'google-generative-ai'
        ? body.contents
        : api.includes('responses')
          ? body.input
          : body.messages;
const nativeSystems = list => list.filter(item => item.role === 'system');
// Pi 的 Completions 适配器用 null 表示纯工具助手消息；去掉定位文本后的空串语义相同。
const normalizeEmptyAssistant = list =>
    list.map(item =>
        item.role === 'assistant' && item.content === null ? { ...item, content: '' } : item
    );

for (const api of Object.keys(adapters).filter(api => api !== 'google-generative-ai')) {
    for (const nonStreaming of [false, true]) {
        const input = [
            { role: 'system', content: 'global' },
            { role: 'user', content: 'same' },
            { role: 'system', content: 'system-one' },
            { role: 'system', content: 'system-two' },
            { role: 'assistant', content: 'reply' },
            { role: 'user', content: 'same' },
            { role: 'system', content: 'system-tail' },
        ];
        const baseline = await capture(api, input, { baseline: true, nonStreaming });
        const body = await capture(api, input, { nonStreaming });
        const list = entries(api, body);
        const injected = item =>
            item.role === 'system' && String(item.content).startsWith('system-');
        assert.deepEqual(
            list.filter(item => !injected(item)),
            entries(api, baseline),
            `${api}: changed ordinary messages`
        );
        assert.deepEqual(
            nativeSystems(list)
                .filter(injected)
                .map(item => item.content),
            ['system-one', 'system-two', 'system-tail']
        );
        const one = list.findIndex(item => item.content === 'system-one');
        assert.equal(list[one - 1].role, 'user');
        assert.equal(list[one + 2].role, 'assistant');
        assert.equal(list.at(-1).content, 'system-tail');
    }

    const toolInput = [
        { role: 'system', content: 'global' },
        { role: 'user', content: [image, { type: 'text', text: 'inspect' }] },
        { role: 'system', content: 'system-before-tools' },
        { role: 'assistant', tool_calls: [tool('call|one', 'first'), tool('call|two', 'second')] },
        {
            role: 'tool',
            tool_call_id: 'call|one',
            content: [{ type: 'text', text: 'first-result' }, image],
        },
        { role: 'tool', tool_call_id: 'call|two', content: 'second-result' },
        { role: 'system', content: 'system-after-tools' },
        { role: 'assistant', content: 'complete' },
    ];
    const baseline = entries(api, await capture(api, toolInput, { baseline: true }));
    const actual = entries(api, await capture(api, toolInput));
    const ordinary = actual.filter(
        item => !(item.role === 'system' && String(item.content).startsWith('system-'))
    );
    assert.deepEqual(
        normalizeEmptyAssistant(ordinary),
        normalizeEmptyAssistant(baseline),
        `${api}: changed images or tool associations`
    );
    assert.ok(JSON.stringify(actual).includes(PNG), `${api}: lost image`);
    assert.ok(
        !JSON.stringify(actual).includes('No result provided'),
        `${api}: synthesized tool results`
    );

    if (api !== 'anthropic-messages') {
        // Responses 的工具输出可能拆成多个原生项；中途 system 不能诱发虚假的工具结果。
        const betweenTools = [...toolInput];
        betweenTools.splice(4, 0, { role: 'system', content: 'system-between-call-and-result' });
        const actual = entries(api, await capture(api, betweenTools));
        assert.ok(
            !JSON.stringify(actual).includes('No result provided'),
            `${api}: system interrupted tools`
        );
        assert.deepEqual(
            normalizeEmptyAssistant(
                actual.filter(
                    item => !(item.role === 'system' && String(item.content).startsWith('system-'))
                )
            ),
            normalizeEmptyAssistant(baseline)
        );

        for (const content of [[], [image]]) {
            const sparse = [
                { role: 'user', content: 'inspect' },
                { role: 'assistant', tool_calls: [tool('sparse-call', 'inspect')] },
                { role: 'system', content: 'system-before-sparse-result' },
                { role: 'tool', tool_call_id: 'sparse-call', content },
                { role: 'system', content: 'system-before-image-user' },
                { role: 'user', content: [image] },
            ];
            const baseline = entries(api, await capture(api, sparse, { baseline: true }));
            const actual = entries(api, await capture(api, sparse));
            assert.deepEqual(
                actual.filter(item => item.role !== 'system'),
                baseline,
                `${api}: changed image-only or empty content`
            );
        }
    }
}

// 同一个请求中仅不合法的位置回退；Google 的全部中途 system 都按 user 处理。
for (const api of ['anthropic-messages', 'google-generative-ai']) {
    for (const nonStreaming of [false, true]) {
        const mixed = [
            { role: 'system', content: 'global' },
            { role: 'user', content: 'first user' },
            { role: 'system', content: 'valid middle' },
            { role: 'assistant', content: 'first answer' },
            { role: 'system', content: 'invalid middle' },
            { role: 'user', content: 'second user' },
            { role: 'system', content: 'valid tail' },
        ];
        const body = await capture(api, mixed, { nonStreaming });
        const actual = entries(api, body);
        const google = api === 'google-generative-ai';
        const text = item =>
            typeof item.content === 'string'
                ? item.content
                : (google ? item.parts : item.content).map(block => block.text).join('|');
        assert.deepEqual(
            actual.map(item => [item.role, text(item)]),
            google
                ? [
                      ['user', 'first user|valid middle'],
                      ['model', 'first answer'],
                      ['user', 'invalid middle|second user|valid tail'],
                  ]
                : [
                      ['user', 'first user'],
                      ['system', 'valid middle'],
                      ['assistant', 'first answer'],
                      ['user', 'invalid middle|second user'],
                      ['system', 'valid tail'],
                  ],
            `${api}: wrong conditional fallback`
        );
        assert.ok(JSON.stringify(google ? body.systemInstruction : body.system).includes('global'));
    }

    // SDK 会合并相邻工具结果；回退指令仍须位于两份结果之间。
    const groupedTools = [
        { role: 'user', content: 'inspect' },
        {
            role: 'assistant',
            tool_calls: [tool('first-call', 'first'), tool('second-call', 'second')],
        },
        { role: 'tool', tool_call_id: 'first-call', content: 'first-result' },
        { role: 'system', content: 'between-results' },
        { role: 'tool', tool_call_id: 'second-call', content: 'second-result' },
    ];
    const serialized = JSON.stringify(entries(api, await capture(api, groupedTools)));
    assert.ok(serialized.indexOf('first-result') < serialized.indexOf('between-results'));
    assert.ok(serialized.indexOf('between-results') < serialized.indexOf('second-result'));
    assert.ok(!serialized.includes('No result provided'));
}

// 把仓库已有的三条真实 ST 提示词基线送入 SDK，逐条比较最终角色、文本及原顺序。
for (const name of ['current_preset', 'other_preset', 'builtin_jailbreak']) {
    const input = JSON.parse(
        readFileSync(resolve(root, `tests/fixtures/pi_prompt_capture/${name}.json`), 'utf8')
    ).pi;
    let leadingEnd = 0;
    while (input[leadingEnd]?.role === 'system') leadingEnd++;
    const globalSystem = input
        .slice(0, leadingEnd)
        .map(message => message.content)
        .join('\n\n');
    for (const api of [
        'openai-completions',
        'openai-responses',
        'openai-codex-responses',
        'mistral-conversations',
    ]) {
        const body = await capture(api, input);
        const actual = entries(api, body).map(item => ({
            role: item.role,
            content:
                typeof item.content === 'string'
                    ? item.content
                    : item.content.map(block => block.text).join(''),
        }));
        const expected = [...input.slice(leadingEnd)];
        if (api === 'openai-codex-responses') {
            assert.equal(body.instructions, globalSystem);
        } else if (globalSystem) {
            expected.unshift({ role: 'system', content: globalSystem });
        }
        assert.deepEqual(actual, expected, `${api}: ${name} lost roles, text or order`);
    }
}
console.log('All native system transport checks passed');
