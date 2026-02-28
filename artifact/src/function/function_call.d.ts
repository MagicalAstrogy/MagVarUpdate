/**
 * 最终的变量更新机制实际上是专门generate 一个新的请求，那个请求会通过 tool_call 直接更新变量。
 * 并不会直接在一条输出消息里面进行 tool_call，因为这种情况很可能 llm 直接无视你的tool call请求（auto/any）
 * 或者 tool call 请求直接把正文肘掉（required）
 * 如果想不肘正文，需要从外部输入格式强调才行，因此直接把 mvu 更新移动到函数调用中不现实。
 * 目前的折衷方式是在 generate 中触发函数调用，在这个情况下可以利用 required 肘掉正文的特性，来精简输出。
 */
export declare const MVU_FUNCTION_NAME = "mvu_VariableUpdate";
/** 已知的工具名：先收窄 mvu_VariableUpdate，保留 string 兼容其它 */
type ToolName = typeof MVU_FUNCTION_NAME | (string & {});
/** 工具调用的“函数体” */
interface FunctionCallBody {
    /** 工具名，例如 "mvu_VariableUpdate"。你也可以扩成联合类型做更强约束 */
    name: ToolName;
    /** 注意：这里是**字符串里包 JSON**。解析请看后面的辅助函数 */
    arguments: string;
}
/** 单个工具调用（function-calling 形态） */
interface ToolFunctionCall {
    index: number;
    id: string;
    type: 'function';
    function: FunctionCallBody;
}
/** 一批（组）工具调用：你示例里的内层数组 */
type ToolCallBatch = ToolFunctionCall[];
/** 多批（组）工具调用：你示例的最外层 */
type ToolCallBatches = ToolCallBatch[];
export declare function registerFunction(): () => void;
export declare function overrideToolRequest(generate_data: any): void;
export declare function extractFromToolCall(tool_calls: ToolCallBatches | undefined): string | null;
export {};
