eventOn('mag_variable_update_started', variableUpdateStarted)
eventOn('mag_variable_updated', variableUpdated)
eventOn('mag_variable_update_ended', variableUpdateEnded)

/**
 * Represents the last date in a specific context or operation.
 * This variable is intended to store a date value, typically in string format.
 * It may remain empty initially or until the appropriate value is assigned.
 */
let last_date = "";
/**
 * A boolean variable that indicates whether a day has passed.
 *
 * When set to true, it signifies that a day has elapsed.
 * When set to false, it indicates that the day has not yet passed.
 */
let is_day_passed = false;

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
 * @param {boolean} out_is_updated - A flag indicating whether updates have already occurred prior to this call.
 * @return {void} This function does not return a value but instead updates relevant state.
 */
function variableUpdateStarted(variables : Record<string, any>, out_is_updated: boolean)
{
    last_date = variables.stat_data.日期[0];
    is_day_passed = false;
    if (!_.has(variables,'stat_data.终'))
    {
        variables.stat_data.终 = variables.stat_data.理;
        delete variables.stat_data.理;
    }
    if (_.has(variables,'stat_data.终.重要物品'))
    {
        const val : string = variables.stat_data.终.重要物品[0];
        if (val.indexOf('小匣') !== -1)
        {
            if (variables.stat_data.终.余命[1].indexOf("开始模糊") !== -1)
            {
                variables.stat_data.终.余命[1] = "获得了 星鎖の小匣 后，终的存在之力稳定下来了，不会因为时间而减少。终感受到了源自宝具的生命的实感，就算是原本悲伤的愿望，现在也被赋予了希望的诠释。";
                variables.stat_data.终.愿望["16"].description = "【细节动作】她仍陪你走完最后 300 米；行至钟塔阴影尽头，她在你耳边轻声：“爱是火，而你是我的余烬。”——这一回，她的声线坚定而带笑。钟声 09:00 刚敲响，阳光掠过树梢照进小巷，她的身影没有再淡去，反而在光里凝成清晰轮廓；银链裂纹瞬间愈合，像熔金重新焊接。她抬起指尖按在你胸口，仿佛要让那句低语永远烙进心跳。 【目的&情绪】存在稳定 & 永恒誓言：终确认自己不会再消散，告白升级为携手未来的宣言——“火焰因你而持续，余烬是守护而非终结。”她笑着说：‘如果爱是火，那余烬就是不灭的心室；谢谢你，让我在这里继续燃烧。’ "
                variables.stat_data.终.愿望["15"].description = "【细节动作】万圣装饰刚被店员收进纸箱，你点了两杯黑咖啡，这次店员如常递来两只杯碟；她坐在对面，身影在晨光里清晰可见，指尖轻触杯沿的蒸汽。啜饮之际，她依旧对你微笑——“请记得今天的苦味。”语调温柔，却带着与昨夜截然不同的踏实：那苦味不再预示遗忘，而是提醒你们经历过的恐惧与重生。她把糖包推到你面前，却把自己的咖啡保持原味，示意要把这份纯粹的苦留下来，当作幸存的印记。她低声补充：‘苦味会在记忆里慢慢回甘，就像我们的火焰，再也不会熄灭。’"

                out_is_updated = true;
            }
        }
    }
    out_is_updated = out_is_updated || false;
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
function variableUpdated(_stat_data: Record<string, any>, path: string, _oldValue: any, _newValue: any)
{
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
 * @param {boolean} out_is_updated - A flag indicating whether the variables were updated during the process.
 * @return {void} This function does not return a value, but it updates the provided variables and modifies out_is_updated accordingly.
 */
function variableUpdateEnded(variables: Record<string, any>, out_is_updated: boolean) {
    if (!is_day_passed)
        return;
    if (variables.stat_data.日期[0] == last_date) {
        // 日期字符串必须包含"日"字作为后缀，例如"1月1日"
        //llm 没有自动推进日期，通过代码辅助他推进
        const new_date = nextDate(last_date);
        variables.stat_data.日期[0] = new_date;
        const display_str = `${last_date}->${new_date}(日期推进)`;
        variables.display_data.日期 = display_str;
        out_is_updated = true;
    }
    out_is_updated = out_is_updated || false;
}
