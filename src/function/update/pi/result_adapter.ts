import type { AssistantMessage, Tool, ToolCall } from '@earendil-works/pi-ai';

export type PiResultAdapterErrorCode =
    | 'aborted'
    | 'deferred'
    | 'empty-response'
    | 'invalid-tool-call'
    | 'length'
    | 'network'
    | 'provider-error';

export class PiResultAdapterError extends Error {
    constructor(
        message: string,
        readonly code: PiResultAdapterErrorCode
    ) {
        super(message);
        this.name = 'PiResultAdapterError';
    }
}

export type PiToolDefinitionOptions = {
    constrainedSampling?: Tool['constrainedSampling'];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function cloneSchema(schema: Record<string, unknown>): Record<string, unknown> {
    try {
        return structuredClone(schema);
    } catch (cause) {
        throw new PiResultAdapterError(
            `工具参数 schema 无法复制：${cause instanceof Error ? cause.message : String(cause)}`,
            'invalid-tool-call'
        );
    }
}

export function toPiToolDefinition(
    definition: ToolDefinition,
    options: PiToolDefinitionOptions = {}
): Tool {
    if (definition?.type !== 'function' || !definition.function?.name?.trim()) {
        throw new PiResultAdapterError('工具定义缺少有效的 function name', 'invalid-tool-call');
    }

    const parameters = definition.function.parameters ?? {
        type: 'object',
        properties: {},
    };
    if (!isPlainObject(parameters) || parameters.type !== 'object') {
        throw new PiResultAdapterError(
            '工具参数 schema 的根节点必须是 object',
            'invalid-tool-call'
        );
    }

    return {
        name: definition.function.name,
        description: definition.function.description ?? '',
        parameters: cloneSchema(parameters) as Tool['parameters'],
        ...(options.constrainedSampling === undefined
            ? {}
            : { constrainedSampling: options.constrainedSampling }),
    };
}

export const toPiTool = toPiToolDefinition;

function normalizeToolCall(call: ToolCall): GenerateToolCallResult['tool_calls'][number] {
    if (!call.id?.trim() || !call.name?.trim() || !isPlainObject(call.arguments)) {
        throw new PiResultAdapterError('更多来源返回了无效的工具调用', 'invalid-tool-call');
    }

    let argumentsValue: string;
    try {
        argumentsValue = JSON.stringify(call.arguments);
    } catch (cause) {
        throw new PiResultAdapterError(
            `更多来源工具参数无法序列化：${cause instanceof Error ? cause.message : String(cause)}`,
            'invalid-tool-call'
        );
    }

    return {
        id: call.id,
        type: 'function',
        function: {
            name: call.name,
            arguments: argumentsValue,
        },
        ...(call.thoughtSignature ? { thought_signature: call.thoughtSignature } : {}),
    };
}

function assertSuccessfulStopReason(message: AssistantMessage): void {
    switch (message.stopReason) {
        case 'stop':
        case 'toolUse':
            return;
        case 'length':
            throw new PiResultAdapterError('更多来源回复因达到长度上限而被截断', 'length');
        case 'aborted':
            throw new PiResultAdapterError('更多来源请求已取消', 'aborted');
        case 'error': {
            // Provider errorMessage values are untrusted response data. They have been observed to
            // contain echoed Authorization headers/API keys, so retain only a coarse classification.
            const isNetworkError =
                typeof message.errorMessage === 'string' &&
                /failed to fetch|fetch failed|network\s*error|networkerror|load failed|cors/i.test(
                    message.errorMessage
                );
            throw new PiResultAdapterError(
                isNetworkError
                    ? 'The browser could not complete the More source request.'
                    : 'More source request failed.',
                isNetworkError ? 'network' : 'provider-error'
            );
        }
        case 'pending':
        case 'deferred':
            throw new PiResultAdapterError(
                '更多来源回复尚未完成，当前不支持 deferred 结果',
                'deferred'
            );
        default: {
            const exhaustive: never = message.stopReason;
            void exhaustive;
            throw new PiResultAdapterError(
                'More source provider returned an unknown stop reason.',
                'provider-error'
            );
        }
    }
}

export function fromPiAssistantMessage(message: AssistantMessage): string | GenerateToolCallResult {
    assertSuccessfulStopReason(message);

    const text = message.content
        .filter(content => content.type === 'text')
        .map(content => content.text)
        .join('');
    const toolCalls = message.content
        .filter((content): content is ToolCall => content.type === 'toolCall')
        .map(normalizeToolCall);

    if (message.stopReason === 'toolUse' && toolCalls.length === 0) {
        throw new PiResultAdapterError(
            '更多来源以 toolUse 结束，但没有返回工具调用',
            'invalid-tool-call'
        );
    }
    if (toolCalls.length > 0) {
        return {
            content: text,
            tool_calls: toolCalls,
        };
    }
    if (text.length === 0) {
        const hasThinking = message.content.some(content => content.type === 'thinking');
        throw new PiResultAdapterError(
            hasThinking ? '更多来源回复仅包含 thinking，没有业务内容' : '更多来源返回了空回复',
            'empty-response'
        );
    }
    return text;
}
