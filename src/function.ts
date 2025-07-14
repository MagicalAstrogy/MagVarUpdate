import {variable_events, VariableData, ProcessingError, ErrorType} from '@/variable_def';
import * as math from 'mathjs';

import {getSchemaForPath, reconcileAndApplySchema} from "@/schema";

export function trimQuotesAndBackslashes(str: string): string {
    if (!_.isString(str)) return str;
    // Regular expression to match backslashes and quotes (including backticks) at the beginning and end
    return str.replace(/^[\\"'` ]*(.*?)[\\"'` ]*$/, '$1');
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
    } catch (e) { /* empty */ }

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
type CommandNames = 'set' | 'insert' | 'assign' | 'remove' | 'add';

/**
 * 从大字符串中提取所有 .set(${path}, ${new_value});//${reason} 格式的模式
 * 并解析出每个匹配项的路径、新值和原因部分
 */
// 接口定义：用于统一不同命令的结构
// 新增：Command 接口，比 SetCommand 更通用
interface Command {
    command: CommandNames;
    fullMatch: string;
    args: string[];
    reason: string;
}

/**
 * 从输入文本中提取所有 `_.<command>(...)` 调用。
 * 此函数**仅负责结构化解析**，将参数有效性验证移交 `updateVariables` 函数统一处理，以便进行结构化错误报告。
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
    const results: Command[] = [];
    let i = 0;

    while (i < inputText.length) {
        // 循环处理整个输入文本，直到找不到更多命令
        // 使用正则匹配 _.set(、_.assign(、_.remove( 、 _.add( 或 _.insert(，重构后支持多种命令
        const setMatch = inputText.substring(i).match(/_\.(set|assign|remove|add|insert)\(/);
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

        // 直接将解析出的命令（无论参数数量是否“正确”）添加到结果中
        // 参数数量的验证将移至 updateVariables 中进行，以便能够报告 ArgumentError
        results.push({ command: commandType, fullMatch, args: params, reason: comment });

        // 更新搜索索引到命令末尾，继续查找下一个命令
        i = endPos;
    }

    // 返回所有解析出的命令
    return results;
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

export async function getLastValidVariable(message_id: number): Promise<Record<string, any>> {
    // 步骤 1: 优先在当前消息之前的历史记录中查找。
    // 这是处理所有后续消息（message_id > 0）的正确逻辑，能彻底解决因 swipe 导致的基线错误问题。
    const lastVariableInHistory = SillyTavern.chat
        .slice(0, message_id)
        .map(chat_message => _.get(chat_message, ['variables', chat_message.swipe_id ?? 0]))
        .findLast(variables => _.has(variables, 'stat_data'));
    if (lastVariableInHistory) {
        return structuredClone(lastVariableInHistory);
    }
    // 步骤 2: 如果历史记录中没有找到变量，则判定为初始消息 (message_id = 0) 的特殊情况。
    // 此时，initCheck 函数已将正确的初始状态（包含 lorebook 数据）保存在了当前消息上。
    // 我们必须从当前消息中获取这个状态作为基线，以避免丢失初始化数据。
    const currentMessage = SillyTavern.chat[message_id];
    if (currentMessage) {
        const variablesOnCurrentMessage = _.get(currentMessage, ['variables', currentMessage.swipe_id ?? 0]);
        if (variablesOnCurrentMessage && _.has(variablesOnCurrentMessage, 'stat_data')) {
            // 注意：此处不应深拷贝，因为这是 updateVariables 的直接输入，
            // 它是对同一个消息数据的就地修改。
            return variablesOnCurrentMessage;
        }
    }
    // 步骤 3: 作为最终的、不太可能发生的后备方案。
    return getVariables();
}

function pathFix(path: string): string {
    const segments = [];
    let currentSegment = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < path.length; i++) {
        const char = path[i];

        // Handle quotes
        if ((char === '"' || char === "'") && (i === 0 || path[i - 1] !== '\\')) {
            if (!inQuotes) {
                inQuotes = true;
                quoteChar = char;
            } else if (char === quoteChar) {
                inQuotes = false;
            } else {
                currentSegment += char;
            }
        } else if (char === '.' && !inQuotes) {
            segments.push(currentSegment);
            currentSegment = '';
        } else {
            currentSegment += char;
        }
    }

    if (currentSegment) {
        segments.push(currentSegment);
    }

    return segments.join('.');
}

/**
 * 中心化的错误报告函数。
 * @param variables - 当前的变量状态对象，用于写入 error_data。
 * @param command - 导致错误的完整命令对象。
 * @param details - 包含错误类型、级别、消息和上下文的结构化对象。
 */
function reportError(
    variables: any,
    command: Command,
    details: {
        type: ErrorType;
        level: 'warn' | 'error';
        message: string;
        context?: any;
    }
): void {
    const path = trimQuotesAndBackslashes(command.args[0] ?? '');
    const error: ProcessingError = {
        type: details.type,
        level: details.level,
        path: path,
        message: details.message,
        command: command.fullMatch,
        context: details.context,
    };

    // 使用完整的命令字符串作为键，可以自然地对重复的错误命令进行去重，
    // 避免在 error_data 中产生大量冗余条目，这对于后续的 LLM 反馈至关重要。
    variables.error_data[command.fullMatch] = error;

    // 仍然在控制台打印，便于实时调试。
    const reason_str = command.reason ? `(${command.reason})` : '';
    console[details.level](`${error.type} on path '${path}': ${error.message} ${reason_str}`, { command: error.command, context: error.context });
}

// 声明式命令定义注册表
const COMMAND_DEFINITIONS: Record<string, any> = {
    'set':    { minArgs: 2 },
    'assign': { minArgs: 2 },
    'remove': { minArgs: 1 },
    'add':    { requiredArgs: 2 },
    'insert': { aliasFor: 'assign' },
};


/**
 * 更新 state_data 中的变量
 * @param current_message_content 当前消息的内容
 * @param variables 变量对象，包含 stat_data
 * @returns 一个 Promise，解析为一个对象，包含 modified (布尔值) 和 errorAdded (布尔值)，
 *          指示变量是否被修改或是否添加了新的错误。
 */
export async function updateVariables(
    current_message_content: string,
    variables: any
): Promise<{ modified: boolean; errorAdded: boolean; }> {
    const out_is_modifed = false;
    // 触发变量更新开始事件，通知外部系统
    await eventEmit(variable_events.VARIABLE_UPDATE_STARTED, variables, out_is_modifed);
    // 深拷贝变量对象，生成状态快照，用于记录显示数据
    const out_status: Record<string, any> = _.cloneDeep(variables);
    // 初始化增量状态对象，记录变化详情
    const delta_status: Record<string, any> = { stat_data: {} };
    // 确保 error_data 存在
    variables.error_data = {};
    // 统一处理宏替换，确保命令中的宏（如 ${variable}）被替换，提升一致性
    const processed_message_content = substitudeMacros(current_message_content);
    // 使用重构后的 extractCommands 提取所有命令
    const commands = extractCommands(processed_message_content);
    let variable_modified = false;
    const schema = variables.schema; // 获取 schema

    for (const original_command of commands) {
        let command = { ...original_command };
        // 1. 验证和别名处理
        let def = COMMAND_DEFINITIONS[command.command];

        if (!def) {
            reportError(variables, command, {
                type: 'InvalidCommand',
                level: 'error',
                message: `Command '${command.command}' is not a valid command.`,
            });
            
            continue;
        }

        if (def.aliasFor) {
            command.command = def.aliasFor as CommandNames;
            def = COMMAND_DEFINITIONS[command.command];
        }

        const { args } = command;
        const argCount = args.length;
        let isValid = true;
        let errorMsg = '';

        if (def.requiredArgs !== undefined && argCount !== def.requiredArgs) {
            isValid = false;
            errorMsg = `Command '${command.command}' requires exactly ${def.requiredArgs} arguments, but received ${argCount}.`;
        } else if (def.minArgs !== undefined && argCount < def.minArgs) {
            isValid = false;
            errorMsg = `Command '${command.command}' requires at least ${def.minArgs} arguments, but received ${argCount}.`;
        } else if (def.maxArgs !== undefined && argCount > def.maxArgs) {
            isValid = false;
            errorMsg = `Command '${command.command}' requires at most ${def.maxArgs} arguments, but received ${argCount}.`;
        }

        if (!isValid) {
            reportError(variables, command, {
                type: 'ArgumentError',
                level: 'warn',
                message: errorMsg,
                context: { command: command.command, receivedCount: argCount, definition: def }
            });
            
            continue;
        }

        // 2. 命令执行
        // 修正路径格式，去除首尾引号和反斜杠，确保路径有效
        const path = pathFix(trimQuotesAndBackslashes(command.args[0]));
        // 生成原因字符串，用于日志和显示
        const reason_str = command.reason ? `(${command.reason})` : '';
        let display_str = ''; // 初始化显示字符串，记录操作详情

        switch (
            command.command // 根据命令类型执行不同操作
        ) {
            case 'set': {
                // _.has 检查，确保路径存在
                if (!_.has(variables.stat_data, path)) {
                    reportError(variables, command, {
                        type: 'InvalidPath',
                        level: 'warn',
                        message: `Path '${path}' does not exist in stat_data, skipping set command ${reason_str}`,
                        context: { attemptedPath: path },
                    });
                    
                    continue;
                }

                // 获取路径上的旧值，可能为 undefined（路径不存在）
                const oldValue = _.get(variables.stat_data, path);
                // 支持两种格式：_.set(path, newValue) 或 _.set(path, oldValue, newValue)
                const newValueStr = command.args.length >= 3 ? command.args[2] : command.args[1];
                // 解析新值，支持字符串、数字、布尔值、JSON 对象等
                let newValue = parseCommandValue(newValueStr);

                // 在写入前，将 Date 对象序列化为 ISO 字符串
                if (newValue instanceof Date) {
                    newValue = newValue.toISOString();
                }

                if (
                    Array.isArray(oldValue) &&
                    oldValue.length === 2 &&
                    typeof oldValue[1] === 'string' &&
                    !Array.isArray(oldValue[0])
                ) {
                    // 处理 ValueWithDescription<T> 类型，更新数组第一个元素
                    // 仅当旧值为数字且新值不为 null 时，才强制转换为数字
                    // 这允许将数字字段设置为 null (例如角色死亡后好感度变为 null)
                    oldValue[0] = typeof oldValue[0] === 'number' && newValue !== null ? Number(newValue) : newValue;
                } else if (typeof oldValue === 'number' && newValue !== null) {
                    _.set(variables.stat_data, path, Number(newValue));
                }
                else {
                    // 其他情况直接设置新值，支持任意类型
                    _.set(variables.stat_data, path, newValue);
                }

                // 获取最终设置的新值，用于日志和事件
                const finalNewValue = _.get(variables.stat_data, path);

                // 检查是否为 ValueWithDescription 类型，以优化显示
                const isValueWithDescription =
                    Array.isArray(oldValue) &&
                    oldValue.length === 2;

                if (isValueWithDescription && Array.isArray(finalNewValue)) {
                    // 如果是 ValueWithDescription，只显示值的变化
                    display_str = `${JSON.stringify(oldValue[0])}->${JSON.stringify(finalNewValue[0])} ${reason_str}`;
                } else {
                    // 否则，按常规显示
                    display_str = `${JSON.stringify(oldValue)}->${JSON.stringify(finalNewValue)} ${reason_str}`;
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
                if (path !== '' && !_.has(variables.stat_data, path)) {
                    reportError(variables, command, {
                        type: 'InvalidPath',
                        level: 'warn',
                        message: `Path '${path}' does not exist, skipping assign command.`,
                        context: { attemptedPath: path },
                    });
                    continue;
                }

                const targetPath = path;
                // 统一获取目标值和目标Schema，优雅地处理根路径
                const existingValue = targetPath === '' ? variables.stat_data : _.get(variables.stat_data, targetPath);
                const targetSchema = getSchemaForPath(schema, targetPath);

                // 验证1：目标是否为原始类型？如果是，则无法插入。
                if (
                    existingValue !== null &&
                    !Array.isArray(existingValue) &&
                    !_.isObject(existingValue)
                ) {
                    reportError(variables, command, {
                        type: 'TypeMismatch',
                        level: 'warn',
                        message: `Cannot assign into path '${targetPath}' because it holds a primitive value (${typeof existingValue}). Operation skipped. ${reason_str}`,
                        context: { path: targetPath, actualType: typeof existingValue, expectedType: 'array | object' },
                    });
                    continue;
                }

                // [修改点] 将 console.warn 替换为 reportError
                // 验证2：Schema 规则
                if (targetSchema) {
                    if (targetSchema.type === 'object' && targetSchema.extensible === false) {
                        if (command.args.length === 2) {
                            // 合并
                            reportError(variables, command, {
                                type: 'SchemaViolation',
                                level: 'warn',
                                message: `Cannot merge data into non-extensible object at path '${targetPath}'.`,
                                context: { path: targetPath, rule: 'extensible', value: false },
                            });
                            continue;
                        }
                        if (command.args.length >= 3) {
                            // 插入键
                            const newKey = String(parseCommandValue(command.args[1]));
                            if (!_.has(targetSchema.properties, newKey)) {
                                reportError(variables, command, {
                                    type: 'SchemaViolation',
                                    level: 'warn',
                                    message: `Cannot assign new key '${newKey}' into non-extensible object at path '${targetPath}'.`,
                                    context: { path: targetPath, rule: 'extensible', value: false, attemptedKey: newKey },
                                });
                                continue;
                            }
                        }
                    } else if (
                        targetSchema.type === 'array' &&
                        (targetSchema.extensible === false || targetSchema.extensible === undefined)
                    ) {
                        reportError(variables, command, {
                            type: 'SchemaViolation',
                            level: 'warn',
                            message: `Cannot assign elements into non-extensible array at path '${targetPath}'.`,
                            context: { path: targetPath, rule: 'extensible', value: false },
                        });
                        continue;
                    }
                } else if (
                    // 增加 targetPath !== '' 条件，防止对根路径进行父路径检查
                    targetPath !== '' &&
                    !_.get(variables.stat_data, _.toPath(targetPath).slice(0, -1).join('.'))
                ) {
                    // 验证3：如果要插入到新路径，确保其父路径存在且可扩展
                    reportError(variables, command, {
                        type: 'InvalidPath',
                        level: 'warn',
                        message: `Cannot assign into non-existent path '${targetPath}' without an extensible parent.`,
                        context: { path: targetPath },
                    });
                    continue;
                }
                // --- 所有验证通过，现在可以安全执行 ---

                // 深拷贝旧值，防止直接修改影响后续比较
                const oldValue = _.cloneDeep(_.get(variables.stat_data, path));
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
                    let collection = targetPath === '' ? variables.stat_data : _.get(variables.stat_data, path);

                    // 如果目标不存在，初始化为空数组或对象
                    if (!Array.isArray(collection) && !_.isObject(collection)) {
                        collection = Array.isArray(valueToAssign) ? [] : {};
                        _.set(variables.stat_data, path, collection);
                    }

                    if (Array.isArray(collection)) {
                        // 目标是数组，追加元素
                        if (Array.isArray(valueToAssign)) {
                            // 插入数组元素，逐个追加
                            collection.push(...valueToAssign);
                            display_str = `ASSIGNED array ${JSON.stringify(valueToAssign)} into array '${path}' ${reason_str}`;
                        } else {
                            // 插入单个值
                            collection.push(valueToAssign);
                            display_str = `ASSIGNED ${JSON.stringify(valueToAssign)} into array '${path}' ${reason_str}`;
                        }
                        successful = true;
                    } else if (_.isObject(collection)) {
                        // 目标是对象，合并属性
                        if (_.isObject(valueToAssign) && !Array.isArray(valueToAssign)) {
                            _.merge(collection, valueToAssign);
                            display_str = `MERGED object ${JSON.stringify(valueToAssign)} into object '${path}' ${reason_str}`;
                            successful = true;
                        } else {
                            // 不支持将数组或非对象合并到对象，记录错误
                            reportError(variables, command, {
                                type: 'TypeMismatch',
                                level: 'error',
                                message: `Cannot merge ${Array.isArray(valueToAssign) ? 'array' : 'non-object'} into object at '${path}'`,
                                context: { path: targetPath, valueType: Array.isArray(valueToAssign) ? 'array' : typeof valueToAssign, targetType: 'object' },
                            });
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

                    let collection = targetPath === '' ? variables.stat_data : _.get(variables.stat_data, path);

                    if (Array.isArray(collection) && typeof keyOrIndex === 'number') {
                        // 目标是数组且索引是数字，插入到指定位置
                        if (Array.isArray(valueToAssign)) {
                            collection.splice(keyOrIndex, 0, ...valueToAssign);
                            display_str = `ASSIGNED array ${JSON.stringify(valueToAssign)} into '${path}' at index ${keyOrIndex} ${reason_str}`;
                        } else {
                            collection.splice(keyOrIndex, 0, valueToAssign);
                            display_str = `ASSIGNED ${JSON.stringify(valueToAssign)} into '${path}' at index ${keyOrIndex} ${reason_str}`;
                        }
                        successful = true;
                    } else if (_.isObject(collection)) {
                        // 目标是对象，设置指定键
                        _.set(collection, String(keyOrIndex), valueToAssign);
                        display_str = `ASSIGNED key '${keyOrIndex}' with value ${JSON.stringify(valueToAssign)} into object '${path}' ${reason_str}`;
                        successful = true;
                    } else {
                        // 目标不存在，创建新对象并插入
                        collection = {};
                        _.set(variables.stat_data, path, collection);
                        _.set(collection, String(keyOrIndex), valueToAssign);
                        display_str = `CREATED object at '${path}' and ASSIGNED key '${keyOrIndex}' ${reason_str}`;
                        successful = true;
                    }
                }
                
                if (successful) {
                    // 插入成功，获取新值并触发事件
                    const newValue = _.get(variables.stat_data, path);
                    variable_modified = true;
                    console.info(display_str);
                    await eventEmit(
                        variable_events.SINGLE_VARIABLE_UPDATED,
                        variables.stat_data,
                        path,
                        oldValue,
                        newValue
                    );
                } else {
                    // 插入失败，记录错误并继续处理下一命令
                    console.error(`Invalid arguments for _.assign on path '${path}'`);
                    continue;
                }
                break;
            }

            case 'remove': {
                // 验证路径存在，防止无效删除
                if (!_.has(variables.stat_data, path)) {
                    reportError(variables, command, {
                        type: 'InvalidPath',
                        level: 'warn',
                        message: `Path '${path}' does not exist, cannot execute _.remove.`,
                        context: { attemptedPath: path },
                    });
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
                    reportError(variables, command, {
                        type: 'ArgumentError',
                        level: 'error',
                        message: `Could not determine target for deletion for command on path '${path}'.`,
                    });
                    continue;
                }
                // 只有当容器路径不是根路径（即不为空）时，才检查其是否存在
                if (containerPath !== '' && !_.has(variables.stat_data, containerPath)) {
                    reportError(variables, command, {
                        type: 'InvalidPath',
                        level: 'warn',
                        message: `Cannot remove from non-existent container path '${containerPath}'.`,
                        context: { attemptedPath: containerPath },
                    });
                    continue;
                }

                const containerSchema = getSchemaForPath(schema, containerPath);

                if (containerSchema) {
                    if (containerSchema.type === 'array') {
                        if (containerSchema.extensible !== true) {
                            reportError(variables, command, {
                                type: 'SchemaViolation',
                                level: 'warn',
                                message: `Cannot remove element from non-extensible array at path '${containerPath}'.`,
                                context: { path: containerPath, rule: 'extensible', value: false },
                            });
                            continue;
                        }
                    } else if (containerSchema.type === 'object') {
                        const keyString = String(keyOrIndexToRemove);
                        if (
                            _.has(containerSchema.properties, keyString) &&
                            containerSchema.properties[keyString].required === true
                        ) {
                             reportError(variables, command, {
                                type: 'SchemaViolation',
                                level: 'warn',
                                message: `Cannot remove required key '${keyString}' from path '${containerPath}'.`,
                                context: { path: containerPath, rule: 'required', value: true, attemptedKey: keyString },
                            });
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
                        reportError(variables, command, {
                            type: 'TypeMismatch',
                            level: 'warn',
                            message: `Cannot remove from path '${path}' because it is not an array or object.`,
                            context: { path: path, actualType: typeof collection, expectedType: 'array | object' },
                        });
                        continue;
                    }

                    if (Array.isArray(collection)) {
                        // 目标是数组，删除指定元素
                        const originalArray = _.cloneDeep(collection);
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
                                _.unset(collection, keyToRemove);
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
                    reportError(variables, command, {
                        type: 'ArgumentError',
                        level: 'warn',
                        message: `Failed to execute remove on '${path}'. The specified item or key was not found.`,
                        context: { path: path, itemNotFound: targetToRemove },
                    });
                    continue;
                }
                break;
            }

            case 'add': {
                // 验证路径存在
                if (!_.has(variables.stat_data, path)) {
                    reportError(variables, command, {
                        type: 'InvalidPath',
                        level: 'warn',
                        message: `Path '${path}' does not exist, skipping add command.`,
                        context: { attemptedPath: path },
                    });
                    continue;
                }
                // 获取当前值
                const initialValue = _.cloneDeep(_.get(variables.stat_data, path));
                const oldValue = _.get(variables.stat_data, path);
                let valueToAdd = oldValue;
                const isValueWithDescription =
                    Array.isArray(oldValue) &&
                    oldValue.length === 2 &&
                    typeof oldValue[0] !== 'object';

                if (isValueWithDescription) {
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

/*                if (command.args.length === 1) {
                    // 单参数：切换布尔值
                    if (typeof valueToAdd !== 'boolean') {
                        console.warn(
                            `Path '${path}' is not a boolean${isValueWithDescription ? ' or ValueWithDescription<boolean>' : ''}, skipping add command ${reason_str}`
                        );
                        continue;
                    }
                    const newValue = !valueToAdd;
                    if (isValueWithDescription) {
                        oldValue[0] = newValue; // Update the first element
                        _.set(variables.stat_data, path, oldValue);
                    } else {
                        _.set(variables.stat_data, path, newValue);
                    }
                    const finalNewValue = _.get(variables.stat_data, path);
                    if (isValueWithDescription) {
                        display_str = `${JSON.stringify(initialValue[0])}->${JSON.stringify(finalNewValue[0])} ${reason_str}`;
                    } else {
                        display_str = `${JSON.stringify(initialValue)}->${JSON.stringify(finalNewValue)} ${reason_str}`;
                    }
                    variable_modified = true;
                    console.info(
                        `ADDED boolean '${path}' from '${valueToAdd}' to '${newValue}' ${reason_str}`
                    );
                    await eventEmit(
                        variable_events.SINGLE_VARIABLE_UPDATED,
                        variables.stat_data,
                        path,
                        initialValue,
                        finalNewValue
                    );
                } else */if (command.args.length === 2) {
                    // 双参数：调整数值或日期
                    const delta = parseCommandValue(command.args[1]);

                    // 处理 Date 类型
                    if (potentialDate) {
                        if (typeof delta !== 'number') {                            
                            reportError(variables, command, {
                                type: 'TypeMismatch',
                                level: 'warn',
                                message: `Delta for Date operation is not a number.`,
                                context: { path: path, actualType: typeof delta, expectedType: 'number' },
                            });
                            
                            continue;
                        }
                        // delta 是毫秒数，更新时间
                        const newDate = new Date(potentialDate.getTime() + delta);
                        // 总是将更新后的 Date 对象转换为 ISO 字符串再存回去
                        const finalValueToSet = newDate.toISOString();

                        if (isValueWithDescription) {
                            oldValue[0] = finalValueToSet;
                            _.set(variables.stat_data, path, oldValue);
                        } else {
                            _.set(variables.stat_data, path, finalValueToSet);
                        }

                        const finalNewValue = _.get(variables.stat_data, path);
                        if (isValueWithDescription) {
                            display_str = `${JSON.stringify(initialValue[0])}->${JSON.stringify(finalNewValue[0])} ${reason_str}`;
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
                            console.warn(
                                `Delta '${command.args[1]}' is not a number, skipping add command ${reason_str}`
                            );
                            continue;
                        }
                        let newValue = valueToAdd + delta;
                        newValue = parseFloat(newValue.toPrecision(12)); // 避免浮点数精度误差
                        if (isValueWithDescription) {
                            oldValue[0] = newValue; // Update the first element
                            _.set(variables.stat_data, path, oldValue);
                        } else {
                            _.set(variables.stat_data, path, newValue);
                        }
                        const finalNewValue = _.get(variables.stat_data, path);
                        if (isValueWithDescription) {
                            display_str = `${JSON.stringify(initialValue[0])}->${JSON.stringify(finalNewValue[0])} ${reason_str}`;
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
                        reportError(variables, command, {
                            type: 'TypeMismatch', 
                            level: 'warn', 
                            message: `Path '${path}' value is not a date or number; cannot perform add operation.`, 
                            context: { path: path, actualType: typeof valueToAdd, expectedType: 'number | date-string' }
                        });
                        
                        continue;
                    }
                } else {
                    reportError(variables, command, {
                        type: 'ArgumentError',
                        level: 'warn',
                        message: `Invalid number of arguments for _.add on path '${path}'`,
                        context: { 
                            path: path,
                            receivedCount: command.args.length,
                            expected: '2 arguments' // 旧代码中没有指定确切数量，这里提供一个通用说明
                        }
                    });
                    continue;
                }
                break;
            }
        }

        if (display_str) {
            // 更新状态和增量数据，记录操作详情
            _.set(out_status.stat_data, path, display_str);
            _.set(delta_status.stat_data, path, display_str);
        }
    }

    // 在所有命令执行完毕后，如果数据有任何变动，则执行一次 Schema 调和
    if (variable_modified) {
        reconcileAndApplySchema(variables);
    }

    // 更新变量的显示和增量数据
    variables.display_data = out_status.stat_data;
    variables.delta_data = delta_status.stat_data;
    // 触发变量更新结束事件
    await eventEmit(variable_events.VARIABLE_UPDATE_ENDED, variables, out_is_modifed);
    // 返回是否修改了变量
    return { modified: variable_modified || out_is_modifed, errorAdded: Object.keys(variables.error_data).length > 0 };
}

export async function handleVariablesInMessage(message_id: number) {
    const chat_message = getChatMessages(message_id).at(-1);
    if (!chat_message) {
        return;
    }

    const message_content = chat_message.message;
    const variables = await getLastValidVariable(message_id);
    if (!_.has(variables, 'stat_data')) {
        console.error(`cannot found stat_data for ${message_id}`);
        return;
    }

    const result = await updateVariables(message_content, variables);
    // 只要变量被修改或产生了新错误，就更新聊天级别的变量
    if (result.modified || result.errorAdded) {
        // 使用 cloneDeep 确保 chat 级快照与 message 级状态完全分离，防止数据污染
        await replaceVariables(_.cloneDeep(variables), { type: 'chat' });
    }
    
    await replaceVariables(variables, { type: 'message', message_id: message_id });

    if (chat_message.role !== 'user' && !message_content.includes('<StatusPlaceHolderImpl/>')) {
        await setChatMessages(
            [
                {
                    message_id: message_id,
                    message: message_content + '\n\n<StatusPlaceHolderImpl/>',
                },
            ],
            {
                refresh: 'affected',
            }
        );
    }
}



export async function handleVariablesInCallback(message_content: string, variable_info : VariableData) {
    if (variable_info.old_variables === undefined)
    {
        return;
    }
    variable_info.new_variables = _.cloneDeep(variable_info.old_variables);
    const variables = variable_info.new_variables;

    const result = await updateVariables(message_content, variables);
    //如果没有修改，并且没有添加任何错误，则不产生 newVariable
    if (!result.modified && !result.errorAdded)
        delete variable_info.new_variables;
}
