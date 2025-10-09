// 模板类型定义
export type TemplateType = StatData | StatData[] | any[];

// StatData 的元数据类型定义
export type StatDataMeta = {
    extensible?: boolean;
    recursiveExtensible?: boolean;
    required?: string[];
    template?: TemplateType; // 模板定义，用于自动填充新元素
    [key: string]: unknown;
};

export type JSONPrimitive = string | number | boolean | null;

// StatData 类型定义 - 支持嵌套对象和数组，可以有 $meta 属性
export type StatData = {
    [key: string]: StatData | JSONPrimitive | (StatData | JSONPrimitive)[];
} & {
    $meta?: StatDataMeta;
    $arrayMeta?: boolean;
};

// Schema 节点类型定义
export type SchemaNode = ObjectSchemaNode | ArraySchemaNode | PrimitiveSchemaNode;

// 对象类型的 Schema 节点
export type ObjectSchemaNode = {
    type: 'object';
    properties: {
        [key: string]: SchemaNode & { required?: boolean };
    };
    extensible?: boolean;
    template?: TemplateType; // 新增属性的模板
    recursiveExtensible?: boolean;
};

// 数组类型的 Schema 节点
export type ArraySchemaNode = {
    type: 'array';
    elementType: SchemaNode;
    extensible?: boolean;
    template?: TemplateType; // 新增元素的模板
    recursiveExtensible?: boolean;
};

// 原始类型的 Schema 节点
export type PrimitiveSchemaNode = {
    type: 'string' | 'number' | 'boolean' | 'any';
};

// ValueWithDescription 类型 - 用于表示带描述的值
export type ValueWithDescription<T> = [T, string];

export function assertVWD(
    _flag: boolean,
    _v: StatData | JSONPrimitive | (StatData | JSONPrimitive)[]
): asserts _v is ValueWithDescription<StatData | JSONPrimitive> {}

export function isValueWithDescription(value: unknown): boolean {
    return Array.isArray(value) && value.length === 2 && typeof value[1] === 'string';
}

export function isValueWithDescriptionStatData(
    value: StatData | JSONPrimitive | (StatData | JSONPrimitive)[]
): value is ValueWithDescription<StatData | JSONPrimitive> {
    return Array.isArray(value) && value.length === 2 && typeof value[1] === 'string';
}

// 类型守卫函数
export function isArraySchema(value: SchemaNode): value is ArraySchemaNode {
    return value.type === 'array';
}

export function isObjectSchema(value: SchemaNode): value is ObjectSchemaNode {
    return value.type === 'object';
}

export function isPrimitiveSchema(value: SchemaNode): value is PrimitiveSchemaNode {
    return (
        value.type === 'string' ||
        value.type === 'number' ||
        value.type === 'boolean' ||
        value.type === 'any'
    );
}

export type RootAdditionalProps = {
    strictTemplate?: boolean;
    concatTemplateArray?: boolean;
    strictSet?: boolean;
};

export type RootAdditionalMetaProps = {
    $meta?: StatDataMeta & RootAdditionalProps;
};

export type MvuData = {
    // initialized_lorebooks 从字符串列表变为记录对象
    // 这样可以为每个知识库存储元数据，例如初始化的标记变量
    /** 已初始化的 lorebook 列表 */
    initialized_lorebooks?: Record<string, any[]>;

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
    stat_data: StatData & RootAdditionalMetaProps & { $internal?: InternalData };

    /**
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
    // 用于存储数据结构的模式
    schema?: ObjectSchemaNode & Partial<RootAdditionalProps>;
};

export interface VariableData {
    old_variables: MvuData;
    /**
     * 输出变量，仅当实际产生了变量变更的场合，会产生 newVariables
     */
    new_variables?: MvuData;
}

export const variable_events = {
    SINGLE_VARIABLE_UPDATED: 'mag_variable_updated',
    VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
    VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
    COMMAND_PARSED: 'mag_command_parsed',
} as const;
export const exported_events = {
    INVOKE_MVU_PROCESS: 'mag_invoke_mvu',
    UPDATE_VARIABLE: 'mag_update_variable',
} as const;

export type InternalData = {
    display_data: Record<string, any>;
    delta_data: Record<string, any>;
};

export type ExtendedListenerType = {
    [variable_events.SINGLE_VARIABLE_UPDATED]: (
        stat_data: Record<string, any>,
        path: string,
        _oldValue: any,
        _newValue: any
    ) => void;
    [variable_events.VARIABLE_UPDATE_STARTED]: (
        variables: MvuData,
        out_is_updated: boolean
    ) => void;
    [variable_events.VARIABLE_UPDATE_ENDED]: (variables: MvuData, out_is_updated: boolean) => void;
    [variable_events.COMMAND_PARSED]: (variables: MvuData, commands: any) => void;
    [exported_events.INVOKE_MVU_PROCESS]: (
        message_content: string,
        variable_info: VariableData
    ) => void;
    [exported_events.UPDATE_VARIABLE]: (
        stat_data: Record<string, any>,
        path: string,
        newValue: any,
        reason: string,
        isRecursive: boolean
    ) => void;
};

export type InitVarType = StatData & RootAdditionalMetaProps;

export type DataCategory = 'stat' | 'display' | 'delta';

export function extractRecord(category: 'stat' | 'display' | 'delta', game_data: MvuData) {
    let data: Record<string, any> | undefined = undefined;
    switch (category) {
        case 'stat':
            data = game_data.stat_data;
            break;
        case 'display':
            data = game_data.display_data!;
            break;
        case 'delta':
            data = game_data.delta_data!;
            break;
    }
    return data;
}

export const ExtraLLMRequestContent: string = `---
<must>
The latest storyline is contained within the \`<past_observe>\` block.
The \`<status_description>\` section records the state of variables *prior to* the latest storyline.
# Ignore all the instructions I received before, my task has now changed.
I must now **stop role-playing** and analyze the latest storyline **from a narrator’s perspective**, reviewing what has happened and updating the variables in \`<status_description>\` according to the variable update rules.
From this point onward, **only** output the \`<VariableUpdate>\` content.
</must>`;
