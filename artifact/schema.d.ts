import { SchemaNode, MvuData } from '@/variable_def';
export declare const EXTENSIBLE_MARKER = "$__META_EXTENSIBLE__$";
/**
 * 递归地为数据对象生成一个模式。
 * @param data - 要为其生成模式的数据对象 (stat_data)。
 * @param oldSchemaNode - (可选) 来自旧 Schema 的对应节点，用于继承元数据。
 * @param parentRecursiveExtensible - (可选) 父节点的 recursiveExtensible 状态，默认为 false。
 * @returns - 生成的模式对象。
 */
export declare function generateSchema(data: any, oldSchemaNode?: SchemaNode, parentRecursiveExtensible?: boolean): SchemaNode;
/**
 * 辅助函数：为数据路径获取对应的 Schema 规则。
 * 能够处理数组索引，将其转换为 .elementType 来查询 Schema。
 * @param schema - 完整的 Schema 对象
 * @param path - 要查询的数据路径
 * @returns 对应路径的 Schema 节点，如果找不到则返回 null。
 */
export declare function getSchemaForPath(schema: SchemaNode | null | undefined, path: string): SchemaNode | null;
/**
 * 调和函数：比较数据和旧 Schema，生成并应用一个与当前数据状态完全同步的新 Schema。
 * @param variables - 包含 stat_data 和旧 schema 的变量对象。
 */
export declare function reconcileAndApplySchema(variables: MvuData): void;
/**
 * 递归清理数据中的元数据标记
 * - 从数组中移除 EXTENSIBLE_MARKER
 * - 从对象中删除 $meta 属性
 * @param data 需要清理的数据
 */
export declare function cleanUpMetadata(data: any): void;
