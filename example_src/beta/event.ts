// =================================================================================
// 脚本事件监听器注册
// =================================================================================
// 以下代码将自定义的函数绑定到变量更新流程的三个关键事件点：
// 1. 'mag_variable_update_started': 在变量更新开始前触发。
// 2. 'mag_variable_updated': 每当一个变量被 _.set 等命令成功修改时触发。
// 3. 'mag_variable_update_ended': 在变量更新命令执行完毕后触发。
eventOn('mag_variable_update_started', variableUpdateStarted)
eventOn('mag_variable_updated', variableUpdated)
eventOn('mag_variable_update_ended', variableUpdateEnded)


// =================================================================================
// 全局变量和常量定义
// =================================================================================

// 获取用户的唯一标识符，通常是 "<user>"，用于动态构建变量路径。
const userKey = substitudeMacros('<user>');

// 用于存储上一次更新时的状态，以便进行比较和计算变化。
let last_time_str = "";           // 上一次更新时的“当前时间”字符串
let is_time_reversed = false;       // 标记本次更新是否发生了时间回溯

// 用于在更新周期内“保护”某些不应被AI直接修改的变量。
// 在更新开始时保存它们的值，在更新结束时恢复它们。
let saved_days_passed = null;
let saved_erosion_intensity = null;
let saved_erosion_depth = null;
let saved_user_age = null;
let saved_mobi_age = null;
let saved_uterus_filling = null;
let saved_uterus_filling_new = null; // 用于临时记录AI更新后的子宫填充度


// =================================================================================
// 辅助工具函数
// =================================================================================

/**
 * 将形如 "YYYY-MM-DD" 的日期字符串解析为 Date 对象。
 * @param {string} dateStr - 日期字符串。
 * @returns {Date} 解析后的 Date 对象。
 */
function parseDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day); // 注意：JS的月份是从0开始的
}

/**
 * 将形如 "YYYY-MM-DD hh:mm" 的完整时间字符串解析为 Date 对象。
 * @param {string} timeStr - 完整时间字符串。
 * @returns {Date} 解析后的 Date 对象。
 */
function parseTime(timeStr) {
    const [datePart, timePart] = timeStr.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);
    return new Date(year, month - 1, day, hour, minute);
}

/**
 * 计算两个 Date 对象之间相差的完整天数。
 * @param {Date} date1 - 开始日期。
 * @param {Date} date2 - 结束日期。
 * @returns {number} 相差的天数。
 */
function daysBetween(date1, date2) {
    const oneDay = 24 * 60 * 60 * 1000; // 一天的毫秒数
    return Math.floor((date2 - date1) / oneDay);
}

/**
 * 根据亲密度计算侵蚀强度。这是一个自定义的数学公式。
 * @param {number} intimacy - 亲密度值。
 * @returns {number | null} 计算出的侵蚀强度，如果输入无效则返回 null。
 */
function calculateErosionIntensity(intimacy) {
    if (intimacy === null || intimacy === undefined) return null;
    return Math.pow(8, intimacy) * (Math.sin(0.5 * Math.PI * intimacy) + 1);
}

/**
 * 模拟两种物质浓度随时间趋于平衡的过程。
 * @param {number} A - 物质A的初始浓度/值。
 * @param {number} B - 物质B的初始浓度/值。
 * @param {number} k - 反应速率常数。
 * @param {number} t - 反应时间。
 * @returns {[number, number]} 反应后物质A和B的新浓度/值。
 */
function calculateConcentrations(A, B, k, t) {
    const total = A + B;
    const equilibrium = total / 2;
    const exponent = Math.exp(-2 * k * t);
    const B_new = equilibrium - (A - B) / 2 * exponent;
    const A_new = total - B_new;
    return [A_new, B_new];
}


// =================================================================================
// 事件处理函数：更新开始 (variableUpdateStarted)
// =================================================================================

/**
 * 在每次变量更新流程开始时被调用。
 * 主要作用是：
 * 1. 记录更新前的状态（如时间）。
 * 2. 重置标记位（如时间回溯标记）。
 * 3. “备份”那些需要被保护、不应被AI随意修改的变量的值。
 * @param {object} variables - 完整的变量对象。
 * @param {boolean} out_is_updated - 一个标志，此脚本可以通过将其设为 true 来通知系统有变量被修改。
 */
