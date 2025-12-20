import { MvuData } from '@/variable_def';
type CommandNames = 'set' | 'insert' | 'delete' | 'add';
/**
 * 对 parseMessage / updateVariables 内部命令解析结果的补充类型说明。
 *
 * 每个字符串元素都是在原始指令中截取的字面量或表达式片段，尚未经过 `parseCommandValue` 解析。
 */
type SetCommandArgs = [path: string, newValueLiteral: string] | [path: string, expectedOldValueLiteral: string, newValueLiteral: string];
/**
 * `_.assign` 与 `_.insert` 支持两种形态：直接追加值，或在指定键/索引处写入。
 */
type AssignCommandArgs = [path: string, valueLiteral: string] | [path: string, indexOrKeyLiteral: string, valueLiteral: string];
/**
 * 删除指令既可以直接给出完整路径，也可以通过第二个参数指定要移除的索引/键或匹配值。
 */
type RemoveCommandArgs = [path: string] | [path: string, indexKeyOrValueLiteral: string];
/**
 * `_.add` 始终需要增量或布尔目标，用第二个参数表示。
 */
type AddCommandArgs = [path: string, deltaOrToggleLiteral: string];
type CommandArgsMap = {
    set: SetCommandArgs;
    insert: AssignCommandArgs;
    delete: RemoveCommandArgs;
    add: AddCommandArgs;
};
/**
 * CommandInfo 与内部的 Command 结构保持字段布局一致，
 * 但针对不同命令给出了更精确的参数元组形态，方便在外部做类型推断或文档查看。
 */
