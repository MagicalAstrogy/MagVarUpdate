/** 使用真实 Pi/Google SDK 和 Google API 验证实例级 fetch 注入；密钥只从环境读取。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const apiKey = process.env.GEMINI_API_KEY?.trim() ?? '';
const scenario = process.argv[2];
const expectedText = 'MVU_GOOGLE_OK';
const moduleUrls = new Map();

/** Jest 使用 CommonJS；在隔离 ESM 进程内加载生产 TypeScript，保留真实 SDK。 */
function moduleUrl(filename) {
    if (moduleUrls.has(filename)) return moduleUrls.get(filename);
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
    moduleUrls.set(filename, url);
    return url;
}

/** 只输出经过脱敏且有长度上限的错误消息，不输出请求对象、头部或完整错误堆栈。 */
function redact(message) {
    return String(message)
        .replaceAll(apiKey, '<credential-redacted>')
        .replace(/AIza[A-Za-z0-9_-]+/g, '<credential-redacted>')
        .slice(0, 2000);
}

async function main() {
    if (!apiKey) {
        process.stdout.write(
            `${JSON.stringify({ skipped: true, reason: 'GEMINI_API_KEY is unset' })}\n`
        );
        return;
    }
    assert.ok(['stream', 'non-stream', 'tool', 'json'].includes(scenario), 'Unknown live scenario');
    const load = name => import(moduleUrl(resolve(root, `src/function/update/pi/${name}.ts`)));
    const gateway = await load('pi_gateway');
    const { createGoogleProxyAwareApi } = await load('google_proxy_adapter');
    const { createPiNonStreamingFetch } = await load('non_streaming_fetch');
    const { transformPiPayload } = await load('payload');
    const modelId = process.env.MVU_PI_GOOGLE_MODEL?.trim() || 'gemini-flash-lite-latest';
    const model = gateway.GOOGLE_MODELS[modelId];
    assert.ok(model, 'MVU_PI_GOOGLE_MODEL must name a model in the pinned Google catalog');
    assert.equal(new URL(model.baseUrl).origin, 'https://generativelanguage.googleapis.com');

    // 给出单独的 fetch 引用，确保实际进入本地桥接而非直接委托给 Pi 上游适配器。
    const originalFetch = globalThis.fetch;
    const records = [];
    const expectedMethod = scenario === 'non-stream' ? 'generateContent' : 'streamGenerateContent';
    const injectedFetch = async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        assert.equal(url.origin, 'https://generativelanguage.googleapis.com');
        assert.equal(url.pathname, `/v1beta/models/${model.id}:${expectedMethod}`);
        assert.equal(url.searchParams.get('alt'), scenario === 'non-stream' ? null : 'sse');
        assert.equal(request.method, 'POST');
        assert.ok(
            request.headers.get('x-goog-api-key') === apiKey,
            'API key header was not preserved'
        );
        assert.ok(request.signal instanceof AbortSignal, 'Injected fetch lost cancellation');
        const body = await request.clone().json();
        assert.ok(body.contents?.length > 0, 'Google request has no messages');
        assert.equal(body.generationConfig?.maxOutputTokens, 256);
        if (scenario === 'tool') {
            assert.equal(body.toolConfig?.functionCallingConfig?.mode, 'ANY');
            assert.equal(body.tools?.[0]?.functionDeclarations?.[0]?.name, 'report_value');
        }
        if (scenario === 'json') {
            assert.equal(body.generationConfig?.responseMimeType, 'application/json');
            assert.ok(body.generationConfig?.responseJsonSchema, 'JSON schema was not sent');
        }
        const record = { path: url.pathname, status: 0 };
        records.push(record);
        const response = await originalFetch(request);
        record.status = response.status;
        return response;
    };
    const api = createGoogleProxyAwareApi(gateway.googleGenerativeAIApi());
    const context = {
        systemPrompt: 'Follow the requested output format exactly. Do not add explanations.',
        messages: [
            {
                role: 'user',
                content:
                    scenario === 'tool'
                        ? `Call report_value exactly once with value "${expectedText}".`
                        : scenario === 'json'
                          ? `Return a JSON object with the single property value equal to "${expectedText}".`
                          : `Reply with exactly ${expectedText}, without punctuation or Markdown.`,
                timestamp: Date.now(),
            },
        ],
        ...(scenario === 'tool'
            ? {
                  tools: [
                      {
                          name: 'report_value',
                          description: 'Report the exact value requested by the user.',
                          parameters: gateway.Type.Object({
                              value: gateway.Type.Literal(expectedText),
                          }),
                      },
                  ],
              }
            : {}),
    };
    const options = {
        apiKey,
        maxTokens: 256,
        maxRetries: 0,
        temperature: 0,
        signal: AbortSignal.timeout(30_000),
        fetch:
            scenario === 'non-stream'
                ? createPiNonStreamingFetch('google-generative-ai', injectedFetch)
                : injectedFetch,
        ...(scenario === 'json'
            ? {
                  onPayload: payload =>
                      transformPiPayload(payload, {
                          api: 'google-generative-ai',
                          responseFormat: '格式化输出',
                          jsonSchema: {
                              name: 'live_result',
                              value: {
                                  type: 'object',
                                  properties: { value: { type: 'string', enum: [expectedText] } },
                                  required: ['value'],
                                  additionalProperties: false,
                              },
                          },
                      }),
              }
            : {}),
    };
    const stream =
        scenario === 'tool'
            ? api.stream(model, context, {
                  ...options,
                  toolChoice: 'any',
                  thinking: { enabled: false },
              })
            : api.streamSimple(model, context, options);
    const eventTypes = [];
    for await (const event of stream) eventTypes.push(event.type);
    const result = await stream.result();
    if (result.stopReason === 'error' || result.stopReason === 'aborted') {
        throw new Error(
            `Google ${scenario} failed (HTTP ${records.at(-1)?.status ?? 'not sent'}): ${redact(result.errorMessage ?? result.stopReason)}`
        );
    }
    assert.equal(records.length, 1, 'Expected exactly one injected HTTP request');
    assert.equal(records[0].status, 200);
    assert.equal(globalThis.fetch, originalFetch, 'The adapter modified global fetch');
    assert.equal(eventTypes[0], 'start');
    assert.equal(eventTypes.at(-1), 'done');
    assert.ok(result.usage.input > 0 && result.usage.output > 0, 'Token usage was not mapped');
    if (scenario === 'tool') {
        assert.equal(result.stopReason, 'toolUse');
        assert.ok(eventTypes.includes('toolcall_end'), 'No complete tool-call event');
        const calls = result.content.filter(block => block.type === 'toolCall');
        assert.equal(calls.length, 1);
        assert.ok(calls[0].id, 'Tool call has no ID');
        assert.equal(calls[0].name, 'report_value');
        assert.deepEqual(calls[0].arguments, { value: expectedText });
    } else {
        assert.equal(result.stopReason, 'stop');
        assert.ok(eventTypes.includes('text_delta'), 'No text delta event');
        const text = result.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('')
            .trim();
        if (scenario === 'json') assert.deepEqual(JSON.parse(text), { value: expectedText });
        else assert.equal(text, expectedText);
    }
    process.stdout.write(
        `${JSON.stringify({ scenario, passed: true, model: model.id, requests: records.length, outputTokens: result.usage.output })}\n`
    );
}

main().catch(error => {
    process.stderr.write(`${redact(error instanceof Error ? error.message : error)}\n`);
    process.exitCode = 1;
});