function variableUpdateStarted(variables, out_is_updated) {
    // 获取并保存更新前的“当前时间”，用于后续比较。
    const current_time_str = variables.stat_data.当前时间[0];
    last_time_str = current_time_str;
    
    // 重置时间回溯标记。
    is_time_reversed = false;
    
    // 确保 out_is_updated 标志有一个初始值。
    out_is_updated = out_is_updated || false;
    
    // 检查“莫比乌斯残响”这个知识库是否已被初始化。
    // 这用于判断是否是游戏的第一次更新。如果不是第一次，才执行变量保护逻辑。
    if (variables.initialized_lorebooks.莫比乌斯残响[0] !== undefined) {
        // 保存一系列核心游戏状态变量，防止AI在对话中意外或不合逻辑地修改它们。
        // 这些值将在 variableUpdateEnded 函数中被恢复。
	    saved_days_passed = variables.stat_data.经历天数[0];
        saved_erosion_intensity = variables.stat_data[userKey].侵蚀强度[0];
        saved_erosion_depth = variables.stat_data[userKey].侵蚀深度[0];
        saved_user_age = variables.stat_data[userKey].发育年龄[0];
        saved_mobi_age = variables.stat_data.莫比.发育年龄[0];
        saved_uterus_filling = variables.stat_data.莫比.子宫填充度[0];
    }
}


// =================================================================================
// 事件处理函数：单个变量更新时 (variableUpdated)
// =================================================================================

/**
 * 在每个变量被AI的 _.set/alter 等命令修改后，立即被调用。
 * 主要用于：
 * 1. 实时监测特定变量的变化。
 * 2. 根据变化设置一些标记位（如 is_time_reversed）。
 * 3. 允许某些特定的修改通过（例如，将侵蚀强度设为 null 是一个合法的游戏操作）。
 * @param {object} _stat_data - 当前的 stat_data 对象。
 * @param {string} path - 被修改变量的路径。
 * @param {*} _oldValue - 变量的旧值。
 * @param {*} _newValue - 变量的新值。
 */
function variableUpdated(_stat_data, path, _oldValue, _newValue) {
    // 监视“当前时间”的变化。
    if (path === '当前时间[0]') {
        const oldDate = parseDate(_oldValue.split(' ')[0]);
        const newDate = parseDate(_newValue.split(' ')[0]);
        // 如果新日期的天数比旧日期早，说明发生了时间回溯。
        if (newDate < oldDate) {
            is_time_reversed = true;
        }
    }
    
    // 允许AI将“侵蚀强度”设置为 null。这是一个特殊的游戏逻辑出口。
    if (path === `${userKey}.侵蚀强度[0]` && _newValue === null) {
        saved_erosion_intensity = null;
    }
    
    // 允许AI将“侵蚀深度”重置为 0 或设置为 null。
    if (path === `${userKey}.侵蚀深度[0]` && (_newValue === 0 || _newValue === null)) {
        saved_erosion_depth = _newValue;
    }
    
    // 临时记录AI对“子宫填充度”的更新，用于后续在 variableUpdateEnded 中进行调整。
    if (path === '莫比.子宫填充度[0]') {
        saved_uterus_filling_new = _newValue;
    }
}


// =================================================================================
// 事件处理函数：更新结束 (variableUpdateEnded)
// =================================================================================

/**
 * 在所有AI的变量更新命令都执行完毕后被调用。
 * 这是本脚本的核心逻辑所在，负责：
 * 1. 恢复之前备份的受保护变量，覆盖AI的修改。
 * 2. 根据时间变化，自动计算和更新衍生变量（如经历天数、侵蚀深度等）。
 * 3. 应用复杂的游戏规则和数学模型。
 * @param {object} variables - 经过AI修改后的变量对象。
 * @param {boolean} out_is_updated - 一个标志，此脚本可以通过将其设为 true 来通知系统有变量被修改。
 */
