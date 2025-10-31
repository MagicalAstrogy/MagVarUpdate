import MvuData = Mvu.MvuData;
import { CommandInfo } from '../../artifact/export_globals';
import { UpdateContext } from '../../artifact/export_globals';

eventOn('mag_variable_update_started', variableUpdateStarted);
eventOn('mag_variable_updated', variableUpdated);
eventOn('mag_variable_update_ended', variableUpdateEnded);
eventOn('mag_command_parsed', commandParsed);
eventOn('mag_variable_initialized', variableInitialized);
eventOn('mag_before_message_update', beforeMessageUpdate);

/**
 * Represents the last date in a specific context or operation.
 * This variable is intended to store a date value, typically in string format.
 * It may remain empty initially or until the appropriate value is assigned.
 */
let last_date = '';
/**
 * A boolean variable that indicates whether a day has passed.
 *
 * When set to true, it signifies that a day has elapsed.
 * When set to false, it indicates that the day has not yet passed.
 */
let is_day_passed = false;

function beforeMessageUpdate(context: UpdateContext) {
    const data: Record<string, any> = context.variables;
    context.message_content += `\n\n理现在心里想着:${data.stat_data.理.当前所想[0]}`;
}

function variableInitialized(variables: Record<string, any> & MvuData, swipe_id: number) {
    //将不同开局的 test_data 变量，设置为那个开局对应的 swipe_id
    variables['test_data'] = swipe_id;
}

function commandParsed(_variables: MvuData, commands: CommandInfo[], message_content: string) {
    // 移除所有对 教堂.desc1 的修改
    _.remove(commands, cmd => {
        if (cmd.type == 'set') {
            if (cmd.args[0].indexOf(`教堂.desc1`) !== -1) return true;
        }
        return false;
    });

    if (message_content) {
        //解析所有 <JsonPatch> 块内的内容，视为一个有效的json
        // 免责声明：下面代码仅供功能演示用，不对健壮性做保证。
        const jsonPatchRegex = /<JsonPatch>([\s\S]*?)<\/JsonPatch>/gi;
        const decodePointerSegment = (segment: string): string =>
            segment.replace(/~1/g, '/').replace(/~0/g, '~');
        const pointerToSegments = (pointer: string): string[] => {
            const normalized = pointer.startsWith('/') ? pointer.slice(1) : pointer;
            if (!normalized) return [];
            return normalized.split('/').map(decodePointerSegment);
        };
        const segmentsToPath = (segments: string[]): string => {
            if (segments.length === 0) return '';
            return segments.reduce((acc, segment, index) => {
                const isIndex = /^\d+$/.test(segment);
                if (index === 0) {
                    return isIndex ? segment : segment;
                }
                return acc + (isIndex ? `[${segment}]` : `.${segment}`);
            }, '');
        };
        const toJSONString = (value: unknown): string | undefined => JSON.stringify(value);

        let match: RegExpExecArray | null;
        while ((match = jsonPatchRegex.exec(message_content)) !== null) {
            const rawContent = match[1].trim();
            if (!rawContent) continue;

            let operations: any[] = [];
            try {
                const parsed = JSON.parse(rawContent);
                operations = Array.isArray(parsed) ? parsed : [parsed];
            } catch (error) {
                console.warn('[JsonPatch] Failed to parse patch block:', error);
                continue;
            }

            for (const op of operations) {
                if (!op || typeof op !== 'object') continue;
                const {
                    op: opcode,
                    path,
                    value,
                    reason,
                    comment,
                } = op as {
                    op?: string;
                    path?: string;
                    value?: unknown;
                    reason?: string;
                    comment?: string;
                };
                if (!opcode) continue;
                const segments = pointerToSegments(path ?? '');
                const normalizedSegments =
                    segments[0] === 'stat_data' ? segments.slice(1) : segments;
                const fullPath = segmentsToPath(normalizedSegments);
                const opReason =
                    typeof reason === 'string'
                        ? reason
                        : typeof comment === 'string'
                          ? comment
                          : 'JsonPatch';
                const fullMatch = `<JsonPatch>${rawContent}</JsonPatch>`;

                switch (opcode) {
                    case 'replace': {
                        if (!path || normalizedSegments.length === 0) continue;
                        const pathLiteral = toJSONString(fullPath);
                        const valueLiteral = substitudeMacros(toJSONString(value) ?? '');
                        if (pathLiteral === undefined || valueLiteral === undefined) continue;
                        commands.push({
                            type: 'set',
                            full_match: fullMatch,
                            args: [pathLiteral, valueLiteral],
                            reason: opReason,
                        });
                        break;
                    }
                    case 'add': {
                        if (!path || normalizedSegments.length === 0) continue;
                        const lastSegment = normalizedSegments[normalizedSegments.length - 1];
                        const parentSegments =
                            lastSegment === undefined
                                ? normalizedSegments
                                : normalizedSegments.slice(0, -1);
                        const parentPath = segmentsToPath(parentSegments);
                        const parentLiteral = toJSONString(parentPath);
                        const valueLiteral = toJSONString(value);
                        if (parentLiteral === undefined || valueLiteral === undefined) continue;

                        if (lastSegment === '-') {
                            commands.push({
                                type: 'insert',
                                full_match: fullMatch,
                                args: [parentLiteral, valueLiteral],
                                reason: opReason,
                            });
                        } else if (/^\d+$/.test(lastSegment ?? '')) {
                            const indexLiteral = JSON.stringify(Number(lastSegment));
                            commands.push({
                                type: 'insert',
                                full_match: fullMatch,
                                args: [parentLiteral, indexLiteral, valueLiteral],
                                reason: opReason,
                            });
                        } else {
                            const keyLiteral = toJSONString(lastSegment ?? '');
                            if (keyLiteral === undefined) continue;
                            commands.push({
                                type: 'insert',
                                full_match: fullMatch,
                                args: [parentLiteral, keyLiteral, valueLiteral],
                                reason: opReason,
                            });
                        }
                        break;
                    }
                    case 'remove': {
                        if (!path || normalizedSegments.length === 0) continue;
                        const pathLiteral = toJSONString(fullPath);
                        if (pathLiteral === undefined) continue;
                        commands.push({
                            type: 'unset',
                            full_match: fullMatch,
                            args: [pathLiteral],
                            reason: opReason,
                        } as unknown as CommandInfo);
                        break;
                    }
                    default:
                        break;
                }
            }
        }
    }
}

