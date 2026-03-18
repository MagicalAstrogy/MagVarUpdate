import { VariableData } from '@/variable_def';
export declare function handleVariablesInCallback(message_content: string, in_out_variable_info: VariableData): Promise<import("@/variable_def").MvuData | undefined>;
export declare function initExportedEvents(): () => void;
