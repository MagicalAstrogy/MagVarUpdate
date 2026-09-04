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

    test('maps OpenAI Responses json object mode exactly without mutating input', () => {
        const input = {
            model: 'gpt',
            input: [],
            stream: true,
            text: { verbosity: 'low' },
        };
        const snapshot = structuredClone(input);

        const result = transformPiPayload(input, {
            api: 'openai-responses',
            responseFormat: '格式化输出(v4兼容)',
        });

        expect(result).toEqual({
            ...input,
            text: {
                verbosity: 'low',
                format: { type: 'json_object' },
            },
        });
        expect(result).not.toHaveProperty('response_format');
        expect(result).not.toHaveProperty('output_config');
        expect(result).not.toHaveProperty('config');
        expect(input).toEqual(snapshot);
    });

    test('maps Codex Responses structured modes through the Responses text envelope', () => {
        expect(
            transformPiPayload(
                { model: 'gpt', input: [], text: { verbosity: 'low' } },
                {
                    api: 'openai-codex-responses',
                    responseFormat: '格式化输出',
                    jsonSchema: schema,
                }
            )
        ).toMatchObject({
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
        expect(
            transformPiPayload(
                { model: 'gpt', input: [] },
                {
                    api: 'openai-codex-responses',
                    responseFormat: '格式化输出(v4兼容)',
                }
            )
        ).toMatchObject({ text: { format: { type: 'json_object' } } });
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

    test('maps Chat Completions native json schema exactly without mutating input', () => {
        const input = {
            model: 'gpt',
            messages: [],
            stream: true,
            parallel_tool_calls: false,
        };
        const snapshot = structuredClone(input);

        const result = transformPiPayload(input, {
            api: 'openai-completions',
            responseFormat: '格式化输出',
            jsonSchema: schema,
        });

        expect(result).toEqual({
            ...input,
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'mvu_update',
                    description: 'MVU patch',
                    schema: schema.value,
                    strict: true,
                },
            },
        });
        expect(result).not.toHaveProperty('text');
        expect(result).not.toHaveProperty('output_config');
        expect(result).not.toHaveProperty('config');
        expect(input).toEqual(snapshot);
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

    test('maps Google json object mode exactly without mutating input', () => {
        const input = {
            model: 'gemini',
            contents: [],
            config: {
                temperature: 0.4,
                thinkingConfig: { thinkingBudget: 256 },
            },
        };
        const snapshot = structuredClone(input);

        const result = transformPiPayload(input, {
            api: 'google-generative-ai',
            responseFormat: '格式化输出(v4兼容)',
        });

        expect(result).toEqual({
            ...input,
            config: {
                temperature: 0.4,
                thinkingConfig: { thinkingBudget: 256 },
                responseMimeType: 'application/json',
            },
        });
        expect(result).not.toHaveProperty('response_format');
        expect(result).not.toHaveProperty('text');
        expect(result).not.toHaveProperty('output_config');
        expect(input).toEqual(snapshot);
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

    test('maps Anthropic JSON Schema output without replacing output_config effort', () => {
        const input = {
            model: 'claude',
            messages: [],
            output_config: { effort: 'high' },
        };

        expect(
            transformPiPayload(input, {
                api: 'anthropic-messages',
                responseFormat: '格式化输出',
                jsonSchema: schema,
            })
        ).toEqual({
            ...input,
            output_config: {
                effort: 'high',
                format: {
                    type: 'json_schema',
                    schema: schema.value,
                },
            },
        });
        expect(input.output_config).toEqual({ effort: 'high' });
    });

    test('does not invent Anthropic JSON-object mode for the v4-compatible format', () => {
        expect(() =>
            transformPiPayload(
                { model: 'claude', messages: [] },
                {
                    api: 'anthropic-messages',
                    responseFormat: '格式化输出(v4兼容)',
                }
            )
        ).toThrow('does not support native JSON-object output');
    });

    test('maps Mistral structured modes to its camelCase pre-wire payload', () => {
        const input = {
            model: 'mistral-large-latest',
            messages: [],
            stream: true,
        };

        expect(
            transformPiPayload(input, {
                api: 'mistral-conversations',
                responseFormat: '格式化输出',
                jsonSchema: schema,
            })
        ).toEqual({
            ...input,
            responseFormat: {
                type: 'json_schema',
                jsonSchema: {
                    name: 'mvu_update',
                    description: 'MVU patch',
                    schemaDefinition: schema.value,
                    strict: true,
                },
            },
        });
        expect(
            transformPiPayload(input, {
                api: 'mistral-conversations',
                responseFormat: '格式化输出(v4兼容)',
            })
        ).toEqual({ ...input, responseFormat: { type: 'json_object' } });
        expect(input).toEqual({
            model: 'mistral-large-latest',
            messages: [],
            stream: true,
        });
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
        expect(
            transformPiPayload({ messages: [] }, { api: 'mistral-conversations', sampling })
        ).toEqual({
            messages: [],
            topP: 0.8,
            frequencyPenalty: 0.2,
            presencePenalty: -0.1,
        });
    });

    test('protects the Mistral camelCase output limit field', () => {
        expect(() =>
            transformPiPayload(
                { model: 'mistral-large-latest', messages: [], maxTokens: 4096 },
                {
                    api: 'mistral-conversations',
                    customIncludeBody: { maxTokens: 1 },
                }
            )
        ).toThrow("cannot override protected field 'maxTokens'");
    });
});
