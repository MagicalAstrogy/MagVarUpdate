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
    const json_first = /^[[{]/s.test(content.trimStart());
    try {
        if (json_first) {
            throw Error(`expected error`);
        }
        return YAML.parseDocument(content, { merge: true }).toJS();
    } catch (yaml_error1) {
        try {
            // eslint-disable-next-line import-x/no-named-as-default-member
            return JSON5.parse(content);
        } catch (json5_error) {
            try {
                return JSON.parse(jsonrepair(content));
            } catch (json_error) {
                try {
                    if (!json_first) {
                        throw Error(`expected error`);
                    }
                    return YAML.parseDocument(content, { merge: true }).toJS();
                } catch (yaml_error2) {
                    const toError = (error: unknown) =>
                        error instanceof Error
                            ? `${error.stack ? error.stack : error.message}`
                            : String(error);

                    throw new Error(
                        literalYamlify({
                            ['要解析的字符串不是有效的 YAML/JSON/JSON5 格式']: {
                                字符串内容: content,
                                YAML错误信息: toError(json_first ? yaml_error2 : yaml_error1),
                                JSON5错误信息: toError(json5_error),
                                JSON错误信息: toError(json_error),
                            },
                        })
                    );
                }
            }
        }
    }
}
