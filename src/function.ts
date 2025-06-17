import { variable_events } from '@/main';
import * as math from 'mathjs';

/**
 * 辅助函数：为数据路径获取对应的 Schema 规则。
 * 能够处理数组索引，将其转换为 .elementType 来查询 Schema。
 * @param schema - 完整的 Schema 对象
 * @param path - 要查询的数据路径
 * @returns 对应路径的 Schema 节点，如果找不到则返回 null。
 */
function getSchemaForPath(schema: any, path: string): any {
    if (!path) {
        return schema;
    }
    // 将 lodash 路径字符串转换为段数组，例如 'a.b[0].c' -> ['a', 'b', '0', 'c']
    const pathSegments = _.toPath(path);
    let currentSchema = schema;

    for (const segment of pathSegments) {
        if (!currentSchema) return null;

        // 如果 segment 是数字（数组索引），则移动到 elementType
        if (/^\d+$/.test(segment)) {
            if (currentSchema.type === 'array' && currentSchema.elementType) {
                currentSchema = currentSchema.elementType;
            } else {
                return null; // 路径试图索引一个非数组或无 elementType 的 schema
            }
        } else {
            // 否则，作为对象属性访问
            if (currentSchema.properties && currentSchema.properties[segment]) {
                currentSchema = currentSchema.properties[segment];
            } else {
                return null; // 路径中的键在 schema 中不存在
            }
        }
    }
    return currentSchema;
}

