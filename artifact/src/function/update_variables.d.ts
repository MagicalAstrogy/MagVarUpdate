import { MvuData, TemplateType } from '@/variable_def';
export declare function trimQuotesAndBackslashes(str: string): string;
/**
 * 应用模板到值上，值的属性优先级高于模板
 * @param value 要应用模板的值
 * @param template 模板 (TemplateType | undefined)
 * @param strict_array_cast 是否开启严格模式，开启后不允许 primitive type -> [primitive type] 的隐式转换
 * @param array_merge_concat 指明数组的 合并 行为是指 覆盖 还是 拼接，默认拼接。
 * @returns 合并后的值
 */
export declare function applyTemplate(value: any, template: TemplateType | undefined, strict_array_cast?: boolean, array_merge_concat?: boolean): any;
export declare function parseCommandValue(valStr: string): any;
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
type CommandNames = 'set' | 'insert' | 'assign' | 'remove' | 'unset' | 'delete' | 'add' | 'move';
/**
 * 从大字符串中提取所有 .set(${path}, ${new_value});//${reason} 格式的模式
 * 并解析出每个匹配项的路径、新值和原因部分
 */
interface Command {
    type: CommandNames;
    full_match: string;
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
export declare function extractCommands(inputText: string): Command[];
export declare function parseParameters(paramsString: string): string[];
export declare function pathFix(path: string): string;
/**
 * MVU 风格的变量更新操作，同时会更新 display_data/delta_data
 * @deprecated MVU zod 不再需要支持 display_data/delta_data
 */
export declare function updateVariable(stat_data: Record<string, any>, path: string, new_value: any, reason?: string, is_recursive?: boolean): Promise<boolean>;
export declare function updateVariables(current_message_content: string, variables: MvuData): Promise<boolean>;
export declare function handleVariablesInMessage(message_id: number): Promise<void>;
export {};
