import {
    cleanUpMetadata,
    generateSchema,
    getSchemaForPath,
    reconcileAndApplySchema,
} from '@/schema';
import { useSettingsStore } from '@/settings';
import { parseString, saveChatDebounced } from '@/util';
import {
    assertVWD,
    isArraySchema,
    isObjectSchema,
    isValueWithDescriptionStatData,
    MvuData,
    TemplateType,
    UpdateContext,
    variable_events,
    VariableData,
} from '@/variable_def';
import * as jsonpatch from 'fast-json-patch';
import { klona } from 'klona';
import * as math from 'mathjs';

function isJsonPatch(patch: any): patch is jsonpatch.Operation[] {
    if (!Array.isArray(patch)) {
        return false;
    }
    // An empty array is a valid patch.
    if (patch.length === 0) {
        return true;
    }
    // Check if all operations have 'op' and 'path'.
    return patch.every(
        op =>
            typeof op === 'object' &&
            op !== null &&
            typeof op.op === 'string' &&
            typeof op.path === 'string'
    );
}

export function trimQuotesAndBackslashes(str: string): string {
    if (!_.isString(str)) return str;
    // Regular expression to match backslashes and quotes (including backticks) at the beginning and end
    return str.replace(/^[\\"'` ]*(.*?)[\\"'` ]*$/, '$1');
}

/**
 * 应用模板到值上，值的属性优先级高于模板
 * @param value 要应用模板的值
 * @param template 模板 (TemplateType | undefined)
 * @param strict_array_cast 是否开启严格模式，开启后不允许 primitive type -> [primitive type] 的隐式转换
 * @param array_merge_concat 指明数组的 合并 行为是指 覆盖 还是 拼接，默认拼接。
 * @returns 合并后的值
 */
export function applyTemplate(
    value: any,
    template: TemplateType | undefined,
    strict_array_cast: boolean = false,
    array_merge_concat: boolean = true
): any {
    // 如果没有模板，直接返回原值
    if (!template) {
        return value;
    }

    // 检查类型是否匹配
    const value_is_object = _.isObject(value) && !Array.isArray(value) && !_.isDate(value);
    const value_is_array = Array.isArray(value);
    const template_is_array = Array.isArray(template);

    if (value_is_object && !template_is_array) {
        // value 是对象，template 是 StatData（对象）
        // 先应用模板，再应用值，确保值的优先级更高
        return _.merge({}, template, value);
    } else if (value_is_array && template_is_array) {
        // 都是数组，进行合并
        if (array_merge_concat) return _.concat(value, template);
        return _.merge([], template, value);
    } else if (
        ((value_is_object || value_is_array) && template_is_array !== value_is_array) ||
        (!value_is_object && !value_is_array && _.isObject(template) && !Array.isArray(template))
    ) {
        // 类型不匹配
        console.error(
            `Template type mismatch: template is ${template_is_array ? 'array' : 'object'}, but value is ${value_is_array ? 'array' : 'object'}. Skipping template merge.`
        );
        return value;
    } else if (!value_is_object && !value_is_array && template_is_array) {
        // 特殊情况：值是原始类型（字面量），模板是数组
        // 当作 [value] 进行数组的合并
        if (strict_array_cast)
            //严格模式不提供 primitive type -> [primitive type] 的转换
            return value;
        if (array_merge_concat) return _.concat([value], template);
        return _.merge([], template, [value]);
    } else {
        // 其他情况：值是原始类型，模板不是数组，不应用模板
        return value;
    }
}

// 一个更安全的、用于解析命令中值的辅助函数
// 它会尝试将字符串解析为 JSON, 布尔值, null, 数字, 或数学表达式
export function parseCommandValue(valStr: string): any {
    if (typeof valStr !== 'string') return valStr;
    const trimmed = valStr.trim();

    // 检查布尔值/null/undefined
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if (trimmed === 'undefined') return undefined;

    try {
        // 如果字符串能被 JSON.parse 解析，说明它是一个标准格式，直接返回解析结果
        return JSON.parse(trimmed);
    } catch (e) {
        // Handle JavaScript array or object literals
        if (
            (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))
        ) {
            try {
                // Safely evaluate literals using a function constructor
                const result = new Function(`return ${trimmed};`)();
                if (_.isObject(result) || Array.isArray(result)) {
                    return result;
                }
            } catch (err) {
                // 如果解析失败，说明它可能是一个未加引号的字符串或数学表达式，继续往下走
            }
        }
    }

    // 如果代码走到这里，说明 trimmed 是一个未加引号的字符串，例如：
    // 'hello_world', '10 + 2', 'sqrt(16)'

    try {
        // 创建一个 scope 对象，将多种数学库/对象注入到 mathjs 的执行环境中，
        // 以便统一处理不同风格的数学表达式。
        const scope = {
            // 支持 JavaScript 标准的 Math 对象 (e.g., Math.sqrt(), Math.PI)
            Math: Math,
            // 支持 Python 风格的 math 库用法 (e.g., math.sqrt(), math.pi)，
            // 这在 LLM 生成的代码中很常见。
            // 'math' 是我们导入的 mathjs 库本身。
            math: math,
        };
        // 尝试使用 mathjs 进行数学求值
        // math.evaluate 对于无法识别为表达式的纯字符串会抛出错误
        const result = math.evaluate(trimmed, scope);
        // 如果结果是 mathjs 的复数或矩阵对象，则将其转换为字符串表示形式
        if (math.isComplex(result) || math.isMatrix(result)) {
            return result.toString();
        }
        // 避免将单个单词的字符串（mathjs可能将其识别为符号）作为 undefined 返回
        if (result === undefined && !/^[a-zA-Z_]+$/.test(trimmed)) {
            return trimmed; // 如果是 undefined 但不是一个简单的符号名，则可能是解析错误
        }
        if (result !== undefined) {
            // 使用 toPrecision 来处理浮点数精度造成的误差问题
            return parseFloat(result.toPrecision(12));
        }
    } catch (err) {
        // 如果 math.evaluate 失败，说明它不是一个有效的表达式，
        // 那么它就是一个普通的未加引号的字符串。
    }

    // 实验性功能，暂不启用
    // 尝试将字符串解析为日期对象，用于传入_.add直接以毫秒数更新时间，如 `_.add('当前时间', 10 * 60 * 1000);`
    // 此检查用于识别日期字符串（例如 "2024-01-01T12:00:00Z"）
    // `isNaN(Number(trimmed))`确保纯数字字符串（如 "12345"）不会被错误地解析为日期
    /*
    if (isNaN(Number(trimmed))) {
        const potentialDate = new Date(trimQuotesAndBackslashes(trimmed));
        if (!isNaN(potentialDate.getTime())) {
            return potentialDate;
        }
    }
    */

    try {
        // 尝试 YAML.parse
        return YAML.parse(trimmed);
    } catch (e) {
        /* empty */
    }

    // 最终，返回这个去除了首尾引号的字符串
    return trimQuotesAndBackslashes(valStr);
}

/**
 * Type definition for CommandNames representing a set of valid command strings.
 *
 * This type is used to define a finite and specific set of command string values
 * that may be used in operations or functions requiring predefined command names.
 *
 * The allowed command names are:
 * - 'set': Represents a command to set a value.
 * - 'insert': Alias of 'assign'
 * - 'assign': Represents a command to assign a value or reference.
 * - 'remove': Represents a command to remove an item or data.
 * - 'add': Represents a command to add an item or data.
 */
type CommandNames = 'set' | 'insert' | 'assign' | 'remove' | 'unset' | 'delete' | 'add';

/**
 * 从大字符串中提取所有 .set(${path}, ${new_value});//${reason} 格式的模式
 * 并解析出每个匹配项的路径、新值和原因部分
 */
// 接口定义：用于统一不同命令的结构
// 新增：Command 接口，比 SetCommand 更通用
interface Command {
    type: CommandNames;
    full_match: string;
    args: string[];
    reason: string;
}

function extractJsonPatch(patch: any): Command[] {
    const translated_commands: Command[] = [];

    for (const op of patch) {
        const path = op.path.substring(1).replace(/\//g, '.');
        switch (op.op) {
            case 'replace':
                translated_commands.push({
                    type: 'set',
                    full_match: JSON.stringify(op),
                    args: [path, JSON.stringify((op as any).value)],
                    reason: 'json_patch',
                });
                break;
            case 'add': {
                const pathParts = _.toPath(path);
                const lastPart = pathParts[pathParts.length - 1];
                const containerPath = pathParts.slice(0, -1).join('.');
                const keyOrIndexArg = /^\d+$/.test(lastPart) ? lastPart : `'${lastPart}'`;
                translated_commands.push({
                    type: 'insert',
                    full_match: JSON.stringify(op),
                    args: [containerPath, keyOrIndexArg, JSON.stringify((op as any).value)],
                    reason: 'json_patch',
                });
                break;
            }
            case 'remove':
                translated_commands.push({
                    type: 'delete',
                    full_match: JSON.stringify(op),
                    args: [path],
                    reason: 'json_patch',
                });
                break;
        }
    }
    return translated_commands;
}

/**
 * 从输入文本中提取所有 _.set() 调用
 *
 * 问题背景：
 * 原本使用正则表达式 /_\.set\(([\s\S]*?)\);/ 来匹配，但这种非贪婪匹配会在遇到
 * 嵌套的 ); 时提前结束。例如：
 * _.set('path', ["text with _.set('inner',null);//comment"], []);
 * 会在 "comment") 处错误地结束匹配
 *
 * 解决方案：
 * 使用状态机方法，通过计数括号配对来准确找到 _.set() 调用的结束位置
 */
// 将 extractSetCommands 扩展为 extractCommands 以支持多种命令
export function extractCommands(inputText: string): Command[] {
    // TODO: 应该按照消息中更新命令出现的顺序来排列 initvar、json_patch 和自定义命令
    const results: (Command & { $index: number })[] = _.concat(
        [...inputText.matchAll(/<(initvar|json_?patch)>(?:```.*)?([\s\S]*?)(?:```)?<\/\1>/gmi)]
            .map(match => ({
                index: match.index ?? 0,
                type: match[1].replaceAll('_', '').toLowerCase(),
                string: match[2],
            }))
            .flatMap(({ index, type, string }): (Command & { $index: number })[] => {
                try {
                    const patch = parseString(string);
                    switch (type) {
                        case 'initvar':
                            return [
                                {
                                    $index: index,
                                    type: 'set',
                                    args: ['', JSON.stringify(patch)],
                                    full_match: string,
                                    reason: 'initvar',
                                },
                            ];
                        case 'jsonpatch':
                            if (isJsonPatch(patch)) {
                                return extractJsonPatch(patch).map(command => ({
                                    $index: index,
                                    ...command,
                                }));
                            }
                            break;
                    }
                } catch {
                    /* ignore */
                }
                return [];
            })
    );

    let i = 0;
    while (i < inputText.length) {
        // 循环处理整个输入文本，直到找不到更多命令
        // 使用正则匹配 _.set(、_.assign(、_.remove( 或 _.add(，重构后支持多种命令
        const setMatch = inputText
            .substring(i)
            .match(/_\.(set|insert|assign|remove|unset|delete|add)\(/);
        if (!setMatch || setMatch.index === undefined) {
            // 没有找到匹配的命令，退出循环，防止无限循环
            break;
        }

        // 提取命令类型（set、assign、remove 或 add），并计算命令的起始位置
        const commandType = setMatch[1] as CommandNames;
        const setStart = i + setMatch.index;
        // 计算开括号位置，用于后续提取参数
        const openParen = setStart + setMatch[0].length;

        // 使用 findMatchingCloseParen 查找匹配的闭括号，解决原正则匹配在嵌套结构（如 _.set('path', ['inner);'])）中提前结束的问题
        const closeParen = findMatchingCloseParen(inputText, openParen);
        if (closeParen === -1) {
            // 找不到闭括号，说明命令格式错误
            // 跳过此无效命令，并从开括号后继续搜索，以防无限循环
            i = openParen; // 从开括号后继续搜索
            continue; // 继续 while 循环，寻找下一个命令
        }

        // 检查闭括号后是否紧跟分号，确保命令语法完整，防止误解析字符串中的类似结构
        let endPos = closeParen + 1;
        if (endPos >= inputText.length || inputText[endPos] !== ';') {
            // 没有分号，命令无效，跳到闭括号后继续搜索，避免误解析
            i = closeParen + 1;
            continue;
        }
        endPos++; // 包含分号，更新命令结束位置

        // 提取可能的注释（// 开头），用于记录命令的 reason
        let comment = '';
        const potentialComment = inputText.substring(endPos).match(/^\s*\/\/(.*)/);
        if (potentialComment) {
            // 提取注释内容并去除首尾空格，更新结束位置
            comment = potentialComment[1].trim();
            endPos += potentialComment[0].length;
        }

        // 提取完整命令字符串，用于返回结果中的 fullMatch 字段，便于追踪原始内容
        const fullMatch = inputText.substring(setStart, endPos);
        // 提取参数字符串，位于开括号和闭括号之间
        const paramsString = inputText.substring(openParen, closeParen);
        // 使用 parseParameters 解析参数，支持嵌套结构（如数组、对象）
        const params = parseParameters(paramsString);

        // 验证命令有效性，根据命令类型检查参数数量，防止无效命令进入结果
        let isValid = false;
        if (commandType === 'set' && params.length >= 2)
            isValid = true; // _.set 至少需要路径和值
        else if (commandType === 'assign' && params.length >= 2)
            isValid = true; // _.assign 支持两种参数格式
        else if (commandType === 'insert' && params.length >= 2)
            isValid = true; // _.insert 支持两种参数格式
        else if (commandType === 'remove' && params.length >= 1)
            isValid = true; // _.remove 至少需要路径
        else if (commandType === 'unset' && params.length >= 1)
            isValid = true; // _.unset 至少需要路径
        else if (commandType === 'delete' && params.length >= 1)
            isValid = true; // _.delete 至少需要路径
        else if (commandType === 'add' && /*params.length === 1 || */ params.length === 2)
            isValid = true; // _.add 需要1个或2个参数

        if (isValid) {
            // 命令有效，添加到结果列表，包含命令类型、完整匹配、参数和注释
            results.push({
                $index: setStart,
                type: commandType,
                full_match: fullMatch,
                args: params,
                reason: comment,
            });
        }

        // 更新搜索索引到命令末尾，继续查找下一个命令
        i = endPos;
    }

    // 返回所有解析出的有效命令
    return _(results)
        .sortBy('$index')
        .map(command => _.omit(command, '$index'))
        .value();
}

/**
 * 辅助函数：找到匹配的闭括号
 *
 * 算法说明：
 * 1. 使用括号计数器，遇到 ( 加1，遇到 ) 减1
 * 2. 当计数器归零时，找到了匹配的闭括号
 * 3. 重要：忽略引号内的括号，避免字符串内容干扰匹配
 *
 * @param str 要搜索的字符串
 * @param startPos 开始括号的位置
 * @returns 匹配的闭括号位置，如果找不到返回 -1
 */
function findMatchingCloseParen(str: string, startPos: number): number {
    let parenCount = 1; // 从1开始，因为已经有一个开括号
    let inQuote = false;
    let quoteChar = '';

    for (let i = startPos; i < str.length; i++) {
        const char = str[i];
        const prevChar = i > 0 ? str[i - 1] : '';

        // 处理引号状态
        // 支持三种引号：双引号、单引号和反引号（模板字符串）
        // 注意：需要检查前一个字符不是反斜杠，以正确处理转义的引号
        if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
            if (!inQuote) {
                inQuote = true;
                quoteChar = char;
            } else if (char === quoteChar) {
                inQuote = false;
            }
        }

        // 只在不在引号内时计算括号
        // 这确保了像 "text with )" 这样的字符串不会影响括号匹配
        if (!inQuote) {
            if (char === '(') {
                parenCount++;
            } else if (char === ')') {
                parenCount--;
                if (parenCount === 0) {
                    return i;
                }
            }
        }
    }

    return -1; // 没有找到匹配的闭括号
}

// 解析参数字符串，处理嵌套结构
// 增加了对圆括号的层级计数。
export function parseParameters(paramsString: string): string[] {
    const params: string[] = [];
    let currentParam = '';
    let inQuote = false;
    let quoteChar = '';
    let bracketCount = 0;
    let braceCount = 0;
    let parenCount = 0;

    for (let i = 0; i < paramsString.length; i++) {
        const char = paramsString[i];

        // 处理引号（包括反引号）
        if (
            (char === '"' || char === "'" || char === '`') &&
            (i === 0 || paramsString[i - 1] !== '\\')
        ) {
            if (!inQuote) {
                inQuote = true;
                quoteChar = char;
            } else if (char === quoteChar) {
                inQuote = false;
            }
        }

        if (!inQuote) {
            // 处理圆括号 (函数调用、数学运算等)
            if (char === '(') parenCount++;
            if (char === ')') parenCount--;

            // 处理方括号 (数组)
            if (char === '[') bracketCount++;
            if (char === ']') bracketCount--;

            // 处理花括号 (对象)
            if (char === '{') braceCount++;
            if (char === '}') braceCount--;
        }
        // 处理参数分隔符
        // 现在只有当所有括号都匹配闭合时，逗号才被视为分隔符
        if (
            char === ',' &&
            !inQuote &&
            parenCount === 0 &&
            bracketCount === 0 &&
            braceCount === 0
        ) {
            params.push(currentParam.trim());
            currentParam = '';
            continue;
        }

        currentParam += char;
    }

    // 添加最后一个参数
    if (currentParam.trim()) {
        params.push(currentParam.trim());
    }

    return params;
}

export async function getLastValidVariable(message_id: number): Promise<MvuData> {
    return (klona(
        _(SillyTavern.chat)
            .slice(0, message_id + 1)
            .map(chat_message => _.get(chat_message, ['variables', chat_message.swipe_id ?? 0]))
            .findLast(variables => _.has(variables, 'stat_data'))

        //@ts-expect-error old fn
    ) ?? getVariables()) as MvuData;
}

export function pathFix(path: string): string {
    if (!path) return path;

    // 1. 处理 [] 内的内容，区分数字索引 / 字符串 key
    const fixedBrackets = path.replace(/\[([^\]]*)\]/g, (_match, rawInner: string) => {
        let inner = rawInner.trim();
        if (!inner) {
            return '[]';
        }

        let wasQuoted = false;
        const first = inner[0];
        const last = inner[inner.length - 1];

        if (inner.length >= 2 && (first === '"' || first === "'") && first === last) {
            wasQuoted = true;
            inner = inner.slice(1, -1);
        }

        const isPureDigits = /^\d+$/.test(inner);
        const hasWhitespace = /\s/.test(inner);

        // 纯数字
        if (isPureDigits) {
            if (!wasQuoted) {
                // 裸数字 → 视为数组索引
                return `[${inner}]`;
            } else {
                // 有引号的数字 → 视为字符串 key
                const escaped = inner.replace(/"/g, '\\"');
                return `["${escaped}"]`;
            }
        }

        // 非纯数字 → 字符串 key
        if (hasWhitespace) {
            const escaped = inner.replace(/"/g, '\\"');
            return `["${escaped}"]`;
        } else {
            return `[${inner}]`;
        }
    });

    // 2. 处理点分段中被整体引号包裹的字段
    //
    // 规则：
    //   - 无空白 / . / [] → 简单字段，去引号： ["武器栏"] → [武器栏]
    //   - 含空白或特殊字符 → 复杂字段，改写为 bracket：
    //       foo."a b".c    → foo["a b"].c
    //       root.'字段 名'.子 → root["字段 名"].子
    //       foo[喵.呜].c    →  foo["喵.呜"].c
    const fixedDots = fixedBrackets.replace(
        /(^|\.)(["'])([^"']*)\2(?=\.|\[|$)/g,
        (_match, prefix: string, _quote: string, name: string) => {
            const hasWhitespace = /\s/.test(name);
            const hasSpecial = /[.[\]]/.test(name);

            if (!hasWhitespace && !hasSpecial) {
                // 简单标识符：保留点
                // 例如 foo."武器栏" → foo.武器栏
                return prefix + name;
            } else {
                // 复杂字段：改成 bracket 形式，并去掉多余的点
                const escaped = name.replace(/"/g, '\\"');
                if (prefix === '.') {
                    // foo."a b" → foo["a b"]
                    return `["${escaped}"]`;
                } else {
                    // 行首的情况："字段 名".子 → ["字段 名"].子
                    return `${prefix}["${escaped}"]`;
                }
            }
        }
    );

    return fixedDots;
}

/**
 * MVU 风格的变量更新操作，同时会更新 display_data/delta_data
 * @param stat_data 当前的变量状态，来源应当是 mag_variable_updated 回调中提供的 stat_data。其他来源则不会修改 display_data 等。
 * @param path 要更改的变量路径
 * @param new_value 新值
 * @param reason 修改原因（可选，默认为空）
 * @param is_recursive 此次修改是否允许触发 mag_variable_updated 回调（默认不允许）
 */
export async function updateVariable(
    stat_data: Record<string, any>,
    path: string,
    new_value: any,
    reason: string = '',
    is_recursive: boolean = false
): Promise<boolean> {
    const display_data = stat_data.$internal?.display_data;
    const delta_data = stat_data.$internal?.delta_data;
    if (_.has(stat_data, path)) {
        const currentValue = _.get(stat_data, path);
        if (Array.isArray(currentValue) && currentValue.length === 2) {
            //VWD 处理
            const oldValue = klona(currentValue[0]);
            currentValue[0] = new_value;
            _.set(stat_data, path, currentValue);
            const reason_str = reason ? `(${reason})` : '';
            const display_str = `${trimQuotesAndBackslashes(JSON.stringify(oldValue))}->${trimQuotesAndBackslashes(JSON.stringify(new_value))} ${reason_str}`;
            if (display_data) _.set(display_data, path, display_str);
            if (delta_data) _.set(delta_data, path, display_str);
            console.info(
                `Set '${path}' to '${trimQuotesAndBackslashes(JSON.stringify(new_value))}' ${reason_str}`
            );
            if (is_recursive)
                await eventEmit(
                    variable_events.SINGLE_VARIABLE_UPDATED,
                    stat_data,
                    path,
                    oldValue,
                    new_value
                );
            return true;
        } else {
            const oldValue = klona(currentValue);
            _.set(stat_data, path, new_value);
            const reason_str = reason ? `(${reason})` : '';
            const stringNewValue = trimQuotesAndBackslashes(JSON.stringify(new_value));
            const display_str = `${trimQuotesAndBackslashes(JSON.stringify(oldValue))}->${stringNewValue} ${reason_str}`;
            if (display_data) _.set(display_data, path, display_str);
            if (delta_data) _.set(delta_data, path, display_str);
            console.info(`Set '${path}' to '${stringNewValue}' ${reason_str}`);
            if (is_recursive)
                await eventEmit(
                    variable_events.SINGLE_VARIABLE_UPDATED,
                    stat_data,
                    path,
                    oldValue,
                    new_value
                );
            return true;
        }
    }
    return false;
}

type ErrorInfo = {
    error_last: string;
    error_command: Command;
};

export function pathFixPass(
    _unused_data: MvuData,
    commands: Command[],
    _unused_content: string
): void {
    for (const command of commands) {
        command.args[0] = pathFix(trimQuotesAndBackslashes(command.args[0]));
    }
}

function isNullOrWhiteSpace(str: string): boolean {
    return str == null || str.trim().length === 0;
}

// 重构 updateVariables 以处理更多命令
export async function updateVariables(
    current_message_content: string,
    variables: MvuData
): Promise<boolean> {
    const out_is_modifed = false;

    // 拷贝一份变量，用于提供给 variable_ended
    const variables_before_update: MvuData = klona(variables);
    // 深拷贝变量对象，生成状态快照，用于记录显示数据
    const out_status: MvuData = klona(variables);
    // 初始化增量状态对象，记录变化详情
    const delta_status: Partial<MvuData> = { stat_data: {} };

    // 重构新增：统一处理宏替换，确保命令中的宏（如 ${variable}）被替换，提升一致性
    const processed_message_content = substitudeMacros(current_message_content);

    // 使用重构后的 extractCommands 提取所有命令
    const commands = extractCommands(processed_message_content);

    // 触发变量更新开始事件，通知外部系统
    _.set(variables.stat_data, '$internal', {
        display_data: out_status.stat_data,
        delta_data: delta_status.stat_data || {},
    });
    //@ts-expect-error 这里会有一个variables类型的不一致，一个内部类型，一个外部类型。
    await eventEmit(variable_events.VARIABLE_UPDATE_STARTED, variables);
    let variable_modified = false;

    let error_info: ErrorInfo | undefined;
    let current_command: Command | undefined;
    const outError = function (message: string) {
        console.warn(message);
        error_info = {
            error_last: message,
            error_command: current_command!,
        };
    };

    const schema = variables.schema; // 获取 schema，可能为 undefined
    const strict_template = schema?.strictTemplate ?? false;
    const concat_template_array = schema?.concatTemplateArray ?? true;
    const strict_set = schema?.strictSet ?? false;

    //处理别名
    for (const cmd of commands) {
        if (cmd.type === 'remove') {
            cmd.type = 'delete';
        } else if (cmd.type === 'assign') {
            cmd.type = 'insert';
        } else if (cmd.type === 'unset') {
            cmd.type = 'delete';
        }
    }

    //@ts-expect-error old fn
    await eventEmit(variable_events.COMMAND_PARSED, variables, commands, current_message_content);

    pathFixPass(variables, commands, current_message_content);

    for (const command of commands) {
        // 遍历所有命令，逐一处理
        // 修正路径格式，去除首尾引号和反斜杠，确保路径有效
        const path = command.args[0];
        // 生成原因字符串，用于日志和显示
        const reason_str = command.reason ? `(${command.reason})` : '';
        let display_str = ''; // 初始化显示字符串，记录操作详情
        current_command = command;

        switch (
            command.type // 根据命令类型执行不同操作
        ) {
            case 'set': {
                // _.has 检查，确保路径存在
                if (path !== '' && !_.has(variables.stat_data, path)) {
                    outError(
                        `Path '${path}' does not exist in stat_data, skipping set command ${reason_str}`
                    );
                    continue;
                }

                // 获取路径上的旧值，可能为 undefined（路径不存在）
                let oldValue =
                    path === '' ? klona(variables.stat_data) : _.get(variables.stat_data, path);

                // 支持两种格式：_.set(path, newValue) 或 _.set(path, oldValue, newValue)
                //   解析新值，支持字符串、数字、布尔值、JSON 对象等
                let newValue = parseCommandValue(command.args.at(-1)!);

                // 在写入前，将 Date 对象序列化为 ISO 字符串
                if (newValue instanceof Date) {
                    newValue = newValue.toISOString();
                }
                let isPathVWD = false;

                if (
                    !strict_set &&
                    Array.isArray(oldValue) &&
                    oldValue.length === 2 &&
                    typeof oldValue[1] === 'string' &&
                    !Array.isArray(oldValue[0])
                ) {
                    // 处理 ValueWithDescription<T> 类型，更新数组第一个元素
                    // 仅当旧值为数字且新值不为 null 时，才强制转换为数字
                    // 这允许将数字字段设置为 null (例如角色死亡后好感度变为 null)
                    const oldValueCopy = klona(oldValue[0]);
                    oldValue[0] =
                        typeof oldValue[0] === 'number' && newValue !== null
                            ? Number(newValue)
                            : newValue;
                    oldValue = oldValueCopy;
                    isPathVWD = true;
                } else if (
                    typeof oldValue === 'number' &&
                    newValue !== null &&
                    typeof newValue === 'string'
                ) {
                    _.set(variables.stat_data, path, Number(newValue));
                } else if (path) {
                    _.set(variables.stat_data, path, newValue);
                } else {
                    variables.stat_data = newValue;
                }

                // 获取最终设置的新值，用于日志和事件
                let finalNewValue =
                    path === '' ? variables.stat_data : _.get(variables.stat_data, path);

                assertVWD(isPathVWD, finalNewValue);

                if (isPathVWD) {
                    finalNewValue = finalNewValue[0];
                }

                // 检查是否为 ValueWithDescription 类型，以优化显示
                const isStrict = !strict_set;

                if (
                    isStrict &&
                    isValueWithDescriptionStatData(oldValue) &&
                    Array.isArray(finalNewValue)
                ) {
                    // 如果是 ValueWithDescription，只显示值的变化
                    display_str = `${trimQuotesAndBackslashes(JSON.stringify(oldValue[0]))}->${trimQuotesAndBackslashes(JSON.stringify(finalNewValue[0]))} ${reason_str}`;
                } else {
                    // 否则，按常规显示
                    display_str = `${trimQuotesAndBackslashes(JSON.stringify(oldValue))}->${trimQuotesAndBackslashes(JSON.stringify(finalNewValue))} ${reason_str}`;
                }

                variable_modified = true; // 标记变量已修改
                // 记录操作日志，便于调试
                console.info(`Set '${path}' to '${JSON.stringify(finalNewValue)}' ${reason_str}`);

                // 触发单变量更新事件，通知外部系统
                await eventEmit(
                    variable_events.SINGLE_VARIABLE_UPDATED,
                    variables.stat_data,
                    path,
                    oldValue,
                    finalNewValue
                );
                break;
            }

            case 'insert':
            case 'assign': {
                // 检查目标路径是否指向一个集合（数组或对象）
                // 如果路径已存在且其值为原始类型（字符串、数字等），则跳过此命令，以防止结构污染
                const targetPath = path;
                // 统一获取目标值和目标Schema，优雅地处理根路径
                const existingValue =
                    targetPath === ''
                        ? variables.stat_data
                        : _.get(variables.stat_data, targetPath);
                const targetSchema = getSchemaForPath(schema, targetPath);

                // 验证1：目标是否为原始类型？如果是，则无法插入。
                if (
                    existingValue !== null &&
                    !Array.isArray(existingValue) &&
                    !_.isObject(existingValue)
                ) {
                    outError(
                        `Cannot assign into path '${targetPath}' because it holds a primitive value (${typeof existingValue}). Operation skipped. ${reason_str}`
                    );
                    continue;
                }

                // 验证2：Schema 规则
                if (targetSchema) {
                    if (targetSchema.type === 'object' && targetSchema.extensible === false) {
                        if (command.args.length === 2) {
                            // 合并
                            outError(
                                `SCHEMA VIOLATION: Cannot merge data into non-extensible object at path '${targetPath}'. ${reason_str}`
                            );
                            continue;
                        }
                        if (command.args.length >= 3) {
                            // 插入键
                            const newKey = String(parseCommandValue(command.args[1]));
                            if (!_.has(targetSchema.properties, newKey)) {
                                outError(
                                    `SCHEMA VIOLATION: Cannot assign new key '${newKey}' into non-extensible object at path '${targetPath}'. ${reason_str}`
                                );
                                continue;
                            }
                        }
                    } else if (
                        targetSchema.type === 'array' &&
                        (targetSchema.extensible === false || targetSchema.extensible === undefined)
                    ) {
                        outError(
                            `SCHEMA VIOLATION: Cannot assign elements into non-extensible array at path '${targetPath}'. ${reason_str}`
                        );
                        continue;
                    }
                } else if (
                    // 增加 targetPath !== '' 条件，防止对根路径进行父路径检查
                    targetPath !== '' &&
                    !_.get(variables.stat_data, _.toPath(targetPath).slice(0, -1).join('.'))
                ) {
                    // 验证3：如果要插入到新路径，确保其父路径存在且可扩展
                    outError(
                        `Cannot assign into non-existent path '${targetPath}' without an extensible parent. ${reason_str}`
                    );
                    continue;
                }
                // --- 所有验证通过，现在可以安全执行 ---

                // 深拷贝旧值，防止直接修改影响后续比较
                const oldValue = klona(existingValue);
                let successful = false; // 标记插入是否成功

                if (command.args.length === 2) {
                    // _.assign('path.to.array', value)
                    // 解析插入值，支持复杂类型
                    let valueToAssign = parseCommandValue(command.args[1]);

                    // 在写入前，将 Date 对象（或数组中的Date）序列化
                    if (valueToAssign instanceof Date) {
                        valueToAssign = valueToAssign.toISOString();
                    } else if (Array.isArray(valueToAssign)) {
                        valueToAssign = valueToAssign.map(item =>
                            item instanceof Date ? item.toISOString() : item
                        );
                    }

                    // 获取目标集合，可能为数组或对象
                    let collection =
                        targetPath === '' ? variables.stat_data : _.get(variables.stat_data, path);

                    // 如果目标不存在，初始化为空数组或对象
                    if (!Array.isArray(collection) && !_.isObject(collection)) {
                        collection = Array.isArray(valueToAssign) ? [] : {};
                        _.set(variables.stat_data, path, collection);
                    }

                    if (Array.isArray(collection)) {
                        // 目标是数组，追加元素
                        // 检查是否有模板并应用
                        const template =
                            targetSchema && isArraySchema(targetSchema)
                                ? targetSchema.template
                                : undefined;
                        valueToAssign = applyTemplate(
                            valueToAssign,
                            template,
                            strict_template,
                            concat_template_array
                        );
                        collection.push(valueToAssign);
                        display_str = `ASSIGNED ${JSON.stringify(valueToAssign)} into array '${path}' ${reason_str}`;
                        successful = true;
                    } else if (_.isObject(collection)) {
                        // 目标是对象，合并属性
                        // 注意：对象合并时不应用模板，因为无法明确确定增加的元素
                        // 模板只在明确添加单个新属性时应用（如使用三参数的 assign）
                        if (_.isObject(valueToAssign) && !Array.isArray(valueToAssign)) {
                            _.merge(collection, valueToAssign);
                            display_str = `MERGED object ${JSON.stringify(valueToAssign)} into object '${path}' ${reason_str}`;
                            successful = true;
                        } else {
                            // 不支持将数组或非对象合并到对象，记录错误
                            outError(
                                `Cannot merge ${Array.isArray(valueToAssign) ? 'array' : 'non-object'} into object at '${path}'`
                            );
                            continue;
                        }
                    }
                } else if (command.args.length >= 3) {
                    // _.assign('path', key/index, value)
                    // 解析插入值和键/索引
                    let valueToAssign = parseCommandValue(command.args[2]);
                    const keyOrIndex = parseCommandValue(command.args[1]);

                    // 在写入前，将 Date 对象（或数组中的Date）序列化
                    if (valueToAssign instanceof Date) {
                        valueToAssign = valueToAssign.toISOString();
                    } else if (Array.isArray(valueToAssign)) {
                        valueToAssign = valueToAssign.map(item =>
                            item instanceof Date ? item.toISOString() : item
                        );
                    }

                    let collection =
                        targetPath === '' ? variables.stat_data : _.get(variables.stat_data, path);

                    // 获取模板
                    const template =
                        targetSchema &&
                        (isArraySchema(targetSchema) || isObjectSchema(targetSchema))
                            ? targetSchema.template
                            : undefined;

                    if (Array.isArray(collection) && typeof keyOrIndex === 'number') {
                        // 目标是数组且索引是数字，插入到指定位置
                        valueToAssign = applyTemplate(
                            valueToAssign,
                            template,
                            strict_template,
                            concat_template_array
                        );
                        collection.splice(keyOrIndex, 0, valueToAssign);
                        display_str = `ASSIGNED ${JSON.stringify(valueToAssign)} into '${path}' at index ${keyOrIndex} ${reason_str}`;
                        successful = true;
                    } else if (_.isObject(collection)) {
                        // 目标是对象，设置指定键
                        // _.set(collection, String(keyOrIndex), valueToAssign);
                        // 对单个属性值应用模板
                        valueToAssign = applyTemplate(
                            valueToAssign,
                            template,
                            strict_template,
                            concat_template_array
                        );
                        (collection as Record<string, unknown>)[String(keyOrIndex)] = valueToAssign;
                        display_str = `ASSIGNED key '${keyOrIndex}' with value ${JSON.stringify(valueToAssign)} into object '${path}' ${reason_str}`;
                        successful = true;
                    } else {
                        // 目标不存在，创建新对象并插入
                        collection = {};
                        _.set(variables.stat_data, path, collection);
                        /*
                        _.set(
                            collection as Record<string, unknown>,
                            String(keyOrIndex),
                            valueToAssign
                        );
                        */
                        // 对新属性值应用模板
                        valueToAssign = applyTemplate(
                            valueToAssign,
                            template,
                            strict_template,
                            concat_template_array
                        );
                        (collection as Record<string, unknown>)[String(keyOrIndex)] = valueToAssign;
                        display_str = `CREATED object at '${path}' and ASSIGNED key '${keyOrIndex}' ${reason_str}`;
                        successful = true;
                    }
                }

                if (successful) {
                    // 插入成功，获取新值并触发事件
                    const newValue = isNullOrWhiteSpace(path)
                        ? variables.stat_data
                        : _.get(variables.stat_data, path);
                    variable_modified = true;
                    console.info(display_str);
                    await eventEmit(
                        variable_events.SINGLE_VARIABLE_UPDATED,
                        variables.stat_data,
                        path,
                        oldValue,
                        newValue
                    );
                    try {
                        //对新应用的 template 立刻处理模板。
                        const currentDataClone = klona(newValue);

                        const newSchema = generateSchema(currentDataClone, targetSchema!);
                        _.merge(targetSchema, newSchema);
                        cleanUpMetadata(newValue);
                    } catch (error) {
                        // 应用失败，记录错误并继续处理下一命令
                        if (error instanceof Error) {
                            outError(
                                `Failed to resolve template meta at '${path}', '${error.message}'`
                            );
                        } else {
                            outError(`Failed to resolve template meta at '${path}', '${error}'`);
                        }
                    }
                } else {
                    // 插入失败，记录错误并继续处理下一命令
                    outError(`Invalid arguments for _.assign on path '${path}'`);
                    continue;
                }
                break;
            }

            case 'unset':
            case 'delete':
            case 'remove': {
                // --- handle array element removal correctly ---
                const pathParts = _.toPath(path);
                const lastPart = pathParts[pathParts.length - 1];
                const isArrayElementPath = /^\d+$/.test(lastPart);

                if (command.args.length === 1 && isArrayElementPath) {
                    const containerPath = pathParts.slice(0, -1).join('.');
                    //根对象必不是一个数组，在下面 isArray 部分会失败
                    const container = _.get(variables.stat_data, containerPath);
                    const indexToRemove = parseInt(lastPart, 10);

                    if (Array.isArray(container) && indexToRemove < container.length) {
                        const originalArray = klona(container);
                        container.splice(indexToRemove, 1);
                        variable_modified = true;
                        display_str = `REMOVED item from '${containerPath}' at index ${indexToRemove} ${reason_str}`;
                        console.info(display_str);
                        await eventEmit(
                            variable_events.SINGLE_VARIABLE_UPDATED,
                            variables.stat_data,
                            containerPath,
                            originalArray,
                            container
                        );
                        continue; // Skip to next command
                    }
                }

                // 验证路径存在，防止无效删除
                // 不允许 _.remove('', 'val');
                if (!_.has(variables.stat_data, path)) {
                    outError(`undefined Path: ${path} in _.remove command`);
                    continue;
                }

                // --- 模式校验开始 ---
                let containerPath = path;
                let keyOrIndexToRemove: string | number | undefined;

                if (command.args.length > 1) {
                    // _.remove('path', key_or_index)
                    keyOrIndexToRemove = parseCommandValue(command.args[1]);
                    // 如果 key 是字符串，需要去除可能存在的引号
                    if (typeof keyOrIndexToRemove === 'string') {
                        keyOrIndexToRemove = trimQuotesAndBackslashes(keyOrIndexToRemove);
                    }
                } else {
                    // _.remove('path.to.key[index]')
                    const pathParts = _.toPath(path);
                    const lastPart = pathParts.pop();
                    if (lastPart) {
                        keyOrIndexToRemove = /^\d+$/.test(lastPart) ? Number(lastPart) : lastPart;
                        containerPath = pathParts.join('.');
                    }
                }

                if (keyOrIndexToRemove === undefined) {
                    outError(
                        `Could not determine target for deletion for command on path '${path}' ${reason_str}`
                    );
                    continue;
                }
                // 只有当容器路径不是根路径（即不为空）时，才检查其是否存在
                if (containerPath !== '' && !_.has(variables.stat_data, containerPath)) {
                    outError(
                        `Cannot remove from non-existent path '${containerPath}'. ${reason_str}`
                    );
                    continue;
                }

                const containerSchema = getSchemaForPath(schema, containerPath);

                if (containerSchema) {
                    if (containerSchema.type === 'array') {
                        if (containerSchema.extensible !== true) {
                            outError(
                                `SCHEMA VIOLATION: Cannot remove element from non-extensible array at path '${containerPath}'. ${reason_str}`
                            );
                            continue;
                        }
                    } else if (containerSchema.type === 'object') {
                        const keyString = String(keyOrIndexToRemove);
                        if (
                            _.has(containerSchema.properties, keyString) &&
                            containerSchema.properties[keyString].required === true
                        ) {
                            outError(
                                `SCHEMA VIOLATION: Cannot remove required key '${keyString}' from path '${containerPath}'. ${reason_str}`
                            );
                            continue;
                        }
                    }
                }

                // --- 所有验证通过，现在可以安全执行 ---

                // 解析删除目标，可能是值或索引
                const targetToRemove =
                    command.args.length > 1 ? parseCommandValue(command.args[1]) : undefined;
                let itemRemoved = false; // 标记是否删除成功

                if (targetToRemove === undefined) {
                    // _.remove('path.to.key')
                    // 删除整个路径
                    const oldValue = _.get(variables.stat_data, path);
                    _.unset(variables.stat_data, path);
                    display_str = `REMOVED path '${path}' ${reason_str}`;
                    itemRemoved = true;
                    await eventEmit(
                        variable_events.SINGLE_VARIABLE_UPDATED,
                        variables.stat_data,
                        path,
                        oldValue,
                        undefined
                    );
                } else {
                    // _.remove('path.to.array', value_or_index)
                    const collection = _.get(variables.stat_data, path);

                    // 当从一个集合中删除元素时，必须确保目标路径确实是一个集合
                    // 如果目标是原始值（例如字符串），则无法执行删除操作
                    if (!Array.isArray(collection) && !_.isObject(collection)) {
                        outError(
                            `Cannot remove from path '${path}' because it is not an array or object. Skipping command. ${reason_str}`
                        );
                        continue;
                    }

                    if (Array.isArray(collection)) {
                        // 目标是数组，删除指定元素
                        const originalArray = klona(collection);
                        let indexToRemove = -1;
                        if (typeof targetToRemove === 'number') {
                            indexToRemove = targetToRemove;
                        } else {
                            indexToRemove = collection.findIndex(item =>
                                _.isEqual(item, targetToRemove)
                            );
                        }

                        if (indexToRemove >= 0 && indexToRemove < collection.length) {
                            collection.splice(indexToRemove, 1);
                            itemRemoved = true;
                            display_str = `REMOVED item from '${path}' ${reason_str}`;
                            await eventEmit(
                                variable_events.SINGLE_VARIABLE_UPDATED,
                                variables.stat_data,
                                path,
                                originalArray,
                                collection
                            );
                        }
                    } else if (_.isObject(collection)) {
                        if (typeof targetToRemove === 'number') {
                            // 目标是对象，按索引删除键
                            const keys = Object.keys(collection);
                            const index = targetToRemove;
                            if (index >= 0 && index < keys.length) {
                                const keyToRemove = keys[index];
                                _.unset(collection, keyToRemove);
                                itemRemoved = true;
                                display_str = `REMOVED ${index + 1}th entry ('${keyToRemove}') from object '${path}' ${reason_str}`;
                            }
                        } else {
                            // 目标是对象，按键名删除
                            const keyToRemove = String(targetToRemove);
                            if (_.has(collection, keyToRemove)) {
                                // _.unset(collection, keyToRemove);
                                delete (collection as Record<string, unknown>)[keyToRemove];
                                itemRemoved = true;
                                display_str = `REMOVED key '${keyToRemove}' from object '${path}' ${reason_str}`;
                            }
                        }
                    }
                }

                if (itemRemoved) {
                    // 删除成功，更新状态并记录日志
                    variable_modified = true;
                    console.info(display_str);
                } else {
                    // 删除失败，记录警告并继续
                    outError(`Failed to execute remove on '${path}'`);
                    continue;
                }
                break;
            }

            case 'add': {
                // 验证路径存在
                if (!_.has(variables.stat_data, path)) {
                    outError(
                        `Path '${path}' does not exist in stat_data, skipping add command ${reason_str}`
                    );
                    continue;
                }
                // 获取当前值
                const initialValue = klona(_.get(variables.stat_data, path));
                const oldValue = _.get(variables.stat_data, path);
                let valueToAdd = oldValue;
                const isVWD =
                    isValueWithDescriptionStatData(oldValue) && typeof oldValue[0] !== 'object';

                if (isVWD) {
                    assertVWD(isVWD, oldValue);
                    valueToAdd = oldValue[0]; // 对 ValueWithDescription 类型，操作其第一个元素
                }
                // console.warn(valueToAdd);

                // 尝试将当前值解析为 Date 对象，无论其原始类型是 Date 还是字符串
                let potentialDate: Date | null = null;
                if (valueToAdd instanceof Date) {
                    potentialDate = valueToAdd;
                } else if (typeof valueToAdd === 'string') {
                    const parsedDate = new Date(valueToAdd);
                    // 确保它是一个有效的日期，并且不是一个可以被 `new Date` 解析的纯数字字符串
                    if (!isNaN(parsedDate.getTime()) && isNaN(Number(valueToAdd))) {
                        potentialDate = parsedDate;
                    }
                }

                if (command.args.length === 2) {
                    // 双参数：调整数值或日期
                    const delta = parseCommandValue(command.args[1]);

                    // 处理 Date 类型
                    if (potentialDate) {
                        if (typeof delta !== 'number') {
                            outError(
                                `Delta '${command.args[1]}' for Date operation is not a number, skipping add command ${reason_str}`
                            );
                            continue;
                        }
                        // delta 是毫秒数，更新时间
                        const newDate = new Date(potentialDate.getTime() + delta);
                        // 总是将更新后的 Date 对象转换为 ISO 字符串再存回去
                        const finalValueToSet = newDate.toISOString();

                        if (isVWD) {
                            assertVWD(isVWD, oldValue);
                            oldValue[0] = finalValueToSet;
                            _.set(variables.stat_data, path, oldValue);
                        } else {
                            _.set(variables.stat_data, path, finalValueToSet);
                        }

                        const finalNewValue = _.get(variables.stat_data, path);
                        if (isVWD) {
                            display_str = `${JSON.stringify((initialValue as any[])[0])}->${JSON.stringify((finalNewValue as any[])[0])} ${reason_str}`;
                        } else {
                            display_str = `${JSON.stringify(initialValue)}->${JSON.stringify(finalNewValue)} ${reason_str}`;
                        }
                        variable_modified = true;
                        console.info(
                            `ADDED date '${path}' from '${potentialDate.toISOString()}' to '${newDate.toISOString()}' by delta '${delta}'ms ${reason_str}`
                        );
                        await eventEmit(
                            variable_events.SINGLE_VARIABLE_UPDATED,
                            variables.stat_data,
                            path,
                            initialValue,
                            finalNewValue
                        );
                    } else if (typeof valueToAdd === 'number') {
                        // 原有的处理 number 类型的逻辑
                        if (typeof delta !== 'number') {
                            outError(
                                `Delta '${command.args[1]}' is not a number, skipping add command ${reason_str}`
                            );
                            continue;
                        }
                        let newValue = valueToAdd + delta;
                        newValue = parseFloat(newValue.toPrecision(12)); // 避免浮点数精度误差
                        if (isVWD) {
                            oldValue[0] = newValue; // Update the first element
                            _.set(variables.stat_data, path, oldValue);
                        } else {
                            _.set(variables.stat_data, path, newValue);
                        }
                        const finalNewValue = _.get(variables.stat_data, path);
                        if (isVWD) {
                            display_str = `${JSON.stringify((initialValue as any[])[0])}->${JSON.stringify((finalNewValue as any[])[0])} ${reason_str}`;
                        } else {
                            display_str = `${JSON.stringify(initialValue)}->${JSON.stringify(finalNewValue)} ${reason_str}`;
                        }
                        variable_modified = true;
                        console.info(
                            `ADDED number '${path}' from '${valueToAdd}' to '${newValue}' by delta '${delta}' ${reason_str}`
                        );
                        await eventEmit(
                            variable_events.SINGLE_VARIABLE_UPDATED,
                            variables.stat_data,
                            path,
                            initialValue,
                            finalNewValue
                        );
                    } else {
                        // 如果值不是可识别的类型（日期、数字），则跳过
                        outError(
                            `Path '${path}' value is not a date or number; skipping add command ${reason_str}`
                        );
                        continue;
                    }
                } else {
                    outError(
                        `Invalid number of arguments for _.add on path '${path}' ${reason_str}`
                    );
                    continue;
                }
                break;
            }
        }

        if (display_str) {
            // 更新状态和增量数据，记录操作详情
            _.set(out_status.stat_data, path, display_str);
            _.set(delta_status.stat_data!, path, display_str);
        }
    }
    // 更新变量的显示和增量数据
    variables.display_data = out_status.stat_data;
    variables.delta_data = delta_status.stat_data!;
    // 触发变量更新结束事件
    //@ts-expect-error 这里会有一个variables类型的不一致，一个内部类型，一个外部类型。
    await eventEmit(variable_events.VARIABLE_UPDATE_ENDED, variables, variables_before_update);
    //在结束事件中也可能设置变量
    _.unset(variables.stat_data, '$internal');

    // 在所有命令执行完毕后，如果数据有任何变动，则执行一次 Schema 调和
    if (variable_modified) {
        reconcileAndApplySchema(variables);
    }
    if (error_info && useSettingsStore().settings.通知.变量更新出错) {
        const base_command: string = error_info.error_command.full_match;
        if (typeof toastr !== 'undefined')
            toastr.warning(
                `最近错误: ${error_info.error_last}`,
                `[MVU]发生变量更新错误，可能需要重Roll: ${base_command}`,
                { timeOut: 6000 }
            );
    }

    // 返回是否修改了变量
    return variable_modified || out_is_modifed;
}

export async function handleVariablesInMessage(message_id: number) {
    const chat_message = getChatMessages(message_id).at(-1);
    if (!chat_message) {
        return;
    }

    let message_content = chat_message.message;

    if (chat_message.role === 'assistant' && message_content.length < 5) {
        return;
    }
    const request_message_id = message_id === 0 ? 0 : message_id - 1;
    const variables = await getLastValidVariable(request_message_id);
    const settings = useSettingsStore().settings;
    if (!_.has(variables, 'stat_data')) {
        console.error(`cannot found stat_data for ${request_message_id}`);
        return;
    }

    const has_variable_modified = await updateVariables(message_content, variables);
    if (has_variable_modified && chat_message.role !== 'user') {
        const context: UpdateContext = {
            variables: variables,
            message_content: message_content,
        };
        await eventEmit(variable_events.BEFORE_MESSAGE_UPDATE, context);
        message_content = context.message_content;
    }
    const updater = (data: Record<string, any>) => {
        data.initialized_lorebooks = variables.initialized_lorebooks;
        data.stat_data = variables.stat_data;
        if (variables.schema !== undefined) {
            data.schema = variables.schema;
        } else {
            _.unset(data, 'schema');
        }
        data.display_data = variables.display_data;
        data.delta_data = variables.delta_data;
        return data;
    };
    if (has_variable_modified && settings.更新到聊天变量 === true) {
        await updateVariablesWith(updater, { type: 'chat' });
    }
    await updateVariablesWith(updater, { type: 'message', message_id: message_id });

    if (chat_message.role !== 'user') {
        if (!message_content.includes('<StatusPlaceHolderImpl/>')) {
            message_content += '\n\n<StatusPlaceHolderImpl/>';
        }
        await setChatMessages(
            [
                {
                    message_id: message_id,
                    message: message_content,
                },
            ],
            {
                refresh: 'affected',
            }
        );
    }
}

export async function handleVariablesInCallback(
    message_content: string,
    in_out_variable_info: VariableData
) {
    if (in_out_variable_info.old_variables === undefined) {
        return;
    }
    in_out_variable_info.new_variables = klona(in_out_variable_info.old_variables);
    const variables = in_out_variable_info.new_variables;

    const modified = await updateVariables(message_content, variables);
    //如果没有修改，则不产生 newVariable
    if (!modified) {
        _.unset(in_out_variable_info, 'new_variables');
    }
    return;
}

/** 清理 `[start_message_id, end_message_id]` 内, 楼层号不为 `snap_interval` 倍数的楼层变量 */
export function cleanupVariablesInMessages(
    start_message_id: number,
    end_message_id: number,
    snap_interval: number
) {
    let counter = 0;
    _(SillyTavern.chat)
        .slice(start_message_id, end_message_id + 1)
        .forEach((chat_message, msg_index) => {
            if (chat_message.variables === undefined) {
                return;
            }
            //每个楼层只在counter 中统计一次。
            let chat_flag = false;
            chat_message.variables = _.range(0, chat_message.swipes?.length ?? 1).map(i => {
                if (chat_message?.variables?.[i] === undefined) {
                    return {};
                }
                if (_.get(chat_message?.variables?.[i], 'snapshot') === true) {
                    return chat_message.variables[i];
                }
                if ((start_message_id + msg_index) % snap_interval === 0) {
                    //需要对已经忽略的snapshot 楼层进行标记
                    //原因是考虑到用户会修改楼层间隔，比如从 50-> 70 ，因为最小公倍数的原因，会导致之前的楼层实质上 350 层一个快照，有较大风险
                    _.set(chat_message, ['variables', i, 'snapshot'], true);
                    return chat_message.variables[i];
                }
                if (!chat_flag) {
                    chat_flag = true;
                    ++counter;
                }
                return _.omit(
                    chat_message.variables[i],
                    `initialized_lorebooks`,
                    `stat_data`,
                    `display_data`,
                    `delta_data`,
                    `schema`
                );
            });
        });
    saveChatDebounced();
    return counter;
}
