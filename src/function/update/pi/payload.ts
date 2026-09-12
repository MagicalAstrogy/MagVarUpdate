import type { Api } from '@earendil-works/pi-ai';

/** 需要映射到服务商原生 JSON 输出配置的两种应答格式。 */
export type PiStructuredResponseFormat = '格式化输出' | '格式化输出(v4兼容)';

/** MVU 的结构化输出 Schema，包含协议需要的名称及可选严格校验标记。 */
export type PiJsonSchema = {
    name: string;
    description?: string;
    value: Record<string, unknown>;
    strict?: boolean;
};

/** 单次请求的原生载荷转换选项；消息角色由独立的 system 桥接层恢复。 */
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
    'maxTokens',
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

/** 判断请求体或自定义配置是否为非空、非数组对象。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 先删除再合并自定义字段，同时阻止修改受保护的请求字段。
 * 只浅拷贝原请求体以保留 AbortSignal 等浏览器对象，用户覆盖值单独深拷贝。
 */
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

/** 只接受 config.<字段> 形式的 Google 删除路径，避免歧义或删除整个生成配置。 */
function googleConfigField(path: string): string {
    const match = /^config\.([^.]+)$/.exec(path);
    if (!match) {
        throw new Error(
            `More source customExcludeBody for Google must use a direct 'config.<field>' path, received '${path}'`
        );
    }
    return match[1];
}

/** 阻止自定义配置覆盖或删除由运行时管理的 Google 核心字段。 */
function assertGoogleConfigFieldAllowed(field: string, operation: 'override' | 'exclude'): void {
    if (GOOGLE_PROTECTED_CONFIG_FIELDS.has(field)) {
        throw new Error(
            `More source custom body cannot ${operation} protected field 'config.${field}'`
        );
    }
}

/** 将 Google 自定义参数限制在 config 内，保留现有配置中的取消信号等对象。 */
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

/** 按协议写入原生 JSON Schema 或 JSON 对象输出配置，不支持的组合直接报错。 */
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

    if (api === 'openai-responses' || api === 'openai-codex-responses') {
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

    if (api === 'anthropic-messages') {
        if (!is_json_schema) {
            throw new Error(`More source API '${api}' does not support native JSON-object output`);
        }
        const existing_output_config = isPlainObject(payload.output_config)
            ? payload.output_config
            : {};
        return {
            ...payload,
            output_config: {
                ...existing_output_config,
                format: {
                    type: 'json_schema',
                    schema: schema!.value,
                },
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

    if (api === 'mistral-conversations') {
        return {
            ...payload,
            responseFormat: is_json_schema
                ? {
                      type: 'json_schema',
                      jsonSchema: {
                          name: schema!.name,
                          ...(schema!.description ? { description: schema!.description } : {}),
                          schemaDefinition: schema!.value,
                          strict: schema!.strict ?? true,
                      },
                  }
                : { type: 'json_object' },
        };
    }

    throw new Error(`More source API '${api}' does not support native structured output`);
}

/** 将统一采样选项转换为各协议的字段名称和嵌套位置。 */
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
    if (api === 'mistral-conversations') {
        return {
            ...payload,
            ...(sampling.topP === undefined ? {} : { topP: sampling.topP }),
            ...(sampling.frequencyPenalty === undefined
                ? {}
                : { frequencyPenalty: sampling.frequencyPenalty }),
            ...(sampling.presencePenalty === undefined
                ? {}
                : { presencePenalty: sampling.presencePenalty }),
        };
    }
    return payload;
}

/** 统一应用请求覆盖、采样和原生应答格式，并保留协议核心字段的控制权。 */
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

/** 将本轮转换选项绑定为 Pi 的 onPayload 回调。 */
export function createPiPayloadTransform(options: PiPayloadTransformOptions) {
    return (payload: unknown) => transformPiPayload(payload, options);
}
