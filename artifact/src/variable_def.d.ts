export type TemplateType = StatData | StatData[] | any[];
export type StatDataMeta = {
    extensible?: boolean;
    recursiveExtensible?: boolean;
    required?: string[];
    template?: TemplateType;
    [key: string]: unknown;
};
export type JSONPrimitive = string | number | boolean | null;
export type StatData = {
    [key: string]: StatData | JSONPrimitive | (StatData | JSONPrimitive)[];
} & {
    $meta?: StatDataMeta;
    $arrayMeta?: boolean;
};
export type SchemaNode = ObjectSchemaNode | ArraySchemaNode | PrimitiveSchemaNode;
export type ObjectSchemaNode = {
    type: 'object';
    properties: {
        [key: string]: SchemaNode & {
            required?: boolean;
        };
    };
    extensible?: boolean;
    template?: TemplateType;
    recursiveExtensible?: boolean;
};
export type ArraySchemaNode = {
    type: 'array';
    elementType: SchemaNode;
    extensible?: boolean;
    template?: TemplateType;
    recursiveExtensible?: boolean;
};
export type PrimitiveSchemaNode = {
    type: 'string' | 'number' | 'boolean' | 'any';
};
export type ValueWithDescription<T> = [T, string];
export declare function assertVWD(_flag: boolean, _v: StatData | JSONPrimitive | (StatData | JSONPrimitive)[]): asserts _v is ValueWithDescription<StatData | JSONPrimitive>;
export declare function isValueWithDescription(value: unknown): boolean;
export declare function isValueWithDescriptionStatData(value: StatData | JSONPrimitive | (StatData | JSONPrimitive)[]): value is ValueWithDescription<StatData | JSONPrimitive>;
export declare function isArraySchema(value: SchemaNode): value is ArraySchemaNode;
export declare function isObjectSchema(value: SchemaNode): value is ObjectSchemaNode;
export declare function isPrimitiveSchema(value: SchemaNode): value is PrimitiveSchemaNode;
export type RootAdditionalProps = {
    strictTemplate?: boolean;
    concatTemplateArray?: boolean;
    strictSet?: boolean;
};
export type RootAdditionalMetaProps = {
    $meta?: StatDataMeta & RootAdditionalProps;
};
export type InternalData = {
    display_data: Record<string, any>;
    delta_data: Record<string, any>;
};
export type MvuData = {
    /** 已初始化的 lorebook 列表 */
    initialized_lorebooks: Record<string, any[]>;
    /**
     * 状态数据 - 存储实际的变量值
     * 支持嵌套对象结构，通过路径（如 "player.health"）访问
     * $internal 属性在更新过程中临时存储 display_data 和 delta_data 的引用
     *
     * 更新逻辑：
     * 1. 普通值：直接更新为新值
     * 2. ValueWithDescription 类型：更新数组的第一个元素（实际值），保留第二个元素（描述）
     * 3. 数字类型：自动将字符串新值转换为数字
     */
    stat_data: StatData & RootAdditionalMetaProps & {
        $internal?: InternalData;
    };
    schema: ObjectSchemaNode & Partial<RootAdditionalProps>;
    /**
     * @deprecated
     * 显示数据 - 存储变量变化的可视化表示
     * 格式："{旧值}->{新值} ({原因})"
     * 例如："100->80 (受到伤害)"
     *
     * 默认情况下包含完整的 stat_data ，但是在变更后，会将变更的元素变为上面含原因的表示。
     * 更新时机：每次 stat_data 中的值发生变化时同步更新
     * 用途：在UI中展示变量的变化历史，让用户了解数值是如何变化的
     */
    display_data?: Record<string, any>;
    /**
     * @deprecated
     * 增量数据 - 存储本次更新中发生变化的变量
     * 格式：与 display_data 相同，"{旧值}->{新值} (原因)"
     *
     * 更新时机：
     * - 在 updateVariables 开始时初始化为空对象
     * - 每次变量更新时记录变化
     * - 更新结束后保存到消息的 variables 中
     *
     * 用途：仅显示当前消息/操作中实际发生变化的变量，而不是所有历史变化
     */
    delta_data?: Record<string, any>;
    [key: string]: any;
};
export declare function isMvuData(variables: Record<string, any>): variables is MvuData;
export declare const variable_events: {
    /** 新开聊天对变量初始化时触发的事件  */
    readonly VARIABLE_INITIALIZED: "mag_variable_initialized";
    /** 某轮变量更新开始时触发的事件 */
    readonly VARIABLE_UPDATE_STARTED: "mag_variable_update_started";
    /**
     * 某轮变量更新过程中, 对文本成功解析了所有更新命令时触发的事件
     *
     * @example
     * // 修复 gemini 在中文间加入的 '-'', 如将 '角色.络-络' 修复为 '角色.络络'
     * eventOn(Mvu.events.COMMAND_PARSED, commands => {
     *   commands.forEach(command => {
     *     command.args[0] = command.args[0].replace(/-/g, '');
     *   });
     * });
     *
     * @example
     * // 修复繁体字, 如将 '絡絡' 修复为 '络络'
     * eventOn(Mvu.events.COMMAND_PARSED, commands => {
     *   commands.forEach(command => {
     *     command.args[0] = command.args[0].replaceAll('絡絡', '络络');
     *   });
     * });
     *
     * @example
     * // 添加新的更新命令
     * eventOn(Mvu.events.COMMAND_PARSED, commands => {
     *   commands.push({
     *     type: 'set',
     *     full_match: `_.set('络络.好感度', 5)`,
     *     args: ['络络.好感度', 5],
     *     reason: '脚本强行更新',
     *   });
     * });
     */
    readonly COMMAND_PARSED: "mag_command_parsed";
    /**
     * 某轮变量更新结束时触发的事件
     *
     * @example
     * // 保持好感度不低于 0
     * eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, variables => {
     *   if (_.get(variables, 'stat_data.角色.络络.好感度') < 0) {
     *     _.set(variables, 'stat_data.角色.络络.好感度', 0);
     *   }
     * })
     *
     * @example
     * // 保持好感度增幅不超过 3
     * eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, (variables, variables_before_update) => {
     *   const old_value = _.get(variables_before_update, 'stat_data.角色.络络.好感度');
     *   const new_value = _.get(variables, 'stat_data.角色.络络.好感度');
     *
     *   // 新的好感度必须在 旧好感度-3 和 旧好感度+3 之间
     *   _.set(variables, 'stat_data.角色.络络.好感度', _.clamp(new_value, old_value - 3, old_value + 3));
     * });
     */
    readonly VARIABLE_UPDATE_ENDED: "mag_variable_update_ended";
    /** 即将用更新后的变量更新楼层时触发的事件  */
    readonly BEFORE_MESSAGE_UPDATE: "mag_before_message_update";
    /** @deprecated */
    readonly SINGLE_VARIABLE_UPDATED: "mag_variable_updated";
};
export type UpdateContext = {
    variables: MvuData;
    message_content: string;
};
export type CommandInfo = SetCommandInfo | InsertCommandInfo | DeleteCommandInfo | AddCommandInfo | MoveCommandInfo;
type SetCommandInfo = {
    type: 'set';
    full_match: string;
    args: [path: string, new_value_literal: string] | [path: string, expected_old_value_literal: string, new_value_literal: string];
    reason: string;
};
type InsertCommandInfo = {
    type: 'insert';
    full_match: string;
    args: [path: string, value_literal: string] | [path: string, index_or_key_literal: string, value_literal: string];
    reason: string;
};
type DeleteCommandInfo = {
    type: 'delete';
    full_match: string;
    args: [path: string] | [path: string, index_or_key_or_value_literal: string];
    reason: string;
};
type AddCommandInfo = {
    type: 'add';
    full_match: string;
    args: [path: string, delta_or_toggle_literal: string];
    reason: string;
};
type MoveCommandInfo = {
    type: 'move';
    full_match: string;
    args: [from: string, to: string];
    reason: string;
};
export interface ListenerType {
    [variable_events.VARIABLE_INITIALIZED]: (variables: MvuData, swipe_id: number) => void;
    [variable_events.VARIABLE_UPDATE_STARTED]: (variables: MvuData, out_is_updated: boolean) => void;
    [variable_events.COMMAND_PARSED]: (variables: MvuData, commands: CommandInfo[], message_content: string) => void;
    [variable_events.VARIABLE_UPDATE_ENDED]: (variables: MvuData, variables_before_update: MvuData) => void;
    [variable_events.BEFORE_MESSAGE_UPDATE]: (context: UpdateContext) => void;
    /** @deprecated */
    [variable_events.SINGLE_VARIABLE_UPDATED]: (stat_data: Record<string, any>, path: string, _oldValue: any, _newValue: any) => void;
}
export declare const UPDATE_REGEX: RegExp;
export declare const PLOT_REGEX: RegExp;
export {};
