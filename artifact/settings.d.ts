export type LocalizedBooleanTrue = '是';
export type LocalizedBooleanFalse = '否';
/**
 * 可以接受任意值，但是只有 LocalizedBooleanTrue 代表 true
 * 在 Migrate 过程中其他任何值都会退化为 LocalizedBooleanFalse
 */
export type StringBoolean = string | LocalizedBooleanTrue | LocalizedBooleanFalse;
export type MvuSettings = {
    是否显示变量更新错误: StringBoolean;
};
export declare function VerifySettings(settings: any): settings is MvuSettings;
/**
 * 获取变量配置，并进行检查。
 * 补齐缺失的变量，将已有的变量进行退化。
 */
export declare function GetSettings(): Promise<MvuSettings>;
