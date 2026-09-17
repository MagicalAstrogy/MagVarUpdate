/**
 * 测试场景：验证 MVU 的自动、禁用、强制及具名工具选择映射到各 Pi 协议，并拒绝协议不支持的组合。
 */
import { resolvePiToolChoice } from '@/function/update/pi/tool_choice';

// 工具选择映射：各协议使用正确枚举和对象形状，不支持的具名或强制选择明确报错。
describe('Pi capability-aware tool choice', () => {
    test.each([
        ['openai-responses', 'auto', 'auto'],
        ['anthropic-messages', 'none', 'none'],
        ['google-generative-ai', 'required', 'any'],
        ['anthropic-messages', 'required', 'any'],
        ['openai-completions', 'any', 'required'],
        ['openai-codex-responses', 'required', 'required'],
        ['mistral-conversations', 'any', 'any'],
        ['mistral-conversations', 'required', 'required'],
    ] as const)('maps %s %s', (api, choice, expected) => {
        expect(resolvePiToolChoice(api, choice)).toBe(expected);
    });

    test('uses API-specific named tool shapes', () => {
        const choice = { type: 'function' as const, function: { name: 'update_variables' } };
        expect(resolvePiToolChoice('openai-completions', choice)).toEqual({
            type: 'function',
            function: { name: 'update_variables' },
        });
        expect(resolvePiToolChoice('openai-responses', choice)).toEqual({
            type: 'function',
            name: 'update_variables',
        });
        expect(resolvePiToolChoice('anthropic-messages', choice)).toEqual({
            type: 'tool',
            name: 'update_variables',
        });
        expect(resolvePiToolChoice('mistral-conversations', choice)).toEqual({
            type: 'function',
            function: { name: 'update_variables' },
        });
    });

    test('rejects unsupported named or required choices', () => {
        const named = { type: 'function' as const, function: { name: 'x' } };
        expect(() => resolvePiToolChoice('google-generative-ai', named)).toThrow(
            'does not support a named tool choice'
        );
        expect(() => resolvePiToolChoice('future-api', 'required')).toThrow(
            'does not support required tool choice'
        );
    });
});
