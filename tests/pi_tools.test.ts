import type { AssistantMessage, StopReason } from '@earendil-works/pi-ai';

import {
    fromPiAssistantMessage,
    PiResultAdapterError,
    toPiTool,
    toPiToolDefinition,
} from '@/function/update/pi/result_adapter';

function makeAssistantMessage(
    content: AssistantMessage['content'],
    stopReason: StopReason = 'stop',
    errorMessage?: string
): AssistantMessage {
    return {
        role: 'assistant',
        content,
        api: 'openai-responses',
        provider: 'openai',
        model: 'test-model',
        usage: {
            input: 10,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 15,
            cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
            },
        },
        stopReason,
        errorMessage,
        timestamp: 1,
    };
}

describe('toPiToolDefinition', () => {
    test('removes the OpenAI wrapper and preserves the JSON schema without mutating input', () => {
        const slashTool: ToolDefinition = {
            type: 'function',
            function: {
                name: 'update_variables',
                description: 'Update variables using JSON Patch.',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        analysis: { type: 'string' },
                        delta: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    op: { type: 'string' },
                                    path: { type: 'string' },
                                },
                            },
                        },
                    },
                    required: ['delta'],
                },
            },
        };
        const original = structuredClone(slashTool);

        const result = toPiToolDefinition(slashTool);

        expect(result).toMatchObject({
            name: 'update_variables',
            description: 'Update variables using JSON Patch.',
            parameters: slashTool.function.parameters,
        });
        expect(result).not.toHaveProperty('type');
        expect(result).not.toHaveProperty('function');
        expect(slashTool).toEqual(original);
    });

    test('uses an empty object schema when parameters are omitted', () => {
        const slashTool: ToolDefinition = {
            type: 'function',
            function: {
                name: 'ping',
            },
        };

        const result = toPiToolDefinition(slashTool);

        expect(result.name).toBe('ping');
        expect(result.description).toBe('');
        expect(result.parameters).toMatchObject({
            type: 'object',
            properties: {},
        });
        expect(slashTool).toEqual({
            type: 'function',
            function: { name: 'ping' },
        });
    });

    test('rejects a non-object root schema', () => {
        const slashTool: ToolDefinition = {
            type: 'function',
            function: {
                name: 'invalid',
                parameters: {
                    type: 'array',
                    items: { type: 'string' },
                },
            },
        };

        expect(() => toPiToolDefinition(slashTool)).toThrow(/object|对象/i);
    });

    test('supports explicit constrained sampling through the toPiTool alias', () => {
        const slashTool: ToolDefinition = {
            type: 'function',
            function: {
                name: 'structured_update',
                parameters: { type: 'object', properties: {} },
            },
        };

        expect(
            toPiTool(slashTool, {
                constrainedSampling: { type: 'json_schema', strict: 'prefer' },
            })
        ).toEqual({
            name: 'structured_update',
            description: '',
            parameters: { type: 'object', properties: {} },
            constrainedSampling: { type: 'json_schema', strict: 'prefer' },
        });
    });
});

describe('fromPiAssistantMessage', () => {
    test('joins text blocks in order and excludes thinking blocks', () => {
        const message = makeAssistantMessage([
            { type: 'text', text: 'first' },
            { type: 'thinking', thinking: 'private reasoning' },
            { type: 'text', text: '\nsecond' },
        ]);

        expect(fromPiAssistantMessage(message)).toBe('first\nsecond');
    });

    test('normalizes text and all tool calls to the Slash result shape', () => {
        const message = makeAssistantMessage(
            [
                { type: 'text', text: 'before ' },
                {
                    type: 'toolCall',
                    id: 'call_1',
                    name: 'update_variables',
                    arguments: {
                        delta: [{ op: 'replace', path: '/score', value: 2 }],
                    },
                    thoughtSignature: 'signed-reasoning',
                },
                { type: 'thinking', thinking: 'do not expose' },
                {
                    type: 'toolCall',
                    id: 'call_2',
                    name: 'audit',
                    arguments: { accepted: true },
                },
                { type: 'text', text: 'after' },
            ],
            'toolUse'
        );
        const original = structuredClone(message);

        const result = fromPiAssistantMessage(message);

        expect(result).toEqual({
            content: 'before after',
            tool_calls: [
                {
                    id: 'call_1',
                    type: 'function',
                    function: {
                        name: 'update_variables',
                        arguments: JSON.stringify({
                            delta: [{ op: 'replace', path: '/score', value: 2 }],
                        }),
                    },
                    thought_signature: 'signed-reasoning',
                },
                {
                    id: 'call_2',
                    type: 'function',
                    function: {
                        name: 'audit',
                        arguments: JSON.stringify({ accepted: true }),
                    },
                },
            ],
        });
        expect(message).toEqual(original);
    });

    test('normalizes a tool-only response with empty text content', () => {
        const message = makeAssistantMessage(
            [
                {
                    type: 'toolCall',
                    id: 'call_only',
                    name: 'update_variables',
                    arguments: {},
                },
            ],
            'toolUse'
        );

        expect(fromPiAssistantMessage(message)).toEqual({
            content: '',
            tool_calls: [
                {
                    id: 'call_only',
                    type: 'function',
                    function: {
                        name: 'update_variables',
                        arguments: '{}',
                    },
                },
            ],
        });
    });

    test('rejects a length-truncated response even when it contains text', () => {
        const message = makeAssistantMessage(
            [{ type: 'text', text: 'incomplete response' }],
            'length'
        );

        expect(() => fromPiAssistantMessage(message)).toThrow(
            /length|truncat|token.{0,12}limit|截断|长度|过长|令牌上限/i
        );
    });

    test.each([
        {
            errorMessage: 'upstream rejected Authorization: Bearer sk-live-secret-token',
            expectedCode: 'provider-error',
        },
        {
            errorMessage: 'TypeError: Failed to fetch api_key=sk-live-secret-token',
            expectedCode: 'network',
        },
    ] as const)(
        'classifies provider failures without retaining their error text: $expectedCode',
        ({ errorMessage, expectedCode }) => {
            let error: unknown;
            try {
                fromPiAssistantMessage(makeAssistantMessage([], 'error', errorMessage));
            } catch (cause) {
                error = cause;
            }

            expect(error).toBeInstanceOf(PiResultAdapterError);
            expect(error).toMatchObject({ code: expectedCode });
            expect(String(error)).not.toContain('sk-live-secret-token');
            expect(error).not.toHaveProperty('cause');
        }
    );

    test.each<{ content: AssistantMessage['content'] }>([
        { content: [] },
        { content: [{ type: 'text', text: '' }] },
    ])('rejects an empty response: %#', ({ content }) => {
        const message = makeAssistantMessage(content);

        expect(() => fromPiAssistantMessage(message)).toThrow(
            /empty|no (usable )?content|空回复|无内容/i
        );
    });

    test('reports a thinking-only response distinctly from a generic empty response', () => {
        const message = makeAssistantMessage([
            { type: 'thinking', thinking: 'private reasoning without an answer' },
        ]);

        expect(() => fromPiAssistantMessage(message)).toThrow(/thinking|reasoning|思考|推理/i);
    });
});
