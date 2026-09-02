import type { Api } from '@earendil-works/pi-ai';

export type PiStructuredResponseFormat = '格式化输出' | '格式化输出(v4兼容)';

export type PiJsonSchema = {
    name: string;
    description?: string;
    value: Record<string, unknown>;
    strict?: boolean;
};

export type PiPayloadTransformOptions = {
    api: Api;
    responseFormat?: PiStructuredResponseFormat;
    jsonSchema?: PiJsonSchema;
    customIncludeBody?: Record<string, unknown>;
    customExcludeBody?: readonly string[];
    sampling?: {
        topP?: number;
        topK?: number;
        frequencyPenalty?: number;
        presencePenalty?: number;
    };
};

const PROTECTED_FIELDS = new Set([
    '__proto__',
    'constructor',
    'prototype',
    'config',
    'instructions',
    'model',
    'messages',
    'input',
    'contents',
    'system',
    'stream',
    'tools',
    'tool_choice',
    'toolChoice',
    'toolConfig',
    'max_tokens',
    'max_completion_tokens',
    'max_output_tokens',
]);

const GOOGLE_PROTECTED_CONFIG_FIELDS = new Set([
    '__proto__',
    'constructor',
    'prototype',
    'abortSignal',
    'automaticFunctionCalling',
    'httpOptions',
    'maxOutputTokens',
    'responseJsonSchema',
    'responseMimeType',
    'responseSchema',
    'systemInstruction',
    'temperature',
    'thinkingConfig',
    'toolConfig',
    'tools',
    'topK',
    'topP',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function applyCustomFields(
    payload: Record<string, unknown>,
    include: Record<string, unknown>,
    exclude: readonly string[]
): Record<string, unknown> {
    // Provider payloads may contain live browser objects (notably Google's AbortSignal).
    // A deep structuredClone turns those into plain objects and breaks cancellation. Only clone
    // the top-level payload here; user-supplied include values are cloned individually below.
    const result = { ...payload };
    for (const name of exclude) {
        if (PROTECTED_FIELDS.has(name)) {
            throw new Error(`More source custom body cannot exclude protected field '${name}'`);
        }
        delete result[name];
    }
    for (const [name, value] of Object.entries(include)) {
        if (PROTECTED_FIELDS.has(name)) {
            throw new Error(`More source custom body cannot override protected field '${name}'`);
        }
        result[name] = structuredClone(value);
    }
    return result;
}

function googleConfigField(path: string): string {
    const match = /^config\.([^.]+)$/.exec(path);
    if (!match) {
        throw new Error(
            `More source customExcludeBody for Google must use a direct 'config.<field>' path, received '${path}'`
        );
    }
    return match[1];
}

function assertGoogleConfigFieldAllowed(field: string, operation: 'override' | 'exclude'): void {
    if (GOOGLE_PROTECTED_CONFIG_FIELDS.has(field)) {
        throw new Error(
            `More source custom body cannot ${operation} protected field 'config.${field}'`
        );
    }
}

function applyGoogleCustomFields(
    payload: Record<string, unknown>,
    include: Record<string, unknown>,
    exclude: readonly string[]
): Record<string, unknown> {
    const existing_config = isPlainObject(payload.config) ? payload.config : {};
    const config = { ...existing_config };

    for (const path of exclude) {
        if (path === 'config' || PROTECTED_FIELDS.has(path)) {
            throw new Error(`More source custom body cannot exclude protected field '${path}'`);
        }
        const field = googleConfigField(path);
        assertGoogleConfigFieldAllowed(field, 'exclude');
        delete config[field];
    }

    for (const [name, value] of Object.entries(include)) {
        if (name !== 'config') {
            if (PROTECTED_FIELDS.has(name)) {
                throw new Error(
                    `More source custom body cannot override protected field '${name}'`
                );
            }
            throw new Error(
                `More source customIncludeBody for Google must place '${name}' inside the 'config' object`
            );
        }
        if (!isPlainObject(value)) {
            throw new Error(
                "More source customIncludeBody for Google requires 'config' to be an object"
            );
        }
        for (const [field, field_value] of Object.entries(value)) {
            assertGoogleConfigFieldAllowed(field, 'override');
            config[field] = structuredClone(field_value);
        }
    }

    return { ...payload, config };
}

function applyNativeStructuredOutput(
    payload: Record<string, unknown>,
    api: Api,
    response_format: PiStructuredResponseFormat,
    schema: PiJsonSchema | undefined
): Record<string, unknown> {
    if (response_format === '格式化输出' && !schema) {
        throw new Error('More source structured output requires a JSON schema');
    }

    const is_json_schema = response_format === '格式化输出';
    if (api === 'openai-completions') {
        return {
            ...payload,
            response_format: is_json_schema
                ? {
                      type: 'json_schema',
                      json_schema: {
                          name: schema!.name,
                          ...(schema!.description ? { description: schema!.description } : {}),
                          schema: schema!.value,
                          strict: schema!.strict ?? true,
                      },
                  }
                : { type: 'json_object' },
        };
    }

    if (api === 'openai-responses') {
        const existing_text = isPlainObject(payload.text) ? payload.text : {};
        return {
            ...payload,
            text: {
                ...existing_text,
                format: is_json_schema
                    ? {
                          type: 'json_schema',
                          name: schema!.name,
                          ...(schema!.description ? { description: schema!.description } : {}),
                          schema: schema!.value,
                          strict: schema!.strict ?? true,
                      }
                    : { type: 'json_object' },
            },
        };
    }

    if (api === 'google-generative-ai') {
        if (!is_json_schema) {
            return {
                ...payload,
                config: {
                    ...(isPlainObject(payload.config) ? payload.config : {}),
                    responseMimeType: 'application/json',
                },
            };
        }
        return {
            ...payload,
            config: {
                ...(isPlainObject(payload.config) ? payload.config : {}),
                responseMimeType: 'application/json',
                responseJsonSchema: schema!.value,
            },
        };
    }

    throw new Error(`More source API '${api}' does not support native structured output`);
}

function applyApiSampling(
    payload: Record<string, unknown>,
    api: Api,
    sampling: PiPayloadTransformOptions['sampling']
): Record<string, unknown> {
    if (!sampling) {
        return payload;
    }
    if (api === 'openai-completions') {
        return {
            ...payload,
            ...(sampling.topP === undefined ? {} : { top_p: sampling.topP }),
            ...(sampling.frequencyPenalty === undefined
                ? {}
                : { frequency_penalty: sampling.frequencyPenalty }),
            ...(sampling.presencePenalty === undefined
                ? {}
                : { presence_penalty: sampling.presencePenalty }),
        };
    }
    if (api === 'openai-responses') {
        return {
            ...payload,
            ...(sampling.topP === undefined ? {} : { top_p: sampling.topP }),
        };
    }
    if (api === 'anthropic-messages') {
        return {
            ...payload,
            ...(sampling.topP === undefined ? {} : { top_p: sampling.topP }),
            ...(sampling.topK === undefined ? {} : { top_k: sampling.topK }),
        };
    }
    if (api === 'google-generative-ai') {
        return {
            ...payload,
            config: {
                ...(isPlainObject(payload.config) ? payload.config : {}),
                ...(sampling.topP === undefined ? {} : { topP: sampling.topP }),
                ...(sampling.topK === undefined ? {} : { topK: sampling.topK }),
            },
        };
    }
    return payload;
}

export function transformPiPayload(payload: unknown, options: PiPayloadTransformOptions): unknown {
    if (!isPlainObject(payload)) {
        throw new Error('More source provider payload must be an object');
    }
    let result = applyApiSampling(payload, options.api, options.sampling);
    result =
        options.api === 'google-generative-ai'
            ? applyGoogleCustomFields(
                  result,
                  options.customIncludeBody ?? {},
                  options.customExcludeBody ?? []
              )
            : applyCustomFields(
                  result,
                  options.customIncludeBody ?? {},
                  options.customExcludeBody ?? []
              );
    if (options.responseFormat) {
        result = applyNativeStructuredOutput(
            result,
            options.api,
            options.responseFormat,
            options.jsonSchema
        );
    }
    return result;
}

export function createPiPayloadTransform(options: PiPayloadTransformOptions) {
    return (payload: unknown) => transformPiPayload(payload, options);
}
