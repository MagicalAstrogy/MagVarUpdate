/**
 * 测试场景：验证保守输入 token 估算及预算拒绝，覆盖中文、图片字节和尺寸，以及绕过上下文转换时的总量限制。
 */
import { toPiContext } from '@/function/update/pi/context_adapter';
import { assertPiTokenBudget, estimatePiContextTokens } from '@/function/update/pi/token_preflight';
import type { Context } from '@earendil-works/pi-ai';

function context(text: string): Context {
    return {
        systemPrompt: 'system',
        messages: [{ role: 'user', content: text, timestamp: 1 }],
    };
}

// 输入预算：文本与图片按保守规则计数，扣除回复和安全余量后再决定能否发送。
describe('Pi token preflight', () => {
    test('counts preserved system text even though it is absent from the Pi message array', () => {
        const adapted = toPiContext([
            { role: 'user', content: 'short user' },
            { role: 'system', content: '界'.repeat(2000) },
        ]);
        expect(() => assertPiTokenBudget(adapted.context, 1024, 256)).not.toThrow();
        expect(() =>
            assertPiTokenBudget(adapted.context, 1024, 256, undefined, adapted.lateSystemMessages)
        ).toThrow(/estimated .* limit/);
    });
    // 估算规则：有效文本留有余量，UTF-8 内容及更大图片应产生更高预算。
    test('estimates text and accepts a request with headroom', () => {
        const input = context('A short prompt');
        expect(estimatePiContextTokens(input)).toBeGreaterThan(1);
        expect(assertPiTokenBudget(input, 8192, 1024)).toMatchObject({
            reservedTokens: 574,
            maxInputTokens: 6594,
        });
    });

    test('counts images conservatively', () => {
        const input: Context = {
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'describe' },
                        { type: 'image', data: 'AA==', mimeType: 'image/png' },
                    ],
                    timestamp: 1,
                },
            ],
        };
        expect(estimatePiContextTokens(input)).toBeGreaterThan(1024);
    });

    test('charges more for UTF-8-heavy text than equally long ASCII text', () => {
        const asciiEstimate = estimatePiContextTokens(context('a'.repeat(300)));
        const cjkEstimate = estimatePiContextTokens(context('界'.repeat(300)));
        const emojiEstimate = estimatePiContextTokens(context('🪐'.repeat(300)));

        expect(cjkEstimate).toBeGreaterThan(asciiEstimate * 3);
        expect(emojiEstimate).toBeGreaterThan(asciiEstimate * 3);
    });

    test('scales the image estimate with decoded payload size', () => {
        const withImage = (data: string): Context => ({
            messages: [
                {
                    role: 'user',
                    content: [{ type: 'image', data, mimeType: 'image/png' }],
                    timestamp: 1,
                },
            ],
        });
        const atobSpy = jest.spyOn(globalThis, 'atob');
        try {
            const smallEstimate = estimatePiContextTokens(withImage('AA=='));
            const largeEstimate = estimatePiContextTokens(withImage('A'.repeat(64 * 8192)));

            expect(largeEstimate).toBeGreaterThan(smallEstimate * 3);
            expect(atobSpy).not.toHaveBeenCalled();
        } finally {
            atobSpy.mockRestore();
        }
    });

    // 图片和超限边界：像素面积、累计载荷及无效元数据都参与发送前拒绝。
    test('uses image dimensions when a compact PNG represents many pixels', () => {
        const pngHeader = String.fromCharCode(
            0x89,
            0x50,
            0x4e,
            0x47,
            0x0d,
            0x0a,
            0x1a,
            0x0a,
            0,
            0,
            0,
            13,
            0x49,
            0x48,
            0x44,
            0x52,
            0,
            0,
            0x10,
            0,
            0,
            0,
            0x10,
            0
        );
        const atobSpy = jest.spyOn(globalThis, 'atob');
        try {
            const input = toPiContext([
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/png;base64,${btoa(pngHeader)}`,
                                detail: 'auto',
                            },
                        },
                    ],
                },
            ] as SillyTavern.SendingMessage[]).context;
            const decodeCallsAfterAdaptation = atobSpy.mock.calls.length;

            expect(estimatePiContextTokens(input)).toBeGreaterThan(30_000);
            expect(atobSpy).toHaveBeenCalledTimes(decodeCallsAfterAdaptation);
            expect(atobSpy.mock.calls.every(([value]) => value.length <= 1024)).toBe(true);
        } finally {
            atobSpy.mockRestore();
        }
    });

    test('rejects an aggregate image payload even when context conversion is bypassed', () => {
        const decodedBytesPerImage = 4 * 1024 * 1024 + 2;
        const encodedLength = (decodedBytesPerImage / 3) * 4;
        const data = 'A'.repeat(encodedLength);
        const input: Context = {
            messages: [
                {
                    role: 'user',
                    content: Array.from({ length: 4 }, () => ({
                        type: 'image' as const,
                        data,
                        mimeType: 'image/png',
                    })),
                    timestamp: 1,
                },
            ],
        };

        expect(() => assertPiTokenBudget(input, 1_000_000, 1024)).toThrow(
            /image total.*context.*limit/i
        );
    });

    test('rejects invalid metadata before request', () => {
        expect(() => assertPiTokenBudget(context('x'), 0, 1)).toThrow('contextWindow');
        expect(() => assertPiTokenBudget(context('x'), 100, 0)).toThrow('maxTokens');
        expect(() => assertPiTokenBudget(context('x'), 100, 101)).toThrow('must not exceed');
    });

    test('rejects an over-budget prompt with diagnostics', () => {
        expect(() => assertPiTokenBudget(context('界'.repeat(2000)), 1024, 256)).toThrow(
            /estimated .* limit/
        );
    });
});
