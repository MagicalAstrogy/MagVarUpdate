/** 验证中途 system 的原生角色、位置、请求隔离，以及无法无损恢复时的发送前拒绝。 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { toPiContext } from '@/function/update/pi/context_adapter';
import { createPiSystemMessageBridge } from '@/function/update/pi/system_messages';

const input = [
    { role: 'user' as const, content: 'same text' },
    { role: 'system' as const, content: 'middle instruction' },
    { role: 'user' as const, content: 'same text' },
    { role: 'system' as const, content: 'tail instruction' },
];

test('restores repeated messages by position and keeps the captured and Pi inputs unchanged', () => {
    const adapted = toPiContext(input);
    const original = structuredClone(adapted);
    const bridge = createPiSystemMessageBridge(adapted, 'openai-responses');
    const payload = {
        input: bridge.context.messages.map(message => ({
            role: message.role,
            content: message.content,
        })),
    };
    const before = structuredClone(payload);
    const result = bridge.restore(payload);
    expect(result).toEqual({ input });
    expect(bridge.restore(result)).toBe(result);
    expect(bridge.restore(payload)).toEqual(result);
    expect(payload).toEqual(before);
    expect(adapted).toEqual(original);
    expect(() => bridge.assertRestored()).not.toThrow();
});

test('keeps anchors isolated across concurrent requests and preserves text resembling another request anchor', () => {
    const first = createPiSystemMessageBridge(toPiContext(input), 'openai-completions');
    const carriedText = first.context.messages[1].content;
    const secondInput = [
        { role: 'user' as const, content: 'second request' },
        { role: 'system' as const, content: 'second instruction' },
        { role: 'user' as const, content: carriedText as string },
    ];
    const second = createPiSystemMessageBridge(toPiContext(secondInput), 'openai-completions');
    const payload = {
        messages: second.context.messages.map(message => ({
            role: message.role,
            content: message.content,
        })),
    };
    expect(second.restore(payload)).toEqual({ messages: secondInput });
    expect(
        first.restore({
            messages: first.context.messages.map(message => ({
                role: message.role,
                content: message.content,
            })),
        })
    ).toEqual({ messages: input });
});

test.each(['missing', 'duplicate', 'reordered'] as const)(
    'rejects %s anchors without leaking the payload in errors',
    kind => {
        const adapted = toPiContext([...input, { role: 'assistant', content: 'private-response' }]);
        const bridge = createPiSystemMessageBridge(adapted, 'openai-responses');
        const items = bridge.context.messages.map(message => ({
            role: message.role,
            content: message.content,
        }));
        const broken =
            kind === 'missing'
                ? []
                : kind === 'duplicate'
                  ? [...items, items[1]]
                  : [...items].reverse();
        expect(() => bridge.restore({ input: broken })).toThrow(/could not restore/);
        expect(bridge.failure).toMatchObject({ code: 'system-payload-mismatch' });
        expect(bridge.failure?.message).not.toContain('private-response');
    }
);

test('does not treat a skipped hook as successful preservation', () => {
    const bridge = createPiSystemMessageBridge(toPiContext(input), 'openai-responses');
    expect(() => bridge.assertRestored()).toThrow(/could not restore/);
});

test('keeps leading Google systems and converts only intermediate systems to user content', () => {
    expect(() =>
        createPiSystemMessageBridge(
            toPiContext([
                { role: 'system', content: 'global' },
                { role: 'user', content: 'hello' },
            ]),
            'google-generative-ai'
        )
    ).not.toThrow();
    const bridge = createPiSystemMessageBridge(
        toPiContext([{ role: 'system', content: 'global' }, ...input]),
        'google-generative-ai'
    );
    const result = bridge.restore({
        contents: bridge.context.messages.map(message => ({
            role: message.role,
            parts: [{ text: message.content }],
        })),
        config: { systemInstruction: bridge.context.systemPrompt },
    });
    expect(result).toEqual({
        config: { systemInstruction: 'global' },
        contents: [{ role: 'user', parts: input.map(message => ({ text: message.content })) }],
    });
});

test('retains valid Anthropic systems and falls back only for invalid positions within the same request', () => {
    const valid = [
        { role: 'user' as const, content: 'user' },
        { role: 'system' as const, content: 'first instruction' },
        { role: 'system' as const, content: 'second instruction' },
        { role: 'assistant' as const, content: 'answer' },
        { role: 'user' as const, content: 'next' },
        { role: 'system' as const, content: 'tail' },
    ];
    const bridge = createPiSystemMessageBridge(toPiContext(valid), 'anthropic-messages');
    expect(
        bridge.restore({
            messages: bridge.context.messages.map(message => ({
                role: message.role,
                content:
                    typeof message.content === 'string'
                        ? message.content
                        : message.content
                              .map(block => (block.type === 'text' ? block.text : ''))
                              .join(''),
            })),
        })
    ).toEqual({ messages: valid });
    const mixed = [
        { role: 'user' as const, content: 'first user' },
        { role: 'system' as const, content: 'valid middle' },
        { role: 'assistant' as const, content: 'first answer' },
        { role: 'system' as const, content: 'invalid middle' },
        { role: 'user' as const, content: 'second user' },
        { role: 'system' as const, content: 'valid tail' },
    ];
    const mixedBridge = createPiSystemMessageBridge(toPiContext(mixed), 'anthropic-messages');
    const result = mixedBridge.restore({
        messages: mixedBridge.context.messages.map(message => ({
            role: message.role,
            content:
                typeof message.content === 'string'
                    ? message.content
                    : message.content
                          .map(block => (block.type === 'text' ? block.text : ''))
                          .join(''),
        })),
    });
    expect(result).toEqual({
        messages: [
            mixed[0],
            mixed[1],
            mixed[2],
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'invalid middle' },
                    { type: 'text', text: 'second user' },
                ],
            },
            mixed[5],
        ],
    });
});

test('real Pi adapters send native systems without changing ordinary text, images or tool associations', () => {
    const result = spawnSync(
        process.execPath,
        [resolve(__dirname, 'fixtures/pi_system_messages_transport.mjs')],
        {
            encoding: 'utf8',
            timeout: 30_000,
        }
    );
    if (result.error || result.status !== 0)
        throw new Error(result.error?.message ?? result.stderr ?? result.stdout);
    expect(result.stdout).toContain('All native system transport checks passed');
}, 35_000);
