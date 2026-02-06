import { compare } from 'compare-versions';
import JSON5 from 'json5';
import { jsonrepair } from 'jsonrepair';

// 修正 _.merge 对数组的合并逻辑, [1, 2, 3] 和 [4, 5] 合并后变成 [4, 5] 而不是 [4, 5, 3]
export function correctlyMerge<TObject, TSource>(lhs: TObject, rhs: TSource): TObject & TSource {
    return _.mergeWith(lhs, rhs, (_lhs, rhs) => (_.isArray(rhs) ? rhs : undefined));
}

export function uuidv4(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

export async function checkMinimumVersion(expected: string, title: string) {
    if (compare(await getTavernHelperVersion(), expected, '<')) {
        toastr.error(`'${title}' 需要酒馆助手版本 >= '${expected}'`, '版本不兼容');
    }
}
export function literalYamlify(value: any) {
    return YAML.stringify(value, { blockQuote: 'literal' });
}

export function parseString(content: string): any {
    let parsed: unknown;
    try {
        parsed = YAML.parseDocument(content, { merge: true }).toJS();
    } catch (yaml_error) {
        try {
            // eslint-disable-next-line import-x/no-named-as-default-member
            parsed = JSON5.parse(content);
        } catch (json5_error) {
            try {
                parsed = JSON.parse(jsonrepair(content));
            } catch (json_error) {
                const toError = (error: unknown) =>
                    error instanceof Error ? error.message : String(error);
                throw new Error(
                    literalYamlify({
                        ['要解析的字符串不是有效的 YAML/JSON 格式']: {
                            字符串内容: content,
                            YAML错误信息: toError(yaml_error),
                            JSON5错误信息: toError(json5_error),
                            尝试修复JSON时的错误信息: toError(json_error),
                        },
                    })
                );
            }
        }
    }
    return parsed;
}