export type CommandInfo = {
    [K in CommandNames]: {
        type: K;
        full_match: string;
        args: CommandArgsMap[K];
        reason: string;
    };
}[CommandNames];
export type UpdateContext = {
    variables: MvuData;
    message_content: string;
};
declare function createMVU(): {
    /**
     * 变量事件常量集合
     * 包含三个核心事件，用于监听和响应变量系统的不同更新阶段
     *
     * @property {string} SINGLE_VARIABLE_UPDATED - 'mag_variable_updated'
     * 单个变量更新时触发的事件
     * - 事件值: 'mag_variable_updated'
     * - 回调签名: (stat_data: Record<string, any>, path: string, oldValue: any, newValue: any) => void
     *   - stat_data: 完整的状态数据对象
     *   - path: 被更新的变量路径（如 'player.health' 或 'items[0].name'）
     *   - oldValue: 更新前的值
     *   - newValue: 更新后的新值
     * - 触发条件: 当通过 setMvuVariable / _.set 语句更新一个变量之后， 会触发这个事件
     * - 典型用途:
     *   - 实现变量间的联动逻辑（如等级提升时自动增加属性）
     *   - 如果某个变量不符合更新条件，则拒绝这次更新。
     *
     * @property {string} VARIABLE_UPDATE_STARTED - 'mag_variable_update_started'
     * 批量变量更新开始时触发的事件
     * - 事件值: 'mag_variable_update_started'
     * - 回调签名: (variables: MvuData, out_is_updated: boolean) => void
     *   - variables: 包含 stat_data、display_data、delta_data 的完整数据对象
     *   - out_is_updated: 弃用
     * - 触发时机: parseMessage 或 LLM消息回复结束 开始解析命令之前
     * - 典型用途:
     *   - 保存更新前的状态快照
     *   - 初始化批处理所需的临时数据结构
     *
     * @property {string} VARIABLE_UPDATE_ENDED - 'mag_variable_update_ended'
     * 批量变量更新结束时触发的事件
     * - 事件值: 'mag_variable_update_ended'
     * - 回调签名: (variables: MvuData, out_is_updated: boolean) => void
     *   - variables: 更新完成后的完整数据对象
     *     - variables.stat_data: 最新的状态数据
     *     - variables.display_data: 包含变化描述的显示数据
     *     - variables.delta_data: 仅包含本次更新变化的数据
     * - 触发时机: parseMessage 或 LLM消息回复结束 完成所有命令的处理后
     * - 典型用途:
     *   - 对变量的值进行回滚
     *   - 根据变量的变更更新事件触发、变量取值（如日替后更新每日任务等）
     * @property {string} VARIABLE_INITIALIZED - 'mag_variable_initialized'
     * 在进行 0 层消息初始化时会触发的事件
     * - 事件值: 'mag_variable_initialized'
     * - 回调签名: (variables: Record<string, any> & MvuData, swipe_id: number) => void
     *   - variables: 完成初始化后的完整变量信息，包含 [initvar] 中的信息，以及在 mvu 初始化之前已存在的变量信息。
     *   - swipe_id: 当前正在处理的 swipe 编号
     * - 触发时机: 在进行 0 层的变量初始化时，对每一个开场白(swipe) 都会调用一次。
     * - 典型用途:
     *   - 在初始化时，设置非 stat_data 的变量
     *
     * @property {string} COMMAND_PARSED - 'mag_command_parsed'
     * 解析完指令后，开始处理之前触发的事件
     * - 事件值: 'mag_command_parsed'
     * - 回调签名: (variables: MvuData, commands: CommandInfo[], message_content: string) => void
     *   - variables: 当前上下文的完整数据
     *   - commands: 待处理的指令列表
     *   - message_content: 目前完整的消息内容，你可以通过这个参数来收集自己的变量更新范式，将其填入commands。
     * - 触发时机: 解析完指令后，开始处理之前
     * - 典型用途:
     *   - 保护特定变量：扫描 Command 列表中，是否有对特定变量进行修改的，删除它们
     *   - 兜底错误的llm输入：如 Gemini 在变量里面加横杠了 悠-纪.好感度 可以通过在这个回调里面调整 Path 来修改为正确的
     *   - 给角色增加别名：如角色 雪莲 有时候 llm 飙繁体 雪蓮，可以通过这个回调，给角色增加若干个别名，保证各种情况都能正确更新变量。
     *   - 实现自定义的变量更新范式解析规则：可以通过对 message_content 的内容进行处理，解析出 JSON Patch 等其他形式的变量更新语句，放入 commands 中。
     * @property {string} BEFORE_MESSAGE_UPDATE - 'mag_before_message_update'
     * 在 MVU 即将对楼层变量进行更新的场合触发的事件
     * - 事件值: 'mag_before_message_update'
     * - 回调签名: (context: UpdateContext) => void;
     *   - UpdateContext: 当前上下文的完整数据
     *   - UpdateContext.variables: 当前轮次更新完成时的变量状态
     *   - UpdateContext.message_content: 最初对应于此次变量更新的消息内容，对齐进行更改可以影响最终输出的内容 (**注意反复执行该回调时，结果需要相同，因为存在重演的场景**)
     * - 触发时机: 完成变量更新操作，即将插入 <StatusPlaceHolderImpl/> 前（仅 assistant 消息会触发，仅发生了变量更新操作时会触发）
     * - 典型用途:
     *   - 把部分格式化输出暂存在变量中，然后原样输出，如 “剧情总结会存放在变量 stat_data.story_misc 中，之后通过这个接口重新展开为 summary 块，并清空 story_misc 内容”
     *
     * @example
     * // 1. 监听单个变量更新 - 实现变量联动
     * eventOn(Mvu.events.SINGLE_VARIABLE_UPDATED, (stat_data, path, oldValue, newValue) => {
     *   console.log(`[变量更新] ${path}: ${oldValue} -> ${newValue}`);
     *
     *   // 等级提升时的连锁反应
     *   if (path === 'player.level' && newValue > oldValue) {
     *     const levelUp = newValue - oldValue;
     *     // 每级增加10点生命上限
     *     const newMaxHealth = stat_data.player.maxHealth + (levelUp * 10);
     *     Mvu.setMvuVariable(stat_data, 'player.maxHealth', newMaxHealth, {
     *       reason: `升级奖励(+${levelUp}级)`
     *     });
     *   }
     *
     *   // 生命值降到0时触发死亡
     *   if (path === 'player.health' && newValue <= 0 && oldValue > 0) {
     *     Mvu.setMvuVariable(mvuData, 'player.status', 'dead', {
     *       reason: '生命值耗尽',
     *       is_recursive: true  // 允许因此再次触发 events
     *     });
     *   }
     * });
     *
     * // 2. 监听批量更新开始 - 准备UI和状态
     * var value_snapshot = undefined;
     * eventOn(Mvu.events.VARIABLE_UPDATE_STARTED, (variables, out_is_updated) => {
     *   console.log('[批量更新] 开始处理变量更新...');
     *
     *   // 保存老值
     *   value_snapshot = variables.stat_data.世界线变更度;
     * });
     *
     * // 3. 监听批量更新结束 - 完成后处理
     * eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, (variables, out_is_updated) => {
     *   console.log('[批量更新] 完成，是否有更新:', out_is_updated);
     *   //使用老值覆盖，禁止llm 更新
     *   Mvu.setMvuVariable(variables.stat_data, '世界线变更都', value_snapshot);
     * });
     *
     */
    events: {
        readonly VARIABLE_INITIALIZED: "mag_variable_initialized";
        readonly SINGLE_VARIABLE_UPDATED: "mag_variable_updated";
        readonly VARIABLE_UPDATE_ENDED: "mag_variable_update_ended";
        readonly VARIABLE_UPDATE_STARTED: "mag_variable_update_started";
        readonly COMMAND_PARSED: "mag_command_parsed";
        readonly BEFORE_MESSAGE_UPDATE: "mag_before_message_update";
    };
    /**
     * 解析包含变量更新命令的消息
     * @param message - 包含 _.set() 命令的消息字符串
     * @param old_data - 当前的 MvuData 状态
     * @returns 如果有变量被更新则返回新的 MvuData，否则返回 undefined
     * @example
     * const newData = await Mvu.parseMessage(`
     *   _.set('player.health', 100, 80);//受到伤害
     *   _.set('player.position', "城镇", "森林");//移动
     * `, currentData);
     */
    parseMessage: (message: string, old_data: MvuData) => Promise<MvuData | undefined>;
    /**
     * 获取指定作用域的 MvuData
     * @param options - 变量选项，指定获取哪个作用域的变量（chat/message/global等）
     * @returns MvuData 对象
     * @example
     * const chatData = Mvu.getMvuData({ type: 'chat' });
     * const messageData = Mvu.getMvuData({ type: 'message', message_id: 'latest' });
     */
    getMvuData: (options: VariableOption) => MvuData;
    /**
     * 替换指定作用域的 MvuData
     * @param mvu_data - 要设置的新 MvuData
     * @param options - 变量选项，指定替换哪个作用域的变量
     * @example
     * await Mvu.replaceMvuData(newData, { type: 'chat' });
     */
    replaceMvuData: (mvu_data: MvuData, options: VariableOption) => Promise<void>;
    /**
     * 获取当前消息的 MvuData
     * @returns 当前消息的 MvuData 对象
     * @example
     * const currentData = Mvu.getCurrentMvuData();
     */
    getCurrentMvuData: () => MvuData;
    /**
     * 替换当前消息的 MvuData
     * @param mvu_data - 要设置的新 MvuData
     * @example
     * await Mvu.replaceCurrentMvuData(updatedData);
     */
    replaceCurrentMvuData: (mvu_data: MvuData) => Promise<void>;
    /**
     * 重新加载初始变量数据
     * @param mvu_data - 要重新加载初始数据的 MvuData 对象
     * @returns 是否加载成功
     * @example
     * const success = await Mvu.reloadInitVar(mvuData);
     */
    reloadInitVar: (mvu_data: MvuData) => Promise<boolean>;
    /**
     * 设置单个变量的值
     * @param mvu_data - 要更新的 MvuData 对象
     * @param path - 变量路径，支持嵌套路径如 "player.health" 或数组索引 "items[0]"
     * @param new_value - 新值
     * @param options - 可选参数
     * @param options.reason - 更新原因，会显示在 display_data 中
     * @param options.is_recursive - 是否触发 mag_variable_updated 事件，默认 false
     * @returns 更新是否成功
     * @example
     * // 简单更新
     * await Mvu.setMvuVariable(data, 'player.health', 80);
     *
     * // 带原因的更新
     * await Mvu.setMvuVariable(data, 'player.health', 80, { reason: '受到伤害' });
     *
     * // 触发事件的更新
     * await Mvu.setMvuVariable(data, 'player.level', 2, {
     *   reason: '升级',
     *   is_recursive: true
     * });
     *
     */
    setMvuVariable: (mvu_data: MvuData, path: string, new_value: any, { reason, is_recursive }?: {
        reason?: string;
        is_recursive?: boolean;
    }) => Promise<boolean>;
    /**
     * 获取变量的值
     * @param mvu_data - MvuData 对象
     * @param path - 变量路径，支持嵌套路径
     * @param options - 可选参数
     * @param options.category - 从哪个数据类别获取：'stat'(默认)/'display'/'delta'
     * @param options.default_value - 当路径不存在时返回的默认值
     * @returns 变量值。如果是 ValueWithDescription 类型，返回第一个元素（实际值）
     * @example
     * // 获取 stat_data 中的值
     * const health = Mvu.getMvuVariable(data, 'player.health');
     *
     * // 获取 display_data 中的显示值
     * const healthDisplay = Mvu.getMvuVariable(data, 'player.health', {
     *   category: 'display'
     * });
     *
     * // 带默认值
     * const score = Mvu.getMvuVariable(data, 'player.score', {
     *   default_value: 0
     * });
     */
    getMvuVariable: (mvu_data: MvuData, path: string, { category, default_value, }?: {
        category?: "stat" | "display" | "delta";
        default_value?: any;
    }) => any;
    /**
     * 获取指定类别的完整数据记录
     * @param mvu_data - MvuData 对象
     * @param category - 数据类别：'stat'/'display'/'delta'
     * @returns 对应类别的完整数据记录对象
     * @example
     * // 获取所有状态数据
     * const allStatData = Mvu.getRecordFromMvuData(data, 'stat');
     *
     * // 获取所有显示数据
     * const allDisplayData = Mvu.getRecordFromMvuData(data, 'display');
     *
     * // 获取所有增量数据
     * const allDeltaData = Mvu.getRecordFromMvuData(data, 'delta');
     *
     * @note 通常用于 LLM 准备 foreach 数据时使用
     */
    getRecordFromMvuData: (mvu_data: MvuData, category: "stat" | "display" | "delta") => Record<string, any>;
};
export type MVU = ReturnType<typeof createMVU>;
export type Mvu = MVU;
export declare function exportGlobals(): Promise<void>;
export declare function unsetGlobals(): void;
export {};
