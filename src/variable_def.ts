

export type GameData = {
    // initialized_lorebooks 从字符串列表变为记录对象
    // 这样可以为每个知识库存储元数据，例如初始化的标记变量
    initialized_lorebooks: Record<string, any[]>;
    stat_data: Record<string, any>;
    display_data: Record<string, any>;
    delta_data: Record<string, any>;
    // 用于存储数据结构的模式
    schema: Record<string, any>;
    // 新增：用于存储命令处理过程中发生的错误
    error_data: Record<string, any>;
};

/**
 * 定义了在变量处理期间可能出现的、可识别的错误类型。
 * - InvalidPath: 尝试访问或操作一个不存在的数据路径。
 * - TypeMismatch: 提供了与预期不符的数据类型（例如，期望数字但收到了字符串）。
 * - SchemaViolation: 操作违反了已定义的数据模式（例如，向非扩展对象添加属性）。
 * - ArgumentError: 命令的参数数量或格式不正确。
 * - InvalidCommand: 命令本身无法被解析或执行。
 */
export type ErrorType =
    | 'InvalidPath'
    | 'TypeMismatch'
    | 'SchemaViolation'
    | 'ArgumentError'
    | 'InvalidCommand';

/**
 * 代表在变量更新过程中发生单个处理错误的结构。
 */
export interface ProcessingError {
    /** 错误的类型，来自预定义的 ErrorType 集合。 */
    type: ErrorType;
    /** 错误的严重级别。 */
    level: 'warn' | 'error';
    /** 发生错误的具体数据路径。 */
    path: string;
    /** 对错误的详细、人类可读的描述。 */
    message: string;
    /** 导致错误的完整命令字符串。 */
    command: string;
    /** 可选字段，提供错误的额外上下文（例如，预期的与实际的类型）。 */
    context?: any;
}

export interface VariableData
{
    old_variables: GameData,
    /**
     * 输出变量，仅当实际产生了变量变更的场合，会产生 newVariables
     */
    new_variables?: GameData
}

export const variable_events = {
    SINGLE_VARIABLE_UPDATED: 'mag_variable_updated',
    VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
    VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
    INVOKE_MVU_PROCESS: 'mag_invoke_mvu'
} as const;

export type ExtendedListenerType = {
    [variable_events.SINGLE_VARIABLE_UPDATED]: (
            stat_data: Record<string, any>,
            path: string,
            _oldValue: any,
            _newValue: any
    ) => void;
    [variable_events.VARIABLE_UPDATE_STARTED]: (
            variables: GameData,
            out_is_updated: boolean
    ) => void;
    [variable_events.VARIABLE_UPDATE_ENDED]: (variables: GameData, out_is_updated: boolean) => void;
    [variable_events.INVOKE_MVU_PROCESS]: (message_content: string, variable_info : VariableData) => void;
};
