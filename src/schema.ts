// 定义魔法字符串为常量，便于管理和引用
export const EXTENSIBLE_MARKER = "$__META_EXTENSIBLE__$";

// 模式生成函数
/**
 * 递归地为数据对象生成一个模式。
 * @param data - 要为其生成模式的数据对象 (stat_data)。
 * @param oldSchemaNode - (可选) 来自旧 Schema 的对应节点，用于继承元数据。
 * @returns - 生成的模式对象。
 */
export function generateSchema(data: any, oldSchemaNode?: any): any {
    if (Array.isArray(data)) {
        let isExtensible = oldSchemaNode?.extensible === true; // 默认继承旧 Schema

        // 检查并处理魔法字符串
        const markerIndex = data.indexOf(EXTENSIBLE_MARKER);
        if (markerIndex > -1) {
            isExtensible = true;
            // 从数组中移除标记，以免影响后续的类型推断
            data.splice(markerIndex, 1);
            console.log(`Extensible marker found and removed from an array.`);
        }

        // 对于数组，关注其 elementType
        const oldElementType = oldSchemaNode?.elementType;
        return {
            type: 'array',
            extensible: isExtensible, // 应用最终的 extensible 状态
            elementType: data.length > 0 ? generateSchema(data[0], oldElementType) : {type: 'any'},
        };
    }
    if (_.isObject(data) && !_.isDate(data)) {
        const typedData = data as Record<string, any>; // 类型断言
        const schemaNode: any = {
            type: 'object',
            properties: {},
            // 默认不可扩展，但如果旧 schema 或 $meta 定义了，则可扩展
            extensible: oldSchemaNode?.extensible === true || typedData.$meta?.extensible === true,
        };

        // 暂存父节点的 $meta，以便在循环中使用
        const parentMeta = typedData.$meta;

        // 从 $meta 中读取信息后，将其从数据中移除，避免污染
        if (typedData.$meta) {
            delete typedData.$meta;
        }

        for (const key in data) {
            const oldChildNode = oldSchemaNode?.properties?.[key];
            const childSchema = generateSchema(typedData[key], oldChildNode);

            // 一个属性是否必需？

            // 1. 默认值: 如果父节点可扩展，子节点默认为可选；否则为必需。
            let isRequired = !schemaNode.extensible;

            // 2. 覆盖规则: 检查父元数据中的 'required' 数组。
            //    如果父节点的 $meta.required 是一个数组，并且当前 key 在这个数组里，
            //    则无论默认值是什么，都强制覆盖为必需。
            if (Array.isArray(parentMeta?.required) && parentMeta.required.includes(key)) {
                isRequired = true;
            }

            // 3. 检查旧 schema 的设置，作为最后的参考
            if (oldChildNode?.required === false) {
                // 如果旧 schema 明确说这个是可选的，那么以这个为准
                isRequired = false;
            } else if (oldChildNode?.required === true) {
                isRequired = true;
            }

            childSchema.required = isRequired;

            schemaNode.properties[key] = childSchema;
        }
        return schemaNode;
    }
    // 处理原始类型
    return {type: typeof data};
}

/**
 * 辅助函数：为数据路径获取对应的 Schema 规则。
 * 能够处理数组索引，将其转换为 .elementType 来查询 Schema。
 * @param schema - 完整的 Schema 对象
 * @param path - 要查询的数据路径
 * @returns 对应路径的 Schema 节点，如果找不到则返回 null。
 */
export function getSchemaForPath(schema: any, path: string): any {
    if (!path) {
        return schema;
    }
    // 将 lodash 路径字符串转换为段数组，例如 'a.b[0].c' -> ['a', 'b', '0', 'c']
    const pathSegments = _.toPath(path);
    let currentSchema = schema;

    for (const segment of pathSegments) {
        if (!currentSchema) return null;

        // 如果 segment 是数字（数组索引），则移动到 elementType
        if (/^\d+$/.test(segment)) {
            if (currentSchema.type === 'array' && currentSchema.elementType) {
                currentSchema = currentSchema.elementType;
            } else {
                return null; // 路径试图索引一个非数组或无 elementType 的 schema
            }
        } else if (currentSchema.properties && currentSchema.properties[segment]) {// 否则，作为对象属性访问


            currentSchema = currentSchema.properties[segment];
        } else {
            return null; // 路径中的键在 schema 中不存在
        }
    }
    return currentSchema;
}

/**
 * 调和函数：比较数据和旧 Schema，生成并应用一个与当前数据状态完全同步的新 Schema。
 * @param variables - 包含 stat_data 和旧 schema 的变量对象。
 */
export function reconcileAndApplySchema(variables: any) {
    console.log("Reconciling schema with current data state...");

    // 1. 深拷贝数据，以防 generateSchema 修改原始数据（例如删除 $meta）
    const currentDataClone = _.cloneDeep(variables.stat_data);

    // 2. 使用改进后的 generateSchema 生成一个与当前数据完全匹配的新 Schema，
    //    并在此过程中从旧 Schema 继承元数据。
    const newSchema = generateSchema(currentDataClone, variables.schema);

    // 3. 直接用新 Schema 替换旧 Schema
    variables.schema = newSchema;

    console.log("Schema reconciliation complete.");
}


function isMetaCarrier(value: unknown): value is Record<string, unknown> & { $meta?: unknown } {
    return _.isObject(value) && !_.isDate(value);
}

/**
 * 递归清理数据中的元数据标记
 * - 从数组中移除 EXTENSIBLE_MARKER
 * - 从对象中删除 $meta 属性
 * @param data 需要清理的数据
 */
export function cleanupMetadata(data: any): void {
    // 如果是数组，移除魔法字符串并递归
    if (Array.isArray(data)) {
        let i = data.length;
        while (i--) {
            if (data[i] === EXTENSIBLE_MARKER) {
                data.splice(i, 1);
            } else {
                // 对数组中的其他元素（可能是对象或数组）进行递归清理
                cleanupMetadata(data[i]);
            }
        }
    }
    // 如果是对象，移除 $meta 并递归
    else if (isMetaCarrier(data)) {
        // 清除自身 $meta
        delete data.$meta;

        // 递归
        for (const key in data) {
            cleanupMetadata(data[key]);
        }
    }
}
