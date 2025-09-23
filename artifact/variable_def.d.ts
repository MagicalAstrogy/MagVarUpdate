export type ValueWithDescription<T> = [T, string];
export declare function isValueWithDescription<T>(value: unknown): value is ValueWithDescription<T>;
export type MvuData = {
    /** 已初始化的 lorebook 列表 */
    initialized_lorebooks: string[];
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
    stat_data: Record<string, any> & {
        $internal?: InternalData;
    };
    /**
     * 显示数据 - 存储变量变化的可视化表示
     * 格式："{旧值}->{新值} ({原因})"
     * 例如："100->80 (受到伤害)"
     *
     * 默认情况下包含完整的 stat_data ，但是在变更后，会将变更的元素变为上面含原因的表示。
     * 更新时机：每次 stat_data 中的值发生变化时同步更新
     * 用途：在UI中展示变量的变化历史，让用户了解数值是如何变化的
     */
    display_data: Record<string, any>;
    /**
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
    delta_data: Record<string, any>;
};
export interface VariableData {
    old_variables: MvuData;
    /**
     * 输出变量，仅当实际产生了变量变更的场合，会产生 newVariables
     */
    new_variables?: MvuData;
}
export declare const variable_events: {
    readonly SINGLE_VARIABLE_UPDATED: "mag_variable_updated";
    readonly VARIABLE_UPDATE_ENDED: "mag_variable_update_ended";
    readonly VARIABLE_UPDATE_STARTED: "mag_variable_update_started";
};
export declare const exported_events: {
    INVOKE_MVU_PROCESS: string;
    UPDATE_VARIABLE: string;
};
export type InternalData = {
    display_data: Record<string, any>;
    delta_data: Record<string, any>;
};
export type ExtendedListenerType = {
    [variable_events.SINGLE_VARIABLE_UPDATED]: (stat_data: Record<string, any>, path: string, _oldValue: any, _newValue: any) => void;
    [variable_events.VARIABLE_UPDATE_STARTED]: (variables: MvuData, out_is_updated: boolean) => void;
    [variable_events.VARIABLE_UPDATE_ENDED]: (variables: MvuData, out_is_updated: boolean) => void;
};
export type DataCategory = 'stat' | 'display' | 'delta';
export declare function extractRecord(category: 'stat' | 'display' | 'delta', game_data: MvuData): Record<string, any>;
