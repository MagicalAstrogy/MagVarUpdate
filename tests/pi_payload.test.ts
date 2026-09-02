import { transformPiPayload } from '@/function/update/pi/payload';

const schema = {
    name: 'mvu_update',
    description: 'MVU patch',
    value: {
        type: 'object',
        properties: { json_patch: { type: 'array' } },
        required: ['json_patch'],
    },
    strict: true,
};

describe('Pi payload transform', () => {
    test('maps OpenAI Responses native json schema without mutating input', () => {
        const input = { model: 'gpt', input: [], stream: true, text: { verbosity: 'low' } };
        const result = transformPiPayload(input, {
            api: 'openai-responses',
            responseFormat: '格式化输出',
            jsonSchema: schema,
        });

        expect(result).toEqual({
            ...input,
            text: {
                verbosity: 'low',
                format: {
                    type: 'json_schema',
                    name: 'mvu_update',
                    description: 'MVU patch',
                    schema: schema.value,
                    strict: true,
                },
            },
        });
        expect(input).toEqual({
            model: 'gpt',
            input: [],
            stream: true,
            text: { verbosity: 'low' },
        });
    });

    test('maps Chat Completions json object mode', () => {
        expect(
            transformPiPayload(
                { model: 'gpt', messages: [] },
                {
                    api: 'openai-completions',
                    responseFormat: '格式化输出(v4兼容)',
                }
            )
        ).toMatchObject({ response_format: { type: 'json_object' } });
    });

    test('maps Google structured output inside config', () => {
        expect(
            transformPiPayload(
                { model: 'gemini', contents: [], config: { temperature: 0.4 } },
                {
                    api: 'google-generative-ai',
                    responseFormat: '格式化输出',
                    jsonSchema: schema,
                }
            )
        ).toMatchObject({
            config: {
                temperature: 0.4,
                responseMimeType: 'application/json',
                responseJsonSchema: schema.value,
            },
        });
    });

    test('preserves live Google AbortSignal objects through payload transforms', () => {
        const controller = new AbortController();
        const input = {
            model: 'gemini',
            contents: [],
            config: { abortSignal: controller.signal, temperature: 0.4 },
        };

        const result = transformPiPayload(input, {
            api: 'google-generative-ai',
            responseFormat: '格式化输出',
            jsonSchema: schema,
            sampling: { topP: 0.8 },
        }) as { config: { abortSignal: AbortSignal } };

        expect(result).not.toBe(input);
        expect(result.config).not.toBe(input.config);
        expect(result.config.abortSignal).toBe(controller.signal);
        expect(result.config.abortSignal).toBeInstanceOf(AbortSignal);
        expect(input.config).toEqual({ abortSignal: controller.signal, temperature: 0.4 });
    });

    test('applies Google custom body fields inside config without losing live request state', () => {
        const controller = new AbortController();
        const input = {
            model: 'gemini',
            contents: [],
            config: {
                abortSignal: controller.signal,
                stopSequences: ['old'],
                temperature: 0.4,
            },
        };

        const result = transformPiPayload(input, {
            api: 'google-generative-ai',
            customIncludeBody: {
                config: {
                    safetySettings: [{ category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' }],
                },
            },
            customExcludeBody: ['config.stopSequences'],
        }) as { config: Record<string, unknown> };

        expect(result).toEqual({
            model: 'gemini',
            contents: [],
            config: {
                abortSignal: controller.signal,
                temperature: 0.4,
                safetySettings: [{ category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' }],
            },
        });
        expect(result.config.abortSignal).toBe(controller.signal);
        expect(input.config.stopSequences).toEqual(['old']);
    });

    test('fails closed for ignored or protected Google custom body fields', () => {
        expect(() =>
            transformPiPayload(
                { model: 'gemini', contents: [], config: {} },
                {
                    api: 'google-generative-ai',
                    customIncludeBody: { safetySettings: [] },
                }
            )
        ).toThrow("must place 'safetySettings' inside the 'config' object");
        expect(() =>
            transformPiPayload(
                { model: 'gemini', contents: [], config: {} },
                {
                    api: 'google-generative-ai',
                    customIncludeBody: { config: { abortSignal: null } },
                }
            )
        ).toThrow("cannot override protected field 'config.abortSignal'");
        expect(() =>
            transformPiPayload(
                { model: 'gemini', contents: [], config: {} },
                {
                    api: 'google-generative-ai',
                    customExcludeBody: ['config.tools'],
                }
            )
        ).toThrow("cannot exclude protected field 'config.tools'");
        expect(() =>
            transformPiPayload(
                { model: 'gemini', contents: [], config: {} },
                {
                    api: 'google-generative-ai',
                    customExcludeBody: ['safetySettings'],
                }
            )
        ).toThrow("must use a direct 'config.<field>' path");
    });

    test('rejects structured output for an unsupported API', () => {
        expect(() =>
            transformPiPayload(
                { model: 'claude', messages: [] },
                {
                    api: 'anthropic-messages',
                    responseFormat: '格式化输出',
                    jsonSchema: schema,
                }
            )
        ).toThrow('does not support native structured output');
    });

    test('applies custom fields but protects protocol fields', () => {
        expect(
            transformPiPayload(
                { model: 'gpt', input: [], metadata: 'remove-me' },
                {
                    api: 'openai-responses',
                    customIncludeBody: { service_tier: 'priority' },
                    customExcludeBody: ['metadata'],
                }
            )
        ).toEqual({ model: 'gpt', input: [], service_tier: 'priority' });

        expect(() =>
            transformPiPayload(
                { model: 'gpt', input: [] },
                { api: 'openai-responses', customIncludeBody: { model: 'stolen' } }
            )
        ).toThrow("cannot override protected field 'model'");
        expect(() =>
            transformPiPayload(
                { model: 'gpt', input: [] },
                { api: 'openai-responses', customExcludeBody: ['input'] }
            )
        ).toThrow("cannot exclude protected field 'input'");
        expect(() =>
            transformPiPayload(
                { model: 'claude', messages: [], system: [] },
                {
                    api: 'anthropic-messages',
                    customIncludeBody: { system: 'replacement' },
                }
            )
        ).toThrow("cannot override protected field 'system'");
        expect(() =>
            transformPiPayload(
                { model: 'gemini', contents: [], config: {} },
                {
                    api: 'google-generative-ai',
                    customExcludeBody: ['config'],
                }
            )
        ).toThrow("cannot exclude protected field 'config'");
        expect(() =>
            transformPiPayload(
                { model: 'gpt', input: [] },
                {
                    api: 'openai-responses',
                    customIncludeBody: Object.fromEntries([['__proto__', { polluted: true }]]),
                }
            )
        ).toThrow("cannot override protected field '__proto__'");
    });

    test('maps only API-supported sampling fields', () => {
        const sampling = {
            topP: 0.8,
            topK: 32,
            frequencyPenalty: 0.2,
            presencePenalty: -0.1,
        };
        expect(
            transformPiPayload({ messages: [] }, { api: 'openai-completions', sampling })
        ).toMatchObject({ top_p: 0.8, frequency_penalty: 0.2, presence_penalty: -0.1 });
        expect(transformPiPayload({ input: [] }, { api: 'openai-responses', sampling })).toEqual({
            input: [],
            top_p: 0.8,
        });
        expect(
            transformPiPayload({ input: [] }, { api: 'openai-codex-responses', sampling })
        ).toEqual({ input: [] });
        expect(
            transformPiPayload({ messages: [] }, { api: 'anthropic-messages', sampling })
        ).toMatchObject({ top_p: 0.8, top_k: 32 });
        expect(
            transformPiPayload(
                { contents: [], config: { temperature: 1 } },
                { api: 'google-generative-ai', sampling }
            )
        ).toMatchObject({ config: { temperature: 1, topP: 0.8, topK: 32 } });
    });
});
