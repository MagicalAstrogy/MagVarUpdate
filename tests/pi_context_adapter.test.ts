import { PI_IMAGE_INPUT_LIMITS, toPiContext } from '@/function/update/pi/context_adapter';

const NOW = 1_725_000_000_000;
const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfG8AAAAASUVORK5CYII=';
const JPEG_SIGNATURE_BASE64 = '/9j/2Q==';
const GIF_SIGNATURE_BASE64 = 'R0lGODlh';
const WEBP_SIGNATURE_BASE64 = 'UklGRgAAAABXRUJQ';

type InputMessage = {
    role: 'user' | 'assistant' | 'system' | 'tool';
    name?: string;
    content?:
        | string
        | Array<
              | { type: 'text'; text: string }
              | {
                    type: 'image_url';
                    image_url: { url: string; detail: 'auto' | 'low' | 'high' };
                }
              | { type: 'video_url'; video_url: { url: string } }
          >;
    tool_call_id?: string;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
    }>;
};

function getText(content: unknown): string {
    if (typeof content === 'string') {
        return content;
    }
    if (!Array.isArray(content)) {
        return '';
    }
    return content
        .filter((block): block is { type: 'text'; text: string } => {
            return (
                typeof block === 'object' &&
                block !== null &&
                (block as { type?: unknown }).type === 'text'
            );
        })
        .map(block => block.text)
        .join('');
}

function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(child => deepFreeze(child));
    }
    return value;
}

function makeAlignedPngBase64(decodedBytes: number): string {
    if (decodedBytes < 9 || decodedBytes % 3 !== 0) {
        throw new Error('Test PNG byte length must be a multiple of three and at least nine');
    }
    const encodedLength = (decodedBytes / 3) * 4;
    // PNG's eight-byte signature plus one zero byte makes a complete base64
    // quantum, after which zero bytes can be represented by repeated A chars.
    return `iVBORw0KGgoA${'A'.repeat(encodedLength - 12)}`;
}