export function trimQuotesAndBackslashes(str: string): string {
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
        // 创建一个 scope 对象，将 JavaScript 原生的 Math 对象注入到 mathjs 的执行环境中。
        // 这样 mathjs 在求值时就能识别和使用 Math.max, Math.floor, Math.E 等。
        const scope = {
            Math: Math,
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
    // 尝试将字符串解析为日期对象，用于传入_.alter直接以毫秒数更新时间，如 `_.alter('当前时间', 10 * 60 * 1000);`
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

    // 最终，返回这个去除了首尾引号的字符串
    return trimQuotesAndBackslashes(valStr);
}

/**
 * 从大字符串中提取所有 .set(${path}, ${new_value});//${reason} 格式的模式
 * 并解析出每个匹配项的路径、新值和原因部分
 */
// 接口定义：用于统一不同命令的结构
// 新增：Command 接口，比 SetCommand 更通用
interface Command {
    command: 'set' | 'insert' | 'delete' | 'alter';
    fullMatch: string;
    args: string[];
    reason: string;
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
    const results: Command[] = [];
    let i = 0;

    while (i < inputText.length) {
        // 循环处理整个输入文本，直到找不到更多命令
        // 使用正则匹配 _.set(、_.insert(、_.delete( 或 _.alter(，重构后支持多种命令
        const setMatch = inputText.substring(i).match(/_\.(set|insert|delete|alter)\(/);
        if (!setMatch || setMatch.index === undefined) {
            // 没有找到匹配的命令，退出循环，防止无限循环
            break;
        }

        // 提取命令类型（set、insert、delete 或 alter），并计算命令的起始位置
        const commandType = setMatch[1] as 'set' | 'insert' | 'delete' | 'alter';
        const setStart = i + setMatch.index;
        // 计算开括号位置，用于后续提取参数
        const openParen = setStart + setMatch[0].length;

        // 使用 findMatchingCloseParen 查找匹配的闭括号，解决原正则匹配在嵌套结构（如 _.set('path', ['inner);'])）中提前结束的问题
        let closeParen = findMatchingCloseParen(inputText, openParen);
        if (closeParen === -1) {
            // 找不到闭括号，说明命令格式错误，停止解析以避免错误传播
            break;
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
        else if (commandType === 'insert' && params.length >= 2)
            isValid = true; // _.insert 支持两种参数格式
        else if (commandType === 'delete' && params.length >= 1)
            isValid = true; // _.delete 至少需要路径
        else if (commandType === 'alter' && (params.length === 1 || params.length === 2))
            isValid = true; // _.alter 需要1个或2个参数

        if (isValid) {
            // 命令有效，添加到结果列表，包含命令类型、完整匹配、参数和注释
            results.push({ command: commandType, fullMatch, args: params, reason: comment });
        }

        // 更新搜索索引到命令末尾，继续查找下一个命令
        i = endPos;
    }

    // 返回所有解析出的有效命令
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

export async function getLastValidVariable(startNum: number): Promise<Record<string, any>> {
    for (;;) {
        if (startNum < 0) break;
        var currentMsg = await getChatMessages(startNum);
        if (currentMsg.length > 0) {
            var variables = currentMsg[0].data;
            if (_.has(variables, 'stat_data')) {
                return variables;
            }
        }
        --startNum;
    }
    return await getVariables();
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

// 重构 updateVariables 以处理更多命令
export async function updateVariables(
    current_message_content: string,
    variables: any
): Promise<boolean> {
    var out_is_modifed = false;
    // 触发变量更新开始事件，通知外部系统
    await eventEmit(variable_events.VARIABLE_UPDATE_STARTED, variables, out_is_modifed);
    // 深拷贝变量对象，生成状态快照，用于记录显示数据
    var out_status: Record<string, any> = _.cloneDeep(variables);
    // 初始化增量状态对象，记录变化详情
    var delta_status: Record<string, any> = { stat_data: {} };

    // 重构新增：统一处理宏替换，确保命令中的宏（如 ${variable}）被替换，提升一致性
    const processed_message_content = substitudeMacros(current_message_content);

    // 使用重构后的 extractCommands 提取所有命令
    let commands = extractCommands(processed_message_content);
    var variable_modified = false;

    const schema = variables.schema; // 获取 schema

    for (const command of commands) {
        // 遍历所有命令，逐一处理
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
                    console.warn(
                        `Path '${path}' does not exist in stat_data, skipping set command ${reason_str}`
                    );
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

                if (typeof oldValue === 'number') {
                    // 如果旧值是数字，强制转换新值为数字，保持类型一致
                    _.set(variables.stat_data, path, Number(newValue));
                } else if (
                    Array.isArray(oldValue) &&
                    oldValue.length === 2 &&
                    typeof oldValue[0] !== 'object'
                ) {
                    // 处理 ValueWithDescription<T> 类型，更新数组第一个元素
                    oldValue[0] = typeof oldValue[0] === 'number' ? Number(newValue) : newValue;
                    _.set(variables.stat_data, path, oldValue);
                } else {
                    // 其他情况直接设置新值，支持任意类型
                    _.set(variables.stat_data, path, newValue);
                }

                // 获取最终设置的新值，用于日志和事件
                const finalNewValue = _.get(variables.stat_data, path);
                // 生成显示字符串，记录变化详情
                display_str = `${JSON.stringify(oldValue)}->${JSON.stringify(finalNewValue)} ${reason_str}`;
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

            case 'insert': {
                // 检查目标路径是否指向一个集合（数组或对象）
                // 如果路径已存在且其值为原始类型（字符串、数字等），则跳过此命令，以防止结构污染
                const targetPath = path;
                const existingValue = _.get(variables.stat_data, targetPath);
                const targetSchema = getSchemaForPath(schema, targetPath);

                // 验证1：目标是否为原始类型？如果是，则无法插入。
                if (
                    existingValue !== null &&
                    !Array.isArray(existingValue) &&
                    !_.isObject(existingValue)
                ) {
                    console.warn(
                        `Cannot insert into path '${targetPath}' because it holds a primitive value (${typeof existingValue}). Operation skipped. ${reason_str}`
                    );
                    continue;
                }

                // 验证2：Schema 规则
                if (targetSchema) {
                    if (targetSchema.type === 'object' && targetSchema.extensible === false) {
                        if (command.args.length === 2) {
                            // 合并
                            console.warn(
                                `SCHEMA VIOLATION: Cannot merge data into non-extensible object at path '${targetPath}'. ${reason_str}`
                            );
                            continue;
                        }
                        if (command.args.length >= 3) {
                            // 插入键
                            const newKey = String(parseCommandValue(command.args[1]));
                            if (!_.has(targetSchema.properties, newKey)) {
                                console.warn(
                                    `SCHEMA VIOLATION: Cannot insert new key '${newKey}' into non-extensible object at path '${targetPath}'. ${reason_str}`
                                );
                                continue;
                            }
                        }
                    } else if (
                        targetSchema.type === 'array' &&
                        (targetSchema.extensible === false || targetSchema.extensible === undefined)
                    ) {
                        console.warn(
                            `SCHEMA VIOLATION: Cannot insert elements into non-extensible array at path '${targetPath}'. ${reason_str}`
                        );
                        continue;
                    }
                } else if (
                    !_.get(variables.stat_data, _.toPath(targetPath).slice(0, -1).join('.'))
                ) {
                    // 验证3：如果要插入到新路径，确保其父路径存在且可扩展
                    console.warn(
                        `Cannot insert into non-existent path '${targetPath}' without an extensible parent. ${reason_str}`
                    );
                    continue;
                }
                // --- 所有验证通过，现在可以安全执行 ---

                // 深拷贝旧值，防止直接修改影响后续比较
                const oldValue = _.cloneDeep(_.get(variables.stat_data, path));
                let successful = false; // 标记插入是否成功

                if (command.args.length === 2) {
                    // _.insert('path.to.array', value)
                    // 解析插入值，支持复杂类型
                    let valueToInsert = parseCommandValue(command.args[1]);

                    // 在写入前，将 Date 对象（或数组中的Date）序列化
                    if (valueToInsert instanceof Date) {
                        valueToInsert = valueToInsert.toISOString();
                    } else if (Array.isArray(valueToInsert)) {
                        valueToInsert = valueToInsert.map(item =>
                            item instanceof Date ? item.toISOString() : item
                        );
                    }

                    // 获取目标集合，可能为数组或对象
                    let collection = _.get(variables.stat_data, path);

                    // 如果目标不存在，初始化为空数组或对象
                    if (!Array.isArray(collection) && !_.isObject(collection)) {
                        collection = Array.isArray(valueToInsert) ? [] : {};
                        _.set(variables.stat_data, path, collection);
                    }

                    if (Array.isArray(collection)) {
                        // 目标是数组，追加元素
                        if (Array.isArray(valueToInsert)) {
                            // 插入数组元素，逐个追加
                            collection.push(...valueToInsert);
                            display_str = `INSERTED array ${JSON.stringify(valueToInsert)} into array '${path}' ${reason_str}`;
                        } else {
                            // 插入单个值
                            collection.push(valueToInsert);
                            display_str = `INSERTED ${JSON.stringify(valueToInsert)} into array '${path}' ${reason_str}`;
                        }
                        successful = true;
                    } else if (_.isObject(collection)) {
                        // 目标是对象，合并属性
                        if (_.isObject(valueToInsert) && !Array.isArray(valueToInsert)) {
                            _.merge(collection, valueToInsert);
                            display_str = `MERGED object ${JSON.stringify(valueToInsert)} into object '${path}' ${reason_str}`;
                            successful = true;
                        } else {
                            // 不支持将数组或非对象合并到对象，记录错误
                            console.error(
                                `Cannot merge ${Array.isArray(valueToInsert) ? 'array' : 'non-object'} into object at '${path}'`
                            );
                            continue;
                        }
                    }
                } else if (command.args.length >= 3) {
                    // _.insert('path', key/index, value)
                    // 解析插入值和键/索引
                    let valueToInsert = parseCommandValue(command.args[2]);
                    const keyOrIndex = parseCommandValue(command.args[1]);

                    // 在写入前，将 Date 对象（或数组中的Date）序列化
                    if (valueToInsert instanceof Date) {
                        valueToInsert = valueToInsert.toISOString();
                    } else if (Array.isArray(valueToInsert)) {
                        valueToInsert = valueToInsert.map(item =>
                            item instanceof Date ? item.toISOString() : item
                        );
                    }

                    let collection = _.get(variables.stat_data, path);

                    if (Array.isArray(collection) && typeof keyOrIndex === 'number') {
                        // 目标是数组且索引是数字，插入到指定位置
                        if (Array.isArray(valueToInsert)) {
                            collection.splice(keyOrIndex, 0, ...valueToInsert);
                            display_str = `INSERTED array ${JSON.stringify(valueToInsert)} into '${path}' at index ${keyOrIndex} ${reason_str}`;
                        } else {
                            collection.splice(keyOrIndex, 0, valueToInsert);
                            display_str = `INSERTED ${JSON.stringify(valueToInsert)} into '${path}' at index ${keyOrIndex} ${reason_str}`;
                        }
                        successful = true;
                    } else if (_.isObject(collection)) {
                        // 目标是对象，设置指定键
                        _.set(collection, String(keyOrIndex), valueToInsert);
                        display_str = `INSERTED key '${keyOrIndex}' with value ${JSON.stringify(valueToInsert)} into object '${path}' ${reason_str}`;
                        successful = true;
                    } else {
                        // 目标不存在，创建新对象并插入
                        collection = {};
                        _.set(variables.stat_data, path, collection);
                        _.set(collection, String(keyOrIndex), valueToInsert);
                        display_str = `CREATED object at '${path}' and INSERTED key '${keyOrIndex}' ${reason_str}`;
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
                    console.error(`Invalid arguments for _.insert on path '${path}'`);
                    continue;
                }
                break;
            }

            case 'delete': {
                // 验证路径存在，防止无效删除
                if (!_.has(variables.stat_data, path)) {
                    console.error(`undefined Path: ${path} in _.delete command`);
                    continue;
                }

                // --- 模式校验开始 ---
                let containerPath = path;
                let keyOrIndexToDelete: string | number | undefined;

                if (command.args.length > 1) {
                    // _.delete('path', key_or_index)
                    keyOrIndexToDelete = parseCommandValue(command.args[1]);
                    // 如果 key 是字符串，需要去除可能存在的引号
                    if (typeof keyOrIndexToDelete === 'string') {
                        keyOrIndexToDelete = trimQuotesAndBackslashes(keyOrIndexToDelete);
                    }
                } else {
                    // _.delete('path.to.key[index]')
                    const pathParts = _.toPath(path);
                    const lastPart = pathParts.pop();
                    if (lastPart) {
                        keyOrIndexToDelete = /^\d+$/.test(lastPart) ? Number(lastPart) : lastPart;
                        containerPath = pathParts.join('.');
                    }
                }

                if (keyOrIndexToDelete === undefined) {
                    console.error(
                        `Could not determine target for deletion for command on path '${path}' ${reason_str}`
                    );
                    continue;
                }
                if (!_.has(variables.stat_data, containerPath)) {
                    console.warn(
                        `Cannot delete from non-existent path '${containerPath}'. ${reason_str}`
                    );
                    continue;
                }

                const containerSchema = getSchemaForPath(schema, containerPath);

                if (containerSchema) {
                    if (containerSchema.type === 'array') {
                        if (containerSchema.extensible !== true) {
                            console.warn(
                                `SCHEMA VIOLATION: Cannot delete element from non-extensible array at path '${containerPath}'. ${reason_str}`
                            );
                            continue;
                        }
                    } else if (containerSchema.type === 'object') {
                        const keyString = String(keyOrIndexToDelete);
                        if (
                            _.has(containerSchema.properties, keyString) &&
                            containerSchema.properties[keyString].required === true
                        ) {
                            console.warn(
                                `SCHEMA VIOLATION: Cannot delete required key '${keyString}' from path '${containerPath}'. ${reason_str}`
                            );
                            continue;
                        }
                    }
                }

                // --- 所有验证通过，现在可以安全执行 ---

                // 解析删除目标，可能是值或索引
                const targetToDelete =
                    command.args.length > 1 ? parseCommandValue(command.args[1]) : undefined;
                let itemDeleted = false; // 标记是否删除成功

                if (targetToDelete === undefined) {
                    // _.delete('path.to.key')
                    // 删除整个路径
                    const oldValue = _.get(variables.stat_data, path);
                    _.unset(variables.stat_data, path);
                    display_str = `DELETED path '${path}' ${reason_str}`;
                    itemDeleted = true;
                    await eventEmit(
                        variable_events.SINGLE_VARIABLE_UPDATED,
                        variables.stat_data,
                        path,
                        oldValue,
                        undefined
                    );
                } else {
                    // _.delete('path.to.array', value_or_index)
                    const collection = _.get(variables.stat_data, path);

                    // 当从一个集合中删除元素时，必须确保目标路径确实是一个集合
                    // 如果目标是原始值（例如字符串），则无法执行删除操作
                    if (!Array.isArray(collection) && !_.isObject(collection)) {
                        console.warn(
                            `Cannot delete from path '${path}' because it is not an array or object. Skipping command. ${reason_str}`
                        );
                        continue;
                    }

                    if (Array.isArray(collection)) {
                        // 目标是数组，删除指定元素
                        const originalArray = _.cloneDeep(collection);
                        let indexToDelete = -1;
                        if (typeof targetToDelete === 'number') {
                            indexToDelete = targetToDelete;
                        } else {
                            indexToDelete = collection.findIndex(item =>
                                _.isEqual(item, targetToDelete)
                            );
                        }

                        if (indexToDelete >= 0 && indexToDelete < collection.length) {
                            collection.splice(indexToDelete, 1);
                            itemDeleted = true;
                            display_str = `DELETED item from '${path}' ${reason_str}`;
                            await eventEmit(
                                variable_events.SINGLE_VARIABLE_UPDATED,
                                variables.stat_data,
                                path,
                                originalArray,
                                collection
                            );
                        }
                    } else if (_.isObject(collection)) {
                        if (typeof targetToDelete === 'number') {
                            // 目标是对象，按索引删除键
                            const keys = Object.keys(collection);
                            const index = targetToDelete;
                            if (index >= 0 && index < keys.length) {
                                const keyToDelete = keys[index];
                                _.unset(collection, keyToDelete);
                                itemDeleted = true;
                                display_str = `DELETED ${index + 1}th entry ('${keyToDelete}') from object '${path}' ${reason_str}`;
                            }
                        } else {
                            // 目标是对象，按键名删除
                            const keyToDelete = String(targetToDelete);
                            if (_.has(collection, keyToDelete)) {
                                _.unset(collection, keyToDelete);
                                itemDeleted = true;
                                display_str = `DELETED key '${keyToDelete}' from object '${path}' ${reason_str}`;
                            }
                        }
                    }
                }

                if (itemDeleted) {
                    // 删除成功，更新状态并记录日志
                    variable_modified = true;
                    console.info(display_str);
                } else {
                    // 删除失败，记录警告并继续
                    console.warn(`Failed to execute delete on '${path}'`);
                    continue;
                }
                break;
            }

            case 'alter': {
                // 验证路径存在
                if (!_.has(variables.stat_data, path)) {
                    console.warn(
                        `Path '${path}' does not exist in stat_data, skipping alter command ${reason_str}`
                    );
                    continue;
                }
                // 获取当前值
                const initialValue = _.cloneDeep(_.get(variables.stat_data, path));
                const oldValue = _.get(variables.stat_data, path);
                let valueToAlter = oldValue;
                let isValueWithDescription =
                    Array.isArray(oldValue) &&
                    oldValue.length === 2 &&
                    typeof oldValue[0] !== 'object';

                if (isValueWithDescription) {
                    valueToAlter = oldValue[0]; // 对 ValueWithDescription 类型，操作其第一个元素
                }
                console.warn(valueToAlter);

                // 尝试将当前值解析为 Date 对象，无论其原始类型是 Date 还是字符串
                let potentialDate: Date | null = null;
                if (valueToAlter instanceof Date) {
                    potentialDate = valueToAlter;
                } else if (typeof valueToAlter === 'string') {
                    const parsedDate = new Date(valueToAlter);
                    // 确保它是一个有效的日期，并且不是一个可以被 `new Date` 解析的纯数字字符串
                    if (!isNaN(parsedDate.getTime()) && isNaN(Number(valueToAlter))) {
                        potentialDate = parsedDate;
                    }
                }

                if (command.args.length === 1) {
                    // 单参数：切换布尔值
                    if (typeof valueToAlter !== 'boolean') {
                        console.warn(
                            `Path '${path}' is not a boolean${isValueWithDescription ? ' or ValueWithDescription<boolean>' : ''}, skipping alter command ${reason_str}`
                        );
                        continue;
                    }
                    const newValue = !valueToAlter;
                    if (isValueWithDescription) {
                        oldValue[0] = newValue; // Update the first element
                        _.set(variables.stat_data, path, oldValue);
                    } else {
                        _.set(variables.stat_data, path, newValue);
                    }
                    const finalNewValue = _.get(variables.stat_data, path);
                    display_str = `${JSON.stringify(initialValue)}->${JSON.stringify(finalNewValue)} ${reason_str}`;
                    variable_modified = true;
                    console.info(
                        `ALTERED boolean '${path}' from '${valueToAlter}' to '${newValue}' ${reason_str}`
                    );
                    await eventEmit(
                        variable_events.SINGLE_VARIABLE_UPDATED,
                        variables.stat_data,
                        path,
                        initialValue,
                        finalNewValue
                    );
                } else if (command.args.length === 2) {
                    // 双参数：调整数值或日期
                    const delta = parseCommandValue(command.args[1]);

                    // 处理 Date 类型
                    if (potentialDate) {
                        if (typeof delta !== 'number') {
                            console.warn(
                                `Delta '${command.args[1]}' for Date operation is not a number, skipping alter command ${reason_str}`
                            );
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
                        display_str = `${JSON.stringify(initialValue)}->${JSON.stringify(finalNewValue)} ${reason_str}`;
                        variable_modified = true;
                        console.info(
                            `ALTERED date '${path}' from '${potentialDate.toISOString()}' to '${newDate.toISOString()}' by delta '${delta}'ms ${reason_str}`
                        );
                        await eventEmit(
                            variable_events.SINGLE_VARIABLE_UPDATED,
                            variables.stat_data,
                            path,
                            initialValue,
                            finalNewValue
                        );
                    } else if (typeof valueToAlter === 'number') {
                        // 原有的处理 number 类型的逻辑
                        if (typeof delta !== 'number') {
                            console.warn(
                                `Delta '${command.args[1]}' is not a number, skipping alter command ${reason_str}`
                            );
                            continue;
                        }
                        let newValue = valueToAlter + delta;
                        newValue = parseFloat(newValue.toPrecision(12)); // 避免浮点数精度误差
                        if (isValueWithDescription) {
                            oldValue[0] = newValue; // Update the first element
                            _.set(variables.stat_data, path, oldValue);
                        } else {
                            _.set(variables.stat_data, path, newValue);
                        }
                        const finalNewValue = _.get(variables.stat_data, path);
                        display_str = `${JSON.stringify(initialValue)}->${JSON.stringify(finalNewValue)} ${reason_str}`;
                        variable_modified = true;
                        console.info(
                            `ALTERED number '${path}' from '${valueToAlter}' to '${newValue}' by delta '${delta}' ${reason_str}`
                        );
                        await eventEmit(
                            variable_events.SINGLE_VARIABLE_UPDATED,
                            variables.stat_data,
                            path,
                            initialValue,
                            finalNewValue
                        );
                    } else {
                        // 如果值不是可识别的类型（布尔、日期、数字），则跳过
                        console.warn(
                            `Path '${path}' value is not a boolean, date, or number; skipping alter command ${reason_str}`
                        );
                        continue;
                    }
                } else {
                    console.warn(
                        `Invalid number of arguments for _.alter on path '${path}' ${reason_str}`
                    );
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

    // 更新变量的显示和增量数据
    variables.display_data = out_status.stat_data;
    variables.delta_data = delta_status.stat_data;
    // 触发变量更新结束事件
    await eventEmit(variable_events.VARIABLE_UPDATE_ENDED, variables, out_is_modifed);
    // 返回是否修改了变量
    return variable_modified || out_is_modifed;
}

export async function handleResponseMessage() {
    const last_message = await getLastMessageId();
    var last_chat_msg_list = await getChatMessages(last_message);
    if (last_chat_msg_list.length > 0) {
        var current_chat_msg = last_chat_msg_list[last_chat_msg_list.length - 1];
        if (current_chat_msg.role != 'assistant') return;
        var content_modified: boolean = false;
        var current_message_content = current_chat_msg.message;

        //更新变量状态，从最后一条之前的取，local优先级最低
        const variables = await getLastValidVariable(last_message - 1);
        if (!_.has(variables, 'stat_data')) {
            console.error('cannot found stat_data.');
            return;
        }

        // 使用正则解析 _.set(${path}, ${newvalue});//${reason} 格式的部分，并遍历结果
        var variable_modified: boolean = false;
        variable_modified =
            variable_modified || (await updateVariables(current_message_content, variables));
        if (variable_modified) {
            //更新到当前聊天
            await replaceVariables(variables);
        }
        //@ts-ignore
        await setChatMessage({ data: variables }, last_message, { refresh: 'none' });

        //如果是ai人物，则不插入
        if (!current_message_content.includes('<CharView')) {
            if (!current_message_content.includes('<StatusPlaceHolderImpl/>')) {
                //替换状态为实际的显示内容
                if (current_message_content.includes('<StatusPlaceHolder/>')) {
                    //const display_str = "```\n" + YAML.stringify(out_status.stat_data, 2) + "```\n";
                    //保证在输出完成后，才会渲染。
                    const display_str = '<StatusPlaceHolderImpl/>'; //status_entry.content;
                    //const display_str = "```\n" + vanilla_str + "```\n";
                    current_message_content = current_message_content.replace(
                        '<StatusPlaceHolder/>',
                        display_str
                    );

                    content_modified = true;
                } else {
                    //如果没有，则固定插入到文本尾部
                    const display_str = '<StatusPlaceHolderImpl/>'; //status_entry.content;
                    current_message_content += '\n\n' + display_str;
                    content_modified = true;
                }
            }
        }

        if (content_modified) {
            console.info(`Replace content....`);
            //@ts-ignore
            await setChatMessage({ message: current_message_content }, last_message, {
                refresh: 'display_and_render_current',
            });
        }
    }

    //eventRemoveListener(tavern_events.GENERATION_ENDED, hello);
}
