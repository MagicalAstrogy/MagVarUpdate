import { ToolCallBatches } from './function_call';
export declare function invokeExtraModelWithStrategy(): Promise<string | null>;
/**
 * @brief 调用额外模型解析，可能会抛出异常。
 */
export declare function generateExtraModel(): Promise<string | null>;
export declare function extractFromToolCall(tool_calls: ToolCallBatches | undefined): string | null;
