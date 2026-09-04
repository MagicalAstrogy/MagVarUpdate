import { resolvePiToolChoice } from '@/function/update/pi/tool_choice';

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
