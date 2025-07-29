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

// StatData 类型定义 - 支持嵌套对象和数组，可以有 $meta 属性
export type StatData = {
    [key: string]: StatData | unknown | StatData[];
} & {
    $meta?: StatDataMeta;
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
};

export type RootAdditionalMetaProps = {
    $meta?: StatDataMeta & RootAdditionalProps;
};

export type GameData = {
    // initialized_lorebooks 从字符串列表变为记录对象
    // 这样可以为每个知识库存储元数据，例如初始化的标记变量
    initialized_lorebooks: Record<string, any[]>;
    stat_data: StatData & RootAdditionalMetaProps;
    display_data: Record<string, any>;
    delta_data: Record<string, any>;
    // 用于存储数据结构的模式
    schema?: ObjectSchemaNode & Partial<RootAdditionalProps>;
};

export interface VariableData {
    old_variables: GameData;
    /**
     * 输出变量，仅当实际产生了变量变更的场合，会产生 newVariables
     */
    new_variables?: GameData;
}

export const variable_events = {
    SINGLE_VARIABLE_UPDATED: 'mag_variable_updated',
    VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
    VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
    INVOKE_MVU_PROCESS: 'mag_invoke_mvu',
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
    [variable_events.INVOKE_MVU_PROCESS]: (
        message_content: string,
        variable_info: VariableData
    ) => void;
};
