import { compileEntryCommentRegex } from '@/function/request/entry_comment_regex';
import { klona } from 'klona';
import * as z from 'zod';

export const CHARACTER_SETTINGS_OVERRIDE_ENTRY_NAME = '[config_override]';

export const CharacterSettingsOverrideSchema = z
    .object({
        更新方式: z.enum(['随AI输出', '额外模型解析']).optional(),
        额外模型解析配置: z
            .object({
                启用自动请求: z.boolean().optional(),
                世界书条目白名单正则: z.string().optional(),
                世界书条目黑名单正则: z.string().optional(),
            })
            .loose()
            .optional(),
        兼容性: z
            .object({
                更新到聊天变量: z.boolean().optional(),
                sendas不视为user消息: z.boolean().optional(),
            })
            .loose()
            .optional(),
    })
    .loose();

export type CharacterSettingsOverride = z.infer<typeof CharacterSettingsOverrideSchema>;

export type CharacterSettingsOverridePath =
    | '更新方式'
    | '额外模型解析配置.启用自动请求'
    | '额外模型解析配置.世界书条目白名单正则'
    | '额外模型解析配置.世界书条目黑名单正则'
    | '兼容性.更新到聊天变量'
    | '兼容性.sendas不视为user消息';

export type CharacterSettingsOverrideValue = string | boolean | undefined;

export function isCharacterSettingsOverrideEntryName(name: unknown): boolean {
    return (
        typeof name === 'string' &&
        name.trim().toLowerCase() === CHARACTER_SETTINGS_OVERRIDE_ENTRY_NAME
    );
}

export function hasOwnCharacterSettingsOverride(
    draft: CharacterSettingsOverride,
    path: CharacterSettingsOverridePath
): boolean {
    return _.has(draft, path);
}

export function getCharacterSettingsOverrideValue(
    draft: CharacterSettingsOverride,
    path: CharacterSettingsOverridePath
): CharacterSettingsOverrideValue {
    return _.get(draft, path) as CharacterSettingsOverrideValue;
}

function removeEmptyKnownValues(draft: CharacterSettingsOverride): CharacterSettingsOverride {
    const result = klona(draft);
    const extra_model = result.额外模型解析配置;
    if (extra_model) {
        for (const key of ['世界书条目白名单正则', '世界书条目黑名单正则'] as const) {
            if (extra_model[key]?.trim() === '') {
                delete extra_model[key];
            }
        }
        if (Object.keys(extra_model).length === 0) {
            delete result.额外模型解析配置;
        }
    }
    if (result.兼容性 && Object.keys(result.兼容性).length === 0) {
        delete result.兼容性;
    }
    return result;
}

export function normalizeCharacterSettingsOverride(
    draft: CharacterSettingsOverride
): CharacterSettingsOverride {
    return CharacterSettingsOverrideSchema.parse(removeEmptyKnownValues(draft));
}

function makeAdditionalPropertiesExplicit(schema: unknown): unknown {
    if (Array.isArray(schema)) {
        return schema.map(makeAdditionalPropertiesExplicit);
    }
    if (!_.isPlainObject(schema)) {
        return schema;
    }

    const result = Object.fromEntries(
        Object.entries(schema as Record<string, unknown>).map(([key, value]) => [
            key,
            key === 'additionalProperties' && _.isPlainObject(value) && _.isEmpty(value)
                ? true
                : makeAdditionalPropertiesExplicit(value),
        ])
    );
    return result;
}

export function getCharacterSettingsOverrideJsonSchema(): Record<string, unknown> {
    const generated = z.toJSONSchema(CharacterSettingsOverrideSchema, {
        target: 'draft-2020-12',
    });
    return {
        ...(makeAdditionalPropertiesExplicit(generated) as Record<string, unknown>),
        title: 'CharacterSettingsOverride',
    };
}

export function parseCharacterSettingsOverrideContent(content: string): CharacterSettingsOverride {
    const document = JSON.parse(content) as unknown;
    if (!_.isPlainObject(document)) {
        throw new Error('配置正文必须是 JSON 对象');
    }

    const { schema: _embedded_schema, ...draft } = document as Record<string, unknown>;
    return normalizeCharacterSettingsOverride(CharacterSettingsOverrideSchema.parse(draft));
}

export function recoverCharacterSettingsOverridePassthrough(
    content: string
): CharacterSettingsOverride {
    const document = JSON.parse(content) as unknown;
    if (!_.isPlainObject(document)) {
        return {};
    }

    const recovered = klona(document) as Record<string, unknown>;
    delete recovered.schema;
    delete recovered.更新方式;

    const remove_known_nested_fields = (key: '额外模型解析配置' | '兼容性', fields: string[]) => {
        const nested = recovered[key];
        if (!_.isPlainObject(nested)) {
            delete recovered[key];
            return;
        }
        const nested_record = nested as Record<string, unknown>;
        fields.forEach(field => delete nested_record[field]);
        if (_.isEmpty(nested_record)) {
            delete recovered[key];
        }
    };
    remove_known_nested_fields('额外模型解析配置', [
        '启用自动请求',
        '世界书条目白名单正则',
        '世界书条目黑名单正则',
    ]);
    remove_known_nested_fields('兼容性', ['更新到聊天变量', 'sendas不视为user消息']);

    return CharacterSettingsOverrideSchema.parse(recovered);
}

export function serializeCharacterSettingsOverride(draft: CharacterSettingsOverride): string {
    const normalized = normalizeCharacterSettingsOverride(draft);
    const { schema: _existing_schema, ...config } = normalized;
    const document = {
        ...config,
        schema: getCharacterSettingsOverrideJsonSchema(),
    };
    return JSON.stringify(document, null, 4);
}

export function hasActiveCharacterSettingsOverride(draft: CharacterSettingsOverride): boolean {
    const ordinary_paths: CharacterSettingsOverridePath[] = [
        '更新方式',
        '额外模型解析配置.启用自动请求',
        '兼容性.更新到聊天变量',
        '兼容性.sendas不视为user消息',
    ];
    if (ordinary_paths.some(path => hasOwnCharacterSettingsOverride(draft, path))) {
        return true;
    }

    return (
        compileEntryCommentRegex(draft.额外模型解析配置?.世界书条目白名单正则 ?? '').regex !==
            undefined ||
        compileEntryCommentRegex(draft.额外模型解析配置?.世界书条目黑名单正则 ?? '').regex !==
            undefined
    );
}
