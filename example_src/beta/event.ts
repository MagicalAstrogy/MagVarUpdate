// =================================================================================
// 本卡的动态逻辑实现方法和《圣女理理》区别不大，关键在于添加了根据世界书初始化状态进行更新屏蔽的逻辑，没有注释标注的部分仅供参考，此脚本中的注释仅解释此次更新新增的功能用例。
// =================================================================================
eventOn('mag_variable_update_started', variableUpdateStarted)
eventOn('mag_variable_updated', variableUpdated)
eventOn('mag_variable_update_ended', variableUpdateEnded)

const userKey = substitudeMacros('<user>');

let last_time_str = "";
let is_time_reversed = false;

// 用于在更新周期内“保护”某些不应被AI直接修改的变量。
// 在更新开始时保存它们的值，在更新结束时恢复它们。
// --- 这个逻辑在将initialized_lorebooks改为对象之后变得容易实现了，旧版本中若要实现类似的逻辑也可以，但非常牵强，需要考虑会不会占用其他世界书的索引 ---
let saved_days_passed = null;
let saved_erosion_intensity = null;
let saved_erosion_depth = null;
let saved_user_age = null;
let saved_mobi_age = null;
let saved_uterus_filling = null;
let saved_uterus_filling_new = null;

function parseDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
}
function parseTime(timeStr) {
    const [datePart, timePart] = timeStr.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);
    return new Date(year, month - 1, day, hour, minute);
}

function daysBetween(date1, date2) {
    const oneDay = 24 * 60 * 60 * 1000;
    return Math.floor((date2 - date1) / oneDay);
}

function calculateErosionIntensity(intimacy) {
    if (intimacy === null || intimacy === undefined) return null;
    return Math.pow(8, intimacy) * (Math.sin(0.5 * Math.PI * intimacy) + 1);
}

function calculateConcentrations(A, B, k, t) {
    const total = A + B;
    const equilibrium = total / 2;
    const exponent = Math.exp(-2 * k * t);
    const B_new = equilibrium - (A - B) / 2 * exponent;
    const A_new = total - B_new;
    return [A_new, B_new];
}

function variableUpdateStarted(variables, out_is_updated) {
    const current_time_str = variables.stat_data.当前时间[0];
    last_time_str = current_time_str;
    
    is_time_reversed = false;
    
    out_is_updated = out_is_updated || false;
    
    // 检查“莫比乌斯残响”这个知识库是否已被初始化。
    // 这用于判断是否是游戏的第一次更新。如果不是第一次，才执行变量保护逻辑。
    // 这个标志变量会在世界书被发送一次之后永久变为true，而此过程发生在变量初始化之后，所以它不会屏蔽掉多开局初始化中的更新
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

function variableUpdated(_stat_data, path, _oldValue, _newValue) {
    if (path === '当前时间[0]') {
        const oldDate = parseDate(_oldValue.split(' ')[0]);
        const newDate = parseDate(_newValue.split(' ')[0]);
        if (newDate < oldDate) {
            is_time_reversed = true;
        }
    }
    
    // 特别允许AI将“侵蚀强度”设置为 null。这是一个特殊的游戏逻辑出口，这个逻辑会修改受保护的值，从而允许修改为特定值。
    if (path === `${userKey}.侵蚀强度[0]` && _newValue === null) {
        saved_erosion_intensity = null;
    }
    
    // 特别允许AI将“侵蚀深度”重置为 0 或设置为 null。
    if (path === `${userKey}.侵蚀深度[0]` && (_newValue === 0 || _newValue === null)) {
        saved_erosion_depth = _newValue;
    }
    
    // 临时记录AI的更新，用于后续在 variableUpdateEnded 中进行调整。
    if (path === '莫比.子宫填充度[0]') {
        saved_uterus_filling_new = _newValue;
    }
}

function variableUpdateEnded(variables, out_is_updated) {
    const current_time_str = variables.stat_data.当前时间[0];
    const current_date_str = current_time_str.split(' ')[0];
    const current_time = parseTime(current_time_str);
    
    // 再次检查是否是初次更新。
    if (variables.initialized_lorebooks.莫比乌斯残响[0] !== undefined) {
        // 恢复所有受保护的变量，确保它们不被AI的直接输出所改变，这样就实现了屏蔽AI对特定变量非法更新的效果。
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
	
    if (last_time_str && !isNaN(current_time)) {
        const last_date_str = last_time_str.split(' ')[0];
        const last_date = parseDate(last_date_str);
        const current_date = parseDate(current_date_str);
        if (!is_time_reversed) {
            const days_passed = daysBetween(last_date, current_date);
            if (days_passed > 0) {
                variables.stat_data.经历天数[0] += days_passed;
                out_is_updated = true;
            }
        }
    }
    
    if (saved_erosion_intensity !== null && saved_erosion_depth !== null) {
        const intimacy = variables.stat_data.莫比.亲密度[0];
        const erosion_intensity = calculateErosionIntensity(intimacy);
        variables.stat_data[userKey].侵蚀强度[0] = erosion_intensity;
        out_is_updated = true;
        
        if (last_time_str && !isNaN(current_time)) {
            const last_time = parseTime(last_time_str);
            const time_diff_ms = current_time - last_time;
            if (time_diff_ms > 0) {
                let current_depth = variables.stat_data[userKey].侵蚀深度[0] || 0;
                const depth_increase = time_diff_ms * erosion_intensity * 1.28e-9;
                current_depth = Math.min(1, Math.max(0, current_depth + depth_increase));
                variables.stat_data[userKey].侵蚀深度[0] = current_depth;
                out_is_updated = true;
            }
        }
    }
    
    if (saved_uterus_filling !== null && saved_uterus_filling_new !== null && saved_uterus_filling < saved_uterus_filling_new) {
        const mobi_age = variables.stat_data.莫比.发育年龄[0];
        const increase_amount = (saved_uterus_filling_new - saved_uterus_filling) / (mobi_age / 10);
        let current_fill = saved_uterus_filling || 0;
        current_fill = Math.min(1, Math.max(0, current_fill + increase_amount));
        variables.stat_data.莫比.子宫填充度[0] = current_fill;
        out_is_updated = true;
    }
	
    if (saved_uterus_filling !== null && saved_uterus_filling_new !== null && saved_uterus_filling > saved_uterus_filling_new) {
        variables.stat_data.莫比.子宫填充度[0] = saved_uterus_filling;
    }
    if (last_time_str && !isNaN(current_time)) {
        const last_time = parseTime(last_time_str);
        const time_diff_ms = current_time - last_time;
        if (time_diff_ms > 0) {
            let current_fill = variables.stat_data.莫比.子宫填充度[0] || 0;
            const mobi_age = variables.stat_data.莫比.发育年龄[0];
            const fill_decrease = (1 + current_fill) * time_diff_ms * 9e-9 * (mobi_age / 10);
            current_fill = Math.min(1, Math.max(0, current_fill - fill_decrease));
            variables.stat_data.莫比.子宫填充度[0] = current_fill;
            out_is_updated = true;
        }
    }
    
    if (saved_erosion_intensity !== null && saved_erosion_depth !== null && last_time_str && !isNaN(current_time)) {
        const last_time = parseTime(last_time_str);
        const time_diff_ms = current_time - last_time;
        if (time_diff_ms > 0) {
            const k = 1.33e-9;
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

    variables.stat_data.莫比.亲密度[0] = Math.min(1, Math.max(0, variables.stat_data.莫比.亲密度[0]));
    
    out_is_updated = out_is_updated || false;
    // 重置临时变量，防止后续此变量残留，引发bug。
    saved_uterus_filling_new = null;
}
