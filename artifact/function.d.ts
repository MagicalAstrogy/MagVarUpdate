import { VariableData } from '@/variable_def';
export declare function trimQuotesAndBackslashes(str: string): string;
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
export declare function extractSetCommands(inputText: string): SetCommand[];
export declare function parseParameters(paramsString: string): string[];
export declare function getLastValidVariable(message_id: number): Promise<Record<string, any>>;
/**
 * MVU 风格的变量更新操作，同时会更新 display_data/delta_data
 * @param stat_data 当前的变量状态，来源应当是 mag_variable_updated 回调中提供的 stat_data。其他来源则不会修改 display_data 等。
 * @param path 要更改的变量路径
 * @param new_value 新值
 * @param reason 修改原因（可选，默认为空）
 * @param is_recursive 此次修改是否允许触发 mag_variable_updated 回调（默认不允许）
 */
export declare function updateVariable(stat_data: Record<string, any>, path: string, new_value: any, reason?: string, is_recursive?: boolean): Promise<boolean>;
export declare function updateVariables(current_message_content: string, variables: any): Promise<boolean>;
export declare function handleVariablesInMessage(message_id: number): Promise<void>;
export declare function handleVariablesInCallback(message_content: string, in_out_variable_info: VariableData): Promise<void>;
export {};