function variableUpdateEnded(variables, out_is_updated) {
    const current_time_str = variables.stat_data.当前时间[0];
    const current_date_str = current_time_str.split(' ')[0];
    const current_time = parseTime(current_time_str);
    
    // 再次检查是否是初次更新。
    if (variables.initialized_lorebooks.莫比乌斯残响[0] !== undefined) {
        // 恢复所有受保护的变量，确保它们不被AI的直接输出所改变。
        if (saved_days_passed !== undefined) {
            variables.stat_data.经历天数[0] = saved_days_passed;
        }
        if (saved_erosion_intensity !== undefined) {
            variables.stat_data[userKey].侵蚀强度[0] = saved_erosion_intensity;
        }
        if (saved_erosion_depth !== undefined) {
            variables.stat_data[userKey].侵蚀深度[0] = saved_erosion_depth;
        }
        if (saved_user_age !== undefined) {
            variables.stat_data[userKey].发育年龄[0] = saved_user_age;
        }
        if (saved_mobi_age !== undefined) {
            variables.stat_data.莫比.发育年龄[0] = saved_mobi_age;
        }
    }
	
    // === 自动更新“经历天数” ===
    if (last_time_str && !isNaN(current_time)) {
        const last_date_str = last_time_str.split(' ')[0];
        const last_date = parseDate(last_date_str);
        const current_date = parseDate(current_date_str);
        // 仅在时间前进时才增加天数。
        if (!is_time_reversed) {
            const days_passed = daysBetween(last_date, current_date);
            if (days_passed > 0) {
                variables.stat_data.经历天数[0] += days_passed;
                out_is_updated = true; // 标记变量已被此脚本修改
            }
        }
    }
    
    // === 自动更新“侵蚀强度”和“侵蚀深度” ===
    // 仅在它们不为 null 时（即在时隙之境内）才进行计算。
    if (saved_erosion_intensity !== null && saved_erosion_depth !== null) {
        // 根据亲密度重新计算当前的侵蚀强度。
        const intimacy = variables.stat_data.莫比.亲密度[0];
        const erosion_intensity = calculateErosionIntensity(intimacy);
        variables.stat_data[userKey].侵蚀强度[0] = erosion_intensity;
        out_is_updated = true;
        
        // 根据流逝的时间和侵蚀强度，增加侵蚀深度。
        if (last_time_str && !isNaN(current_time)) {
            const last_time = parseTime(last_time_str);
            const time_diff_ms = current_time - last_time;
            if (time_diff_ms > 0) { // 仅在时间前进时增加
                let current_depth = variables.stat_data[userKey].侵蚀深度[0] || 0;
                const depth_increase = time_diff_ms * erosion_intensity * 1.28e-9; // 1.28e-9 是自定义的增长系数
                current_depth = Math.min(1, Math.max(0, current_depth + depth_increase)); // 确保值在 [0, 1] 区间
                variables.stat_data[userKey].侵蚀深度[0] = current_depth;
                out_is_updated = true;
            }
        }
    }
    
    // === 调整AI对“子宫填充度”的更新 ===
    // 如果AI增加了填充度，则根据莫比的年龄对其增加量进行缩放调整。
    if (saved_uterus_filling !== null && saved_uterus_filling_new !== null && saved_uterus_filling < saved_uterus_filling_new) {
        const mobi_age = variables.stat_data.莫比.发育年龄[0];
        const increase_amount = (saved_uterus_filling_new - saved_uterus_filling) / (mobi_age / 10);
        let current_fill = saved_uterus_filling || 0;
        current_fill = Math.min(1, Math.max(0, current_fill + increase_amount));
        variables.stat_data.莫比.子宫填充度[0] = current_fill;
        out_is_updated = true;
    }
	
    // === “子宫填充度”的内部逻辑调整 ===
    // 如果AI减少了填充度，则无视该操作，恢复原值。
    if (saved_uterus_filling !== null && saved_uterus_filling_new !== null && saved_uterus_filling > saved_uterus_filling_new) {
        variables.stat_data.莫比.子宫填充度[0] = saved_uterus_filling;
    }
    // 根据流逝的时间，让填充度自然减少。
    if (last_time_str && !isNaN(current_time)) {
        const last_time = parseTime(last_time_str);
        const time_diff_ms = current_time - last_time;
        if (time_diff_ms > 0) {
            let current_fill = variables.stat_data.莫比.子宫填充度[0] || 0;
            const mobi_age = variables.stat_data.莫比.发育年龄[0];
            const fill_decrease = (1 + current_fill) * time_diff_ms * 9e-9 * (mobi_age / 10); // 自定义的减少公式
            current_fill = Math.min(1, Math.max(0, current_fill - fill_decrease));
            variables.stat_data.莫比.子宫填充度[0] = current_fill;
            out_is_updated = true;
        }
    }
    
    // === 自动更新“发育年龄” ===
    // 仅在时隙之境内，根据时间流逝和侵蚀强度，让用户和莫比的年龄相互趋近。
    if (saved_erosion_intensity !== null && saved_erosion_depth !== null && last_time_str && !isNaN(current_time)) {
        const last_time = parseTime(last_time_str);
        const time_diff_ms = current_time - last_time;
        if (time_diff_ms > 0) {
            const k = 1.33e-9; // 年龄同步速率常数
            const [new_user_age, new_mobi_age] = calculateConcentrations(
                variables.stat_data[userKey].发育年龄[0],
                variables.stat_data.莫比.发育年龄[0],
                k,
                time_diff_ms * variables.stat_data[userKey].侵蚀强度[0]
            );
            variables.stat_data[userKey].发育年龄[0] = new_user_age;
            variables.stat_data.莫比.发育年龄[0] = new_mobi_age;
            out_is_updated = true;
        }
    }

    // === 数据校正 ===
    // 确保亲密度值始终在 [0, 1] 的有效范围内。
    variables.stat_data.莫比.亲密度[0] = Math.min(1, Math.max(0, variables.stat_data.莫比.亲密度[0]));
    
    // 确保 out_is_updated 标志最终有一个布尔值。
    out_is_updated = out_is_updated || false;
    // 重置临时变量，为下一次更新做准备。
    saved_uterus_filling_new = null;
}