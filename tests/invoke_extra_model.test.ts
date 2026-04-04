import { extractFromToolCall, MVU_FUNCTION_NAME } from '@/function/function_call';

type ToolCallBatches = Array<
    Array<{
        index: number;
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
    }>
>;

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

    test('returns null when the first batch is empty', () => {
        const toolCalls = [[]] as unknown as ToolCallBatches;
        expect(extractFromToolCall(toolCalls)).toBeNull();
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

    test('returns null when arguments are empty', () => {
        const toolCalls = makeToolCalls('');
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

    test('preserves literal wrapper tags inside json patch values', () => {
        const patch = [
            {
                op: 'replace',
                path: '/template',
                value: '<UpdateVariable><Analysis>literal</Analysis></UpdateVariable>',
            },
        ];
        const delta = [
            '<UpdateVariable>',
            '<Analysis>',
            '    模板内容需要原样保留',
            '</Analysis>',
            '<JSONPatch>',
            JSON.stringify(patch, null, 2),
            '</JSONPatch>',
            '</UpdateVariable>',
        ].join('\n');
        const analysis = 'Preserve literal tags.';
        const args = JSON.stringify({ delta, analysis });
        const toolCalls = makeToolCalls(args);

        const expected = [
            '<UpdateVariable>',
            '<Analyze>',
            analysis,
            '</Analyze>',
            '<JSONPatch>',
            JSON.stringify(patch, null, 2),
            '</JSONPatch>',
            '</UpdateVariable>',
        ].join('\n');

        expect(extractFromToolCall(toolCalls)).toBe(expected);
    });

    test('returns null when json patch tag exists but is invalid', () => {
        const delta = '<JSONPatch>{"foo":1}</JSONPatch>';
        const args = JSON.stringify({ delta, analysis: 'bad patch' });
        const toolCalls = makeToolCalls(args);
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        expect(extractFromToolCall(toolCalls)).toBeNull();
        expect(errorSpy).toHaveBeenCalled();

        errorSpy.mockRestore();
    });

    test('returns null when delta is not a json patch and not legacy', () => {
        const delta = '{"foo":1}';
        const args = JSON.stringify({ delta, analysis: 'not a patch' });
        const toolCalls = makeToolCalls(args);

        expect(extractFromToolCall(toolCalls)).toBeNull();
    });

    test('alt', () => {
        const content = {
            id: 'it3NaZ64I5XhtfAP7aTP6Ag',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        tool_calls: [
                            {
                                id: 'tc_b6b29356-fd5d-477e-9a34-186b373484fb',
                                type: 'function',
                                function: {
                                    name: 'mvu_VariableUpdate_test-script-id',
                                    arguments:
                                        '{"analysis":"(1) Approx 1 hour passed; (2) No; (3) 世界/当前时间段, 触手君/饱食度, 触手君/湿润度, 触手君/信赖度, 触手君/占有欲, 触手君/成长经验值, 触手君/当前情绪, 触手君/已掌握的技能, 触手君/身体部位好感度/手, player/当前情绪, player/体力, player/受影响程度, player/本次互动高光部位; (4) 世界/当前时间段: Y, 触手君/饱食度: Y, 触手君/湿润度: Y, 触手君/信赖度: Y, 触手君/占有欲: Y, 触手君/成长经验值: Y, 触手君/当前情绪: Y, 触手君/已掌握的技能: Y, 触手君/身体部位好感度/手: Y, player/当前情绪: Y, player/体力: Y, player/受影响程度: Y, player/本次互动高光部位: Y; (5) Evaluated based on \\u003cpast_observe\\u003e.","delta":"\\u003cUpdateVariable\\u003e\\n\\u003cAnalysis\\u003e\\n(1) 时间流逝约1小时；(2) 否；(3) 世界/当前时间段, 触手君/饱食度, 触手君/湿润度, 触手君/信赖度, 触手君/占有欲, 触手君/成长经验值, 触手君/当前情绪, 触手君/已掌握的技能, 触手君/身体部位好感度/手, player/当前情绪, player/体力, player/受影响程度, player/本次互动高光部位；(4) Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y。\\n\\u003c/Analysis\\u003e\\n\\u003cJSONPatch\\u003e\\n[\\n  { \\"op\\": \\"replace\\", \\"path\\": \\"/世界/当前时间段\\", \\"value\\": \\"傍晚\\" },\\n  { \\"op\\": \\"delta\\", \\"path\\": \\"/触手君/饱食度\\", \\"value\\": -5 },\\n  { \\"op\\": \\"delta\\", \\"path\\": \\"/触手君/湿润度\\", \\"value\\": -5 },\\n  { \\"op\\": \\"delta\\", \\"path\\": \\"/触手君/信赖度\\", \\"value\\": 5 },\\n  { \\"op\\": \\"delta\\", \\"path\\": \\"/触手君/占有欲\\", \\"value\\": 3 },\\n  { \\"op\\": \\"delta\\", \\"path\\": \\"/触手君/成长经验值\\", \\"value\\": 10 },\\n  { \\"op\\": \\"replace\\", \\"path\\": \\"/触手君/当前情绪\\", \\"value\\": \\"期待/温情\\" },\\n  { \\"op\\": \\"insert\\", \\"path\\": \\"/触手君/已掌握的技能/物品递送（进阶）\\", \\"value\\": { \\"detail\\": \\"学会区分干净与脏污，能按指令或需求准确递送物品。\\" } },\\n  { \\"op\\": \\"delta\\", \\"path\\": \\"/触手君/身体部位好感度/手\\", \\"value\\": 3 },\\n  { \\"op\\": \\"replace\\", \\"path\\": \\"/player/当前情绪\\", \\"value\\": \\"虚弱/舒缓\\" },\\n  { \\"op\\": \\"delta\\", \\"path\\": \\"/player/体力\\", \\"value\\": -5 },\\n  { \\"op\\": \\"delta\\", \\"path\\": \\"/player/受影响程度\\", \\"value\\": 2 },\\n  { \\"op\\": \\"replace\\", \\"path\\": \\"/player/本次互动高光部位\\", \\"value\\": \\"手腕\\" }\\n]\\n\\u003c/JSONPatch\\u003e\\n\\u003c/UpdateVariable\\u003e"}',
                                },
                                index: 0,
                            },
                        ],
                    },
                    finish_reason: 'tool_calls',
                },
            ],
            object: 'chat.completion',
            created: 1775099295,
            model: 'gemini-3-flash-preview',
            usage: {
                prompt_tokens: 6559,
                completion_tokens: 3527,
                total_tokens: 10086,
                prompt_tokens_details: null,
                completion_tokens_details: {
                    audio_tokens: 0,
                    reasoning_tokens: 2642,
                    accepted_prediction_tokens: 0,
                    rejected_prediction_tokens: 0,
                },
            },
        };
        let input = [];
        input[0] = content;
        const toolCalls = input[0].choices[0].message.tool_calls;

        const outer = [];
        outer[0] = toolCalls;
        expect(extractFromToolCall(outer as any)).not.toBeNull();
    });

    test('returns null when argument parsing throws', () => {
        jest.isolateModules(() => {
            jest.doMock('@util/common', () => {
                const actual = jest.requireActual('@util/common');
                return {
                    ...actual,
                    parseString: jest.fn(() => {
                        throw new Error('boom');
                    }),
                };
            });
            const { extractFromToolCall, MVU_FUNCTION_NAME } = require('@/function/function_call');
            const args = JSON.stringify({
                delta: '[{"op":"add","path":"/x","value":1}]',
                analysis: 'ok',
            });
            const toolCalls = [
                [
                    {
                        index: 0,
                        id: 'tool_0',
                        type: 'function',
                        function: { name: MVU_FUNCTION_NAME, arguments: args },
                    },
                ],
            ];

            expect(extractFromToolCall(toolCalls)).toBeNull();
        });
    });
});
