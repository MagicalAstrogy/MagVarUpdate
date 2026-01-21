import { MVU_FUNCTION_NAME, ToolCallBatches } from '@/function_call';
import { extractFromToolCall } from '@/invoke_extra_model';

const makeToolCalls = (argumentsValue: string, name = MVU_FUNCTION_NAME): ToolCallBatches => [
    [
        {
            index: 0,
            id: 'tool_0',
            type: 'function',
            function: {
                name,
                arguments: argumentsValue,
            },
        },
    ],
];

describe('extractFromToolCall', () => {
    test('returns null when tool_calls is missing or empty', () => {
        expect(extractFromToolCall(undefined)).toBeNull();
        expect(extractFromToolCall([] as ToolCallBatches)).toBeNull();
    });

    test('returns null when no matching tool name exists', () => {
        const args = JSON.stringify({
            delta: '[{"op":"add","path":"/x","value":1}]',
            analysis: 'ok',
        });
        const toolCalls = makeToolCalls(args, 'other_tool');
        expect(extractFromToolCall(toolCalls)).toBeNull();
    });

    test('returns null when arguments do not contain delta', () => {
        const toolCalls = makeToolCalls('not json');
        expect(extractFromToolCall(toolCalls)).toBeNull();
    });

    test('returns null when delta is too short', () => {
        const args = JSON.stringify({ delta: '1234', analysis: 'short' });
        const toolCalls = makeToolCalls(args);
        expect(extractFromToolCall(toolCalls)).toBeNull();
    });

    test('extracts from the last matching call in the first batch', () => {
        const firstArgs = JSON.stringify({
            delta: '[{"op":"replace","path":"/first","value":1}]',
            analysis: 'first',
        });
        const secondArgs = JSON.stringify({
            delta: '[{"op":"replace","path":"/second","value":2}]',
            analysis: 'second',
        });
        const toolCalls: ToolCallBatches = [
            [
                {
                    index: 0,
                    id: 'tool_0',
                    type: 'function',
                    function: { name: MVU_FUNCTION_NAME, arguments: firstArgs },
                },
                {
                    index: 1,
                    id: 'tool_1',
                    type: 'function',
                    function: { name: 'other_tool', arguments: firstArgs },
                },
                {
                    index: 2,
                    id: 'tool_2',
                    type: 'function',
                    function: { name: MVU_FUNCTION_NAME, arguments: secondArgs },
                },
            ],
        ];

        const expected = [
            '<UpdateVariable>',
            '<Analyze>',
            'second',
            '</Analyze>',
            '<JSONPatch>',
            '[',
            '  {',
            '    "op": "replace",',
            '    "path": "/second",',
            '    "value": 2',
            '  }',
            ']',
            '</JSONPatch>',
            '</UpdateVariable>',
        ].join('\n');

        expect(extractFromToolCall(toolCalls)).toBe(expected);
    });

    test('handles UpdateVariable-style delta payload', () => {
        const delta = [
            '<UpdateVariable>',
            '<Analysis>',
            '    希雅.与理的关系: Y',
            '</Analysis>',
            "_.set('希雅.与理的关系', '恋人');",
            '</UpdateVariable>',
        ].join('\n');
        const analysis = 'Time passed: 1 hour.';
        const args = JSON.stringify({ delta, analysis });
        const toolCalls = makeToolCalls(args);

        const expected = [
            '<UpdateVariable>',
            '<Analyze>',
            analysis,
            '</Analyze>',
            `${delta}`,
            '</UpdateVariable>',
        ].join('\n');

        expect(extractFromToolCall(toolCalls)).toBe(expected);
    });
});