describe('toPiContext', () => {
    test('combines only the contiguous leading system messages in source order', () => {
        const input: InputMessage[] = [
            { role: 'system', content: 'first instruction' },
            { role: 'system', content: 'second instruction' },
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi' },
        ];

        const { context, diagnostics } = toPiContext(input, { now: () => NOW });

        expect(context.systemPrompt).toBe('first instruction\n\nsecond instruction');
        expect(context.messages.map(message => message.role)).toEqual(['user', 'assistant']);
        expect(diagnostics).toEqual({
            movedLateSystemCount: 0,
            lateSystemMoves: [],
            droppedEmptyMessageIndexes: [],
        });
    });

    test('attaches late system messages to the nearest user while preserving their relative position', () => {
        const input: InputMessage[] = [
            { role: 'system', content: 'leading' },
            { role: 'user', content: 'first user' },
            { role: 'assistant', content: 'first assistant' },
            { role: 'system', content: 'before second user' },
            { role: 'user', content: 'second user' },
            { role: 'system', content: 'after second user' },
        ];

        const { context, diagnostics } = toPiContext(input, { now: () => NOW });
        const secondUser = context.messages.find(
            message => message.role === 'user' && getText(message.content).includes('second user')
        );

        expect(secondUser).toBeDefined();
        const content = getText(secondUser?.content);
        expect(content).toContain('<system_injection source="sillytavern">');
        expect(content.indexOf('before second user')).toBeLessThan(content.indexOf('second user'));
        expect(content.indexOf('second user')).toBeLessThan(content.indexOf('after second user'));
        expect(diagnostics).toEqual({
            movedLateSystemCount: 2,
            lateSystemMoves: [
                { sourceIndex: 3, targetUserIndex: 4, placement: 'before' },
                { sourceIndex: 5, targetUserIndex: 4, placement: 'after' },
            ],
            droppedEmptyMessageIndexes: [],
        });
    });

    test('uses the preceding user for a late system after the final user', () => {
        const input: InputMessage[] = [
            { role: 'user', content: 'final user' },
            { role: 'system', content: 'tail instruction' },
        ];

        const { context, diagnostics } = toPiContext(input, { now: () => NOW });
        const content = getText(context.messages[0].content);

        expect(content.indexOf('final user')).toBeLessThan(content.indexOf('tail instruction'));
        expect(diagnostics.lateSystemMoves).toEqual([
            { sourceIndex: 1, targetUserIndex: 0, placement: 'after' },
        ]);
    });

    test('rejects a late system message under the strict late-system policy', () => {
        const input: InputMessage[] = [
            { role: 'user', content: 'hello' },
            { role: 'system', content: 'must not be moved' },
        ];

        expect(() =>
            toPiContext(input, {
                lateSystemPolicy: 'strict',
                now: () => NOW,
            })
        ).toThrow(/late.?system|system.*(?:index|位置)|(?:对话开始后|中途).*system/i);
    });

    test('strict late-system policy also rejects an empty late system', () => {
        const input: InputMessage[] = [
            { role: 'user', content: 'hello' },
            { role: 'system', content: '' },
        ];

        expect(() =>
            toPiContext(input, {
                lateSystemPolicy: 'strict',
                now: () => NOW,
            })
        ).toThrow(/late.?system|system.*(?:index|位置)|(?:对话开始后|中途).*system/i);
    });

    test('rejects a late system message when there is no user to attach it to', () => {
        const input: InputMessage[] = [
            { role: 'assistant', content: 'orphan assistant' },
            { role: 'system', content: 'orphan instruction' },
        ];

        expect(() => toPiContext(input, { now: () => NOW })).toThrow(
            /system.*(?:user|attach)|系统.*用户/i
        );
    });

    test('keeps message names as stable explicit prefixes for user and assistant text', () => {
        const input: InputMessage[] = [
            { role: 'user', name: 'Alice', content: 'hello' },
            { role: 'assistant', name: 'Narrator', content: 'welcome' },
        ];

        const { context } = toPiContext(input, { now: () => NOW });
        const userText = getText(context.messages[0].content);
        const assistantText = getText(context.messages[1].content);

        expect(userText).toMatch(/Alice[\s\S]*hello/);
        expect(assistantText).toMatch(/Narrator[\s\S]*welcome/);
        expect(userText.indexOf('Alice')).toBeLessThan(userText.indexOf('hello'));
        expect(assistantText.indexOf('Narrator')).toBeLessThan(assistantText.indexOf('welcome'));
    });

    test.each<InputMessage>([
        { role: 'user' },
        { role: 'assistant', content: '' },
        { role: 'user', content: [] },
        { role: 'assistant', content: [{ type: 'text', text: '' }] },
    ])('rejects an empty ordinary message in strict mode: %#', message => {
        expect(() =>
            toPiContext([message], {
                mode: 'strict',
                now: () => NOW,
            })
        ).toThrow(/empty|content|内容为空|空(?:消息|内容|回复)/i);
    });

    test('drops empty ordinary messages in lenient mode and reports their source indexes', () => {
        const input: InputMessage[] = [
            { role: 'user', content: '' },
            { role: 'user', content: 'kept' },
            { role: 'assistant', content: [] },
        ];

        const { context, diagnostics } = toPiContext(input, {
            mode: 'lenient',
            now: () => NOW,
        });

        expect(context.messages).toHaveLength(1);
        expect(getText(context.messages[0].content)).toBe('kept');
        expect(diagnostics.droppedEmptyMessageIndexes).toEqual([0, 2]);
    });

    test('reports dropped empty messages in stable source order across adapter passes', () => {
        const input: InputMessage[] = [
            { role: 'user', content: '' },
            { role: 'assistant', content: 'kept' },
            { role: 'system', content: '' },
        ];

        const { diagnostics } = toPiContext(input, {
            mode: 'lenient',
            now: () => NOW,
        });

        expect(diagnostics.droppedEmptyMessageIndexes).toEqual([0, 2]);
    });

    test('adds the complete pi placeholder metadata to imported assistant history', () => {
        const input: InputMessage[] = [
            { role: 'user', content: 'question' },
            { role: 'assistant', content: 'historical answer' },
        ];

        const { context } = toPiContext(input, { now: () => NOW });

        expect(context.messages[0]).toEqual({
            role: 'user',
            content: 'question',
            timestamp: NOW,
        });
        expect(context.messages[1]).toEqual({
            role: 'assistant',
            content: [{ type: 'text', text: 'historical answer' }],
            api: 'sillytavern-import',
            provider: 'sillytavern',
            model: 'prepared-prompt',
            usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    total: 0,
                },
            },
            stopReason: 'stop',
            timestamp: NOW,
        });
    });

    test('converts user data URL images into pi image blocks without changing block order', () => {
        const input: InputMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'before' },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/png;base64,${PNG_BASE64}`,
                            detail: 'high',
                        },
                    },
                    { type: 'text', text: 'after' },
                ],
            },
        ];

        const { context } = toPiContext(input, { now: () => NOW });

        expect(context.messages[0]).toEqual({
            role: 'user',
            content: [
                { type: 'text', text: 'before' },
                { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
                { type: 'text', text: 'after' },
            ],
            timestamp: NOW,
        });
    });

    test('preserves multiple data URL images in one user message', () => {
        const input: InputMessage[] = [
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/png;base64,${PNG_BASE64}`,
                            detail: 'auto',
                        },
                    },
                    { type: 'text', text: 'compare' },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/jpeg;base64,${JPEG_SIGNATURE_BASE64}`,
                            detail: 'high',
                        },
                    },
                ],
            },
        ];

        expect(toPiContext(input, { now: () => NOW }).context.messages[0]).toEqual({
            role: 'user',
            content: [
                { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
                { type: 'text', text: 'compare' },
                { type: 'image', mimeType: 'image/jpeg', data: JPEG_SIGNATURE_BASE64 },
            ],
            timestamp: NOW,
        });
    });

    test.each([
        ['image/png', PNG_BASE64],
        ['image/jpeg', JPEG_SIGNATURE_BASE64],
        ['image/gif', GIF_SIGNATURE_BASE64],
        ['image/webp', WEBP_SIGNATURE_BASE64],
    ])('accepts a recognizable %s data URL', (mimeType, data) => {
        const input: InputMessage[] = [
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: { url: `data:${mimeType};base64,${data}`, detail: 'auto' },
                    },
                ],
            },
        ];

        expect(toPiContext(input, { now: () => NOW }).context.messages[0]).toMatchObject({
            content: [{ type: 'image', mimeType, data }],
        });
    });

    test('treats the data URL scheme and MIME type case-insensitively', () => {
        const input: InputMessage[] = [
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: {
                            url: `DATA:IMAGE/PNG;BASE64,${PNG_BASE64}`,
                            detail: 'auto',
                        },
                    },
                ],
            },
        ];

        expect(toPiContext(input, { now: () => NOW }).context.messages[0]).toMatchObject({
            content: [{ type: 'image', mimeType: 'image/png', data: PNG_BASE64 }],
        });
    });

    test('rejects remote images instead of silently fetching or dropping them', () => {
        const input: InputMessage[] = [
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: {
                            url: 'https://example.com/private.png',
                            detail: 'auto',
                        },
                    },
                ],
            },
        ];

        expect(() => toPiContext(input, { now: () => NOW })).toThrow(
            /remote|data.?url|https|远程.*图片/i
        );
    });

    test('rejects an oversized data URL before decoding any base64', () => {
        const maximumEncodedLength =
            Math.ceil(PI_IMAGE_INPUT_LIMITS.maxDecodedBytesPerImage / 3) * 4;
        const oversizedData = `iVBORw0KGgoA${'A'.repeat(maximumEncodedLength - 8)}`;
        const input: InputMessage[] = [
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/png;base64,${oversizedData}`,
                            detail: 'auto',
                        },
                    },
                ],
            },
        ];
        const atobSpy = jest.spyOn(globalThis, 'atob');

        try {
            expect(() => toPiContext(input, { now: () => NOW })).toThrow(
                /image|picture|large|limit|图片|上限/i
            );
            expect(atobSpy).not.toHaveBeenCalled();
        } finally {
            atobSpy.mockRestore();
        }
    });

    test('enforces the aggregate image-byte budget while decoding only bounded headers', () => {
        const decodedBytesPerImage = 4 * 1024 * 1024 + 2;
        const data = makeAlignedPngBase64(decodedBytesPerImage);
        const url = `data:image/png;base64,${data}`;
        const input: InputMessage[] = [
            {
                role: 'user',
                content: Array.from({ length: 4 }, () => ({
                    type: 'image_url' as const,
                    image_url: { url, detail: 'auto' as const },
                })),
            },
        ];
        const atobSpy = jest.spyOn(globalThis, 'atob');

        try {
            expect(() => toPiContext(input, { now: () => NOW })).toThrow(
                /image|total|limit|图片|总量|上限/i
            );
            expect(atobSpy).toHaveBeenCalledTimes(3);
            expect(atobSpy.mock.calls.every(([value]) => value.length <= 1024)).toBe(true);
        } finally {
            atobSpy.mockRestore();
        }
    });

    test('limits the number of otherwise-small images in one context', () => {
        const input: InputMessage[] = [
            {
                role: 'user',
                content: Array.from(
                    { length: PI_IMAGE_INPUT_LIMITS.maxImagesPerContext + 1 },
                    () => ({
                        type: 'image_url' as const,
                        image_url: {
                            url: `data:image/png;base64,${PNG_BASE64}`,
                            detail: 'auto' as const,
                        },
                    })
                ),
            },
        ];

        expect(() => toPiContext(input, { now: () => NOW })).toThrow(/20|image|图片|最多/i);
    });

    test.each([
        'data:image/png;base64,not%base64',
        'data:text/plain;base64,aGVsbG8=',
        'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
        'data:image/bmp;base64,Qk0AAAAA',
        'data:image/png;base64,aGVsbG8=',
        `data:image/jpeg;base64,${PNG_BASE64}`,
    ])('rejects an invalid or unsupported image data URL: %s', url => {
        const input: InputMessage[] = [
            {
                role: 'user',
                content: [{ type: 'image_url', image_url: { url, detail: 'auto' } }],
            },
        ];

        expect(() => toPiContext(input, { now: () => NOW })).toThrow(
            /image|mime|base64|data.?url|图片/i
        );
    });

    test('rejects video blocks instead of silently dropping them', () => {
        const input: InputMessage[] = [
            {
                role: 'user',
                content: [
                    {
                        type: 'video_url',
                        video_url: { url: 'data:video/mp4;base64,AAAA' },
                    },
                ],
            },
        ];

        expect(() => toPiContext(input, { now: () => NOW })).toThrow(/video|视频/i);
    });

    test('converts historical tool calls and correlates their following tool results', () => {
        const input: InputMessage[] = [
            { role: 'user', content: 'look it up' },
            {
                role: 'assistant',
                content: 'calling lookup',
                tool_calls: [
                    {
                        id: 'call_1',
                        type: 'function',
                        function: {
                            name: 'lookup',
                            arguments: JSON.stringify({ query: 'weather' }),
                        },
                    },
                ],
            },
            {
                role: 'tool',
                tool_call_id: 'call_1',
                content: 'sunny',
            },
        ];

        const { context } = toPiContext(input, { now: () => NOW });

        expect(context.messages[1]).toEqual(
            expect.objectContaining({
                role: 'assistant',
                content: [
                    { type: 'text', text: 'calling lookup' },
                    {
                        type: 'toolCall',
                        id: 'call_1',
                        name: 'lookup',
                        arguments: { query: 'weather' },
                    },
                ],
                stopReason: 'toolUse',
                timestamp: NOW,
            })
        );
        expect(context.messages[2]).toEqual({
            role: 'toolResult',
            toolCallId: 'call_1',
            toolName: 'lookup',
            content: [{ type: 'text', text: 'sunny' }],
            isError: false,
            timestamp: NOW,
        });
    });

    test.each([
        {
            name: 'malformed tool arguments',
            input: [
                {
                    role: 'assistant',
                    tool_calls: [
                        {
                            id: 'call_bad',
                            type: 'function',
                            function: { name: 'lookup', arguments: '{bad json' },
                        },
                    ],
                },
            ] satisfies InputMessage[],
            error: /tool.*arguments|json|工具.*参数/i,
        },
        {
            name: 'orphan tool result',
            input: [
                { role: 'tool', tool_call_id: 'missing', content: 'result' },
            ] satisfies InputMessage[],
            error: /tool.*(?:call|unknown|missing)|工具.*(?:调用|匹配)/i,
        },
    ])('rejects $name', ({ input, error }) => {
        expect(() => toPiContext(input, { now: () => NOW })).toThrow(error);
    });

    test('does not mutate captured messages or their nested content and tool call objects', () => {
        const input = deepFreeze<InputMessage[]>([
            { role: 'system', content: 'system' },
            {
                role: 'user',
                name: 'Alice',
                content: [
                    { type: 'text', text: 'inspect' },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/png;base64,${PNG_BASE64}`,
                            detail: 'auto',
                        },
                    },
                ],
            },
            {
                role: 'assistant',
                tool_calls: [
                    {
                        id: 'call_immutable',
                        type: 'function',
                        function: { name: 'inspect', arguments: '{"deep":true}' },
                    },
                ],
            },
            {
                role: 'tool',
                tool_call_id: 'call_immutable',
                content: 'done',
            },
        ]);
        const snapshot = JSON.parse(JSON.stringify(input));

        expect(() => toPiContext(input, { now: () => NOW })).not.toThrow();
        expect(input).toEqual(snapshot);
    });
});
