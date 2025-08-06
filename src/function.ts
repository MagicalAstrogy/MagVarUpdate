import { variable_events, VariableData } from '@/variable_def';

export function trimQuotesAndBackslashes(str: string): string {
    if (!_.isString(str)) return str;
    // Regular expression to match backslashes and quotes (including backticks) at the beginning and end
    return str.replace(/^[\\"'` ]*(.*?)[\\"'` ]*$/, '$1');
}

/**
 * 从大字符串中提取所有 .set(${path}, ${new_value});//${reason} 格式的模式
 * 并解析出每个匹配项的路径、新值和原因部分
 */
interface SetCommand {
    fullMatch: string;
    path: string;
    oldValue: string;
    newValue: string;
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
export function extractSetCommands(inputText: string): SetCommand[] {
    const results: SetCommand[] = [];
    let i = 0;

    while (i < inputText.length) {
        // 步骤1: 查找 _.set( 的起始位置
        const setStart = inputText.indexOf('_.set(', i);
        if (setStart === -1) break;

        // 步骤2: 定位开始括号
        const openParen = setStart + 6; // '_.set(' 的长度

        // 步骤3: 使用括号配对算法找到对应的闭括号
        // 这个算法会正确处理引号内的括号，避免误匹配
        const closeParen = findMatchingCloseParen(inputText, openParen);
        if (closeParen === -1) {
            // 如果找不到匹配的闭括号，跳过这个位置继续查找
            i = openParen + 1;
            continue;
        }

        // 步骤4: 检查闭括号后是否紧跟分号（_.set()调用的标准格式）
        let endPos = closeParen + 1;
        if (endPos < inputText.length && inputText[endPos] === ';') {
            endPos++;

            // 步骤5: 处理可能的注释部分
            // 跳过分号后的空格
            while (endPos < inputText.length && inputText[endPos] === ' ') {
                endPos++;
            }

            // 检查是否有 // 注释
            let comment = '';
            if (
                endPos + 1 < inputText.length &&
                inputText[endPos] === '/' &&
                inputText[endPos + 1] === '/'
            ) {
                // 找到注释的结束位置（换行符或文本结束）
                const commentEnd = inputText.indexOf('\n', endPos);
                if (commentEnd !== -1) {
                    comment = inputText.substring(endPos + 2, commentEnd).trim();
                    endPos = commentEnd;
                } else {
                    // 注释延续到文本结尾
                    comment = inputText.substring(endPos + 2).trim();
                    endPos = inputText.length;
                }
            }

            // 步骤6: 提取参数并解析
            const paramsString = inputText.substring(openParen, closeParen);
            const fullMatch = inputText.substring(setStart, endPos);

            // 使用 parseParameters 解析参数，它能正确处理嵌套的数组、对象和引号
            const params = parseParameters(paramsString);

            // 步骤7: 根据参数数量构建结果
            if (params.length >= 3) {
                // 标准格式：_.set(path, oldValue, newValue)
                results.push({
                    fullMatch: fullMatch,
                    path: trimQuotesAndBackslashes(params[0]),
                    oldValue: trimQuotesAndBackslashes(params[1]),
                    newValue: trimQuotesAndBackslashes(params[2]),
                    reason: comment,
                });
            } else if (params.length === 2) {
                // 简化格式：_.set(path, value)
                // 在这种情况下，oldValue 和 newValue 都设为相同的值
                results.push({
                    fullMatch: fullMatch,
                    path: trimQuotesAndBackslashes(params[0]),
                    oldValue: trimQuotesAndBackslashes(params[1]),
                    newValue: trimQuotesAndBackslashes(params[1]),
                    reason: comment,
                });
            }

            // 更新搜索位置，继续查找下一个 _.set() 调用
            i = endPos;
        } else {
            // 如果没有分号，跳过这个位置
            i = closeParen + 1;
        }
    }

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
export function parseParameters(paramsString: string): string[] {
    const params: string[] = [];
    let currentParam = '';
    let inQuote = false;
    let quoteChar = '';
    let bracketCount = 0;
    let braceCount = 0;

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

        // 处理方括号 (数组)
        if (char === '[') bracketCount++;
        if (char === ']') bracketCount--;

        // 处理花括号 (对象)
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;

        // 处理参数分隔符
        if (char === ',' && !inQuote && bracketCount === 0 && braceCount === 0) {
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
    return (
        structuredClone(
            _(SillyTavern.chat)
                .slice(0, message_id + 1)
                .map(chat_message => _.get(chat_message, ['variables', chat_message.swipe_id ?? 0]))
                .findLast(variables => _.has(variables, 'stat_data'))
        ) ?? getVariables()
    );
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

export async function updateVariables(
    current_message_content: string,
    variables: any
): Promise<boolean> {
    const out_is_modifed = false;
    await eventEmit(variable_events.VARIABLE_UPDATE_STARTED, variables, out_is_modifed);
    const out_status: Record<string, any> = _.cloneDeep(variables);
    const delta_status: Record<string, any> = { stat_data: {} };
    const matched_set = extractSetCommands(current_message_content);
    let variable_modified = false;
    for (const setCommand of matched_set) {
        let { path, newValue, reason } = setCommand;
        path = pathFix(path);

        if (_.has(variables.stat_data, path)) {
            const currentValue = _.get(variables.stat_data, path);
            //有时候llm会返回整个数组，处理它
            if (
                _.isString(newValue) &&
                newValue.trim().startsWith('[') &&
                newValue.trim().endsWith(']')
            ) {
                try {
                    const parsedArray = YAML.parse(newValue);
                    if (Array.isArray(parsedArray) && parsedArray.length > 0) {
                        newValue = parsedArray[0];
                    }
                } catch (error: any) {
                    console.error(`Error parsing JSON array for '${path}': ${error.message}`);
                }
            }
            // Check the type of the current value
            if (typeof currentValue === 'number') {
                // If the current value is a number, convert the new value to a number
                const newValueNumber = Number(newValue);
                const oldValue = currentValue;
                _.set(variables.stat_data, path, newValueNumber);
                const reason_str = reason ? `(${reason})` : '';
                const display_str = `${oldValue}->${newValueNumber} ${reason_str}`;
                _.set(out_status.stat_data, path, display_str);
                _.set(delta_status.stat_data, path, display_str);
                variable_modified = true;
                console.info(`Set '${path}' to '${newValueNumber}' ${reason_str}`);
                await eventEmit(
                    variable_events.SINGLE_VARIABLE_UPDATED,
                    variables.stat_data,
                    path,
                    oldValue,
                    newValueNumber
                );
            } else if (Array.isArray(currentValue) && currentValue.length === 2) {
                // If the current value is of type ValueWithDescription<T>
                const newValueParsed =
                    typeof currentValue[0] === 'number'
                        ? Number(newValue)
                        : trimQuotesAndBackslashes(newValue);
                const oldValue = _.cloneDeep(currentValue[0]);
                currentValue[0] = newValueParsed;
                _.set(variables.stat_data, path, currentValue);
                const reason_str = reason ? `(${reason})` : '';
                const display_str = `${trimQuotesAndBackslashes(JSON.stringify(oldValue))}->${trimQuotesAndBackslashes(JSON.stringify(newValue))} ${reason_str}`;
                _.set(out_status.stat_data, path, display_str);
                _.set(delta_status.stat_data, path, display_str);
                variable_modified = true;
                console.info(
                    `Set '${path}' to '${trimQuotesAndBackslashes(JSON.stringify(newValueParsed))}' ${reason_str}`
                );
                // Call the onVariableUpdated function after updating the variable
                await eventEmit(
                    variable_events.SINGLE_VARIABLE_UPDATED,
                    variables.stat_data,
                    path,
                    oldValue,
                    newValueParsed
                );
            } else {
                // Otherwise, set the new value directly
                const trimmedNewValue = trimQuotesAndBackslashes(newValue);
                const oldValue = _.cloneDeep(currentValue);
                _.set(variables.stat_data, path, trimmedNewValue);
                const reason_str = reason ? `(${reason})` : '';
                const stringNewValue = trimQuotesAndBackslashes(JSON.stringify(trimmedNewValue));
                const display_str = `${trimQuotesAndBackslashes(JSON.stringify(oldValue))}->${stringNewValue} ${reason_str}`;
                _.set(out_status.stat_data, path, display_str);
                _.set(delta_status.stat_data, path, display_str);
                variable_modified = true;
                console.info(`Set '${path}' to '${stringNewValue}' ${reason_str}`);
                await eventEmit(
                    variable_events.SINGLE_VARIABLE_UPDATED,
                    variables.stat_data,
                    path,
                    oldValue,
                    trimmedNewValue
                );
            }
        } else {
            const display_str = `undefined Path: ${path}->${newValue} (${reason})`;
            console.error(display_str);
        }
    }

    variables.display_data = out_status.stat_data;
    variables.delta_data = delta_status.stat_data;
    await eventEmit(variable_events.VARIABLE_UPDATE_ENDED, variables, out_is_modifed);
    return variable_modified || out_is_modifed;
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

    const has_variable_modified = await updateVariables(message_content, variables);
    if (has_variable_modified) {
        const chat_variables = getVariables({ type: 'chat' });
        // _.merge 可能使变量无法被正常移除，因此使用赋值的方式
        chat_variables.stat_data = variables.stat_data;
        chat_variables.display_data = variables.display_data;
        chat_variables.delta_data = variables.delta_data;
        chat_variables.initialized_lorebooks = variables.initialized_lorebooks;
        await replaceVariables(chat_variables, { type: 'chat' });
    }
    await insertOrAssignVariables(
        {
            stat_data: variables.stat_data,
            display_data: variables.display_data,
            delta_data: variables.delta_data,
            initialized_lorebooks: variables.initialized_lorebooks,
        },
        { type: 'message', message_id: message_id }
    );

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

export async function handleVariablesInCallback(
    message_content: string,
    variable_info: VariableData
) {
    if (variable_info.old_variables === undefined) {
        return;
    }
    variable_info.new_variables = _.cloneDeep(variable_info.old_variables);
    const variables = variable_info.new_variables;

    const modified = await updateVariables(message_content, variables);
    //如果没有修改，则不产生 newVariable
    if (!modified) delete variable_info.new_variables;
}