/**
 * Converts a time string in the format "HH:MM" to a numeric representation.
 *
 * @param {string} timeStr - The time string to be parsed, expected in "HH:MM" format.
 * @return {number} The numeric representation of the time, where hours are in the hundreds place
 *                  and minutes are in the units place (e.g., "14:30" becomes 1430).
 */
function parseTimeToNumber(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 100 + (minutes || 0);
}

/**
 * Handles the start of a variable update process and evaluates if a day has passed
 * since the last update.
 *
 * @param {Record<string, any>} variables - A record containing variable data, expected to include a 'stat_data' property.
 * @return {void} This function does not return a value but instead updates relevant state.
 */
function variableUpdateStarted(variables: MvuData) {
    last_date = variables.stat_data.日期[0];
    is_day_passed = false;
}

/**
 * Handles the update of a variable and performs specific actions when certain
 * conditions are met, such as detecting the start of a new day based on time changes.
 *
 * @param {Record<string, any>} _stat_data - The data structure containing the variables being updated.
 * @param {string} path - The path or key identifying the specific variable being updated.
 * @param {any} _oldValue - The previous value of the variable before the update.
 * @param {any} _newValue - The new value of the variable after the update.
 * @return {void} Does not return anything.
 */
function variableUpdated(
    _stat_data: Record<string, any>,
    path: string,
    _oldValue: any,
    _newValue: any
) {
    if (path == '时间') {
        const timeNumber = parseTimeToNumber(_newValue);
        const oldTime = parseTimeToNumber(_oldValue);
        //当时间变小时，就代表新的一天来临了
        if (timeNumber < oldTime) {
            is_day_passed = true;
        }
    }
}

/**
 * Calculates the next date given a date string in the format "X月Y日".
 *
 * @param {string} dateStr - The input date string formatted as "X月Y日".
 * @return {string} The next date in the format "X月Y日".
 */
function nextDate(dateStr: string): string {
    // 移除末尾的"日"字，并分割月份和日期
    const [month, day] = dateStr.replace('日', '').split('月');
    let nextMonth = parseInt(month);
    let nextDay = parseInt(day);

    nextDay++;
    const daysInMonth = [31, 31, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    if (nextDay > daysInMonth[nextMonth - 1]) {
        nextDay = 1;
        nextMonth++;
        if (nextMonth > 12) {
            nextMonth = 1;
        }
    }

    // 返回时需要加上"日"后缀
    return `${nextMonth}月${nextDay}日`;
}

/**
 * Finalizes the variable update by checking conditions and potentially updating the date fields within the provided variables object.
 * Adjusts the display data and modifies a flag indicating whether an update occurred.
 *
 * @param {Record<string, any>} variables - The object containing state and display-related data that may be updated.
 * @return {void} This function does not return a value, but it updates the provided variables and modifies out_is_updated accordingly.
 */
function variableUpdateEnded(variables: MvuData) {
    if (!is_day_passed) return;
    if (variables.stat_data.日期[0] == last_date) {
        // 日期字符串必须包含"日"字作为后缀，例如"1月1日"
        //llm 没有自动推进日期，通过代码辅助他推进
        var new_date = nextDate(last_date);
        variables.stat_data.日期[0] = new_date;
        const display_str = `${last_date}->${new_date}(日期推进)`;
        variables.display_data.日期 = display_str;
    }
}
