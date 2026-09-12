import type { FetchFunction } from './pi_gateway';
import type { PiWireApi } from './provider_target';

/** 尚待逐字段校验的协议 JSON 对象，用于非流式响应和本地合成的流事件。 */
type JsonObject = Record<string, unknown>;

/** 校验响应结构为非空、非数组对象。 */
function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 拒绝不符合协议的非流式响应，不将可能包含提示词或凭证的响应正文写入错误。 */
function invalidResponse(): never {
    // Do not include provider bodies: they can echo prompts, headers, or credentials.
    throw new Error('More source received an invalid non-streaming response');
}

/** 把单个协议事件编码为 SSE 文本，供 Pi 现有流解析器消费。 */
function event(data: JsonObject): string {
    return `${typeof data.type === 'string' ? `event: ${data.type}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
}

/** 把 Chat Completions 完整响应转换为增量结束事件，补齐工具调用下标。 */
function completionEvents(response: JsonObject): string {
    if (!Array.isArray(response.choices) || response.choices.length === 0) {
        return invalidResponse();
    }
    const choices = response.choices.map((choice: unknown, index) => {
        if (
            !isObject(choice) ||
            !isObject(choice.message) ||
            typeof choice.finish_reason !== 'string' ||
            !choice.finish_reason
        ) {
            return invalidResponse();
        }
        const delta = { ...choice.message };
        if (Array.isArray(delta.tool_calls)) {
            delta.tool_calls = delta.tool_calls.map((call: unknown, index) => {
                if (!isObject(call)) {
                    return invalidResponse();
                }
                return { ...call, index };
            });
        }
        const { message: _message, ...rest } = choice;
        return { ...rest, index, delta };
    });
    return event({ ...response, object: 'chat.completion.chunk', choices }) + 'data: [DONE]\n\n';
}

/** 把 Responses 完整输出转换为输出项事件和终态事件，保留失败与截断状态。 */
function responsesEvents(response: JsonObject): string {
    const status = response.status;
    if (!['completed', 'incomplete', 'failed', 'cancelled'].includes(String(status))) {
        return invalidResponse();
    }
    if (!Array.isArray(response.output)) {
        return invalidResponse();
    }
    return (
        response.output
            .map((item: unknown, output_index) => {
                if (!isObject(item)) {
                    return invalidResponse();
                }
                return event({ type: 'response.output_item.done', output_index, item });
            })
            .join('') +
        event({
            type: `response.${status === 'cancelled' ? 'failed' : status}`,
            response,
        })
    );
}

/** 把 Anthropic 完整响应转换为消息和内容块事件，工具参数通过增量事件交给 Pi 解析。 */
function anthropicEvents(response: JsonObject): string {
    if (!Array.isArray(response.content) || typeof response.stop_reason !== 'string') {
        return invalidResponse();
    }
    const usage = isObject(response.usage) ? response.usage : {};
    let result = event({
        type: 'message_start',
        message: { ...response, content: [], usage },
    });
    response.content.forEach((block: unknown, index) => {
        if (!isObject(block)) {
            return invalidResponse();
        }
        result += event({
            type: 'content_block_start',
            index,
            content_block: block.type === 'tool_use' ? { ...block, input: {} } : block,
        });
        // Pi finalizes tool arguments from the delta buffer, even when start has an input.
        if (block.type === 'tool_use') {
            result += event({
                type: 'content_block_delta',
                index,
                delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
            });
        }
        result += event({ type: 'content_block_stop', index });
    });
    return (
        result +
        event({
            type: 'message_delta',
            delta: {
                stop_reason: response.stop_reason,
                stop_sequence: response.stop_sequence,
                stop_details: response.stop_details,
            },
            usage,
        }) +
        event({ type: 'message_stop' })
    );
}

/** 按请求协议选择非流式响应转换器，拒绝错误对象和不支持的响应结构。 */
function toEvents(api: PiWireApi, response: unknown): string {
    if (!isObject(response) || response.error) {
        return invalidResponse();
    }
    switch (api) {
        case 'openai-completions':
        case 'mistral-conversations':
            return completionEvents(response);
        case 'openai-responses':
            return responsesEvents(response);
        case 'anthropic-messages':
            return anthropicEvents(response);
        case 'google-generative-ai':
            if (!Array.isArray(response.candidates)) {
                return invalidResponse();
            }
            return event(response);
        default:
            return invalidResponse();
    }
}

/** 识别需要改写传输方式的生成接口，避免影响认证和模型列表等其他请求。 */
function isGenerationUrl(api: PiWireApi, url: URL): boolean {
    switch (api) {
        case 'openai-completions':
        case 'mistral-conversations':
            return url.pathname.endsWith('/chat/completions');
        case 'openai-responses':
            return url.pathname.endsWith('/responses');
        case 'anthropic-messages':
            return url.pathname.endsWith('/messages');
        case 'google-generative-ai':
            return url.pathname.endsWith(':streamGenerateContent');
        default:
            return false;
    }
}

/**
 * 保留 Pi 的请求构造、认证和结果解析，只将支持的生成请求改为真正的非流式 HTTP。
 * 返回的 JSON 在本地转换为 Pi 可消费的事件流；Codex 的强制流式协议保持原样。
 */
export function createPiNonStreamingFetch(
    api: PiWireApi,
    fetch_impl?: FetchFunction
): FetchFunction {
    return async (input, init) => {
        const send = fetch_impl ?? globalThis.fetch;
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (request.method !== 'POST' || !isGenerationUrl(api, url)) {
            return send(input, init);
        }
        request.signal.throwIfAborted();
        const body: unknown = await request.json();
        if (!isObject(body)) {
            throw new Error('More source requires a JSON request body');
        }
        if (api === 'google-generative-ai') {
            url.pathname = url.pathname.replace(/:streamGenerateContent$/, ':generateContent');
            if (url.searchParams.get('alt') === 'sse') {
                url.searchParams.delete('alt');
            }
        } else {
            body.stream = false;
            delete body.stream_options;
            delete body.tool_stream;
            if (api === 'anthropic-messages' && Array.isArray(body.tools)) {
                body.tools.forEach((tool: unknown) => {
                    if (isObject(tool)) {
                        delete tool.eager_input_streaming;
                    }
                });
            }
        }
        const headers = new Headers(request.headers);
        headers.set('accept', 'application/json');
        headers.delete('content-length');
        const response = await send(
            new Request(url, {
                ...init,
                method: request.method,
                headers,
                body: JSON.stringify(body),
                signal: request.signal,
                credentials: request.credentials,
                redirect: request.redirect,
            })
        );
        request.signal.throwIfAborted();
        // Keep provider HTTP errors intact for Pi's existing retry/error handling. Some gateways
        // ignore stream:false and still return SSE; their valid stream can be consumed as-is.
        if (!response.ok || response.headers.get('content-type')?.includes('text/event-stream')) {
            return response;
        }
        const data: unknown = await response.json();
        request.signal.throwIfAborted();
        const response_headers = new Headers(response.headers);
        response_headers.set('content-type', 'text/event-stream');
        response_headers.delete('content-length');
        response_headers.delete('content-encoding');
        return new Response(toEvents(api, data), {
            status: response.status,
            statusText: response.statusText,
            headers: response_headers,
        });
    };
}
