export type LocalizedBooleanTrue = '是';
export type LocalizedBooleanFalse = '否';

/**
 * 可以接受任意值，但是只有 LocalizedBooleanTrue 代表 true
 * 在 Migrate 过程中其他任何值都会退化为 LocalizedBooleanFalse
 */
export type StringBoolean = string | LocalizedBooleanTrue | LocalizedBooleanFalse;

export type MvuSettings = {
    是否显示变量更新错误: StringBoolean;
    构建信息: string;
};

//存储所有变量的默认值，需要设置默认值的时候可以 _.merge({}, DefaultSetting, 原始内容)
const DefaultSetting: MvuSettings = {
    是否显示变量更新错误: '是',
    构建信息: '未知',
};

const variable_option = {
    type: 'script',
    script_id: typeof getScriptId === 'function' ? getScriptId() : 'default-script-id',
} as const;

export function VerifySettings(settings: any): settings is MvuSettings {
    // 检查settings是否是对象
    if (!settings || typeof settings !== 'object') {
        return false;
    }

    // 检查必需的字段是否存在
    if (!('是否显示变量更新错误' in settings)) {
        return false;
    }

    // 检查字段类型是否正确（StringBoolean应该是字符串类型）
    if (typeof settings.是否显示变量更新错误 !== 'string') {
        return false;
    }

    return true;
}

/**
 * 对所有StringBoolean类型的字段进行退化处理
 * 只有 '是' 代表 true，其他值都退化为 '否'
 */
function FallbackStringBoolean(settings: Record<string, any>) {
    // 定义MvuSettings中所有StringBoolean类型的字段
    const stringBooleanFields: (keyof MvuSettings)[] = ['是否显示变量更新错误'];

    for (const key of stringBooleanFields) {
        if (key in settings) {
            const value = settings[key];
            // 如果不是字符串类型，或者不是'是'，都退化为'否'
            if (typeof value !== 'string') {
                settings[key] = '否';
            } else if (value !== '是') {
                settings[key] = '否';
            }
        }
    }
}

function updateVersionInfo(settings: MvuSettings) {
    try {
        settings.构建信息 = `${__BUILD_DATE__ ?? 'Unknown'} (${__COMMIT_ID__ ?? 'Unknown'})`;
    } catch (e) {
        /* empty */
    }
}

/**
 * 获取变量配置，并进行检查。
 * 补齐缺失的变量，将已有的变量进行退化。
 */
export async function GetSettings(): Promise<MvuSettings> {
    const settings = getVariables(variable_option) || {};

    // 如果verify失败或设置为空，使用默认值
    if (!VerifySettings(settings)) {
        // 使用lodash合并默认设置
        const mergedSettings = _.merge({}, DefaultSetting, settings);

        // 对StringBoolean类型进行退化处理
        FallbackStringBoolean(mergedSettings);
        updateVersionInfo(mergedSettings);

        // 保存更新后的设置
        await replaceVariables(mergedSettings, variable_option);
        return mergedSettings;
    }

    // 即使verify通过，也要确保所有字段都存在并进行退化处理
    const mergedSettings = _.merge({}, DefaultSetting, settings);

    // 对StringBoolean类型进行退化处理
    FallbackStringBoolean(mergedSettings);
    updateVersionInfo(mergedSettings);

    // 如果有任何变化，保存设置
    if (!_.isEqual(settings, mergedSettings)) {
        await replaceVariables(mergedSettings, variable_option);
    }

    return mergedSettings;
}
