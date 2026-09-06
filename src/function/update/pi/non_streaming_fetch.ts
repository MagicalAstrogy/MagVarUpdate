import type { FetchFunction } from './pi_gateway';
import type { PiWireApi } from './provider_target';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(): never {
    // Do not include provider bodies: they can echo prompts, headers, or credentials.
    throw new Error('More source received an invalid non-streaming response');
}

function event(data: JsonObject): string {
    return `${typeof data.type === 'string' ? `event: ${data.type}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
}

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
 * Pi 0.84's complete() still sends streaming HTTP requests. Keep its audited request builders,
 * authentication and result parsers, but request a real JSON response on the wire. Only after
 * receiving that entire response do we expose equivalent events to Pi's stream-only parsers.
 * This wrapper is instance-local and composes outside the optional SillyTavern proxy transport.
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
