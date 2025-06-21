// 整体游戏数据类型
import { updateVariables } from '@/function';
import { GameData } from '@/main';

type LorebookEntry = {
    content: string;
    comment?: string;
};

// 定义魔法字符串为常量，便于管理和引用
const EXTENSIBLE_MARKER = "$__META_EXTENSIBLE__$";

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
            elementType: data.length > 0 ? generateSchema(data[0], oldElementType) : { type: 'any' },
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

        // 从 $meta 中读取信息后，将其从数据中移除，避免污染
        if (typedData.$meta) {
            delete typedData.$meta;
        }

        for (const key in data) {
            const oldChildNode = oldSchemaNode?.properties?.[key];
            const childSchema = generateSchema(typedData[key], oldChildNode);
            const childData = typedData[key] as Record<string, any>;

            // 一个属性是否必需？

            // 1. 默认值
            let isRequired = true;

            // 2. 检查父节点是否是 extensible
            if (schemaNode.extensible) {
                // 如果父节点可扩展，则子节点默认变为可选
                isRequired = false;
            }

            // 3. 检查子节点自身是否有 'required: true' 的覆盖元数据
            //    (需要先判断 childData 是否为对象)
            if (_.isObject(childData) && !Array.isArray(childData) && childData.$meta?.required === true) {
                isRequired = true;
            }

            // 4. 检查旧 schema 的设置，作为最后的参考
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
    return { type: typeof data };
}

export async function initCheck() {
    //generation_started 的最新一条是正在生成的那条。
    var last_chat_msg: ChatMessageSwiped[] = [];
    try {
        (await getChatMessages(-2, {
            role: 'assistant',
            include_swipes: true,
        })) as ChatMessageSwiped[];
    } catch (e) {
        //在第一行时，必定发生异常。
    }
    if (!last_chat_msg) {
        last_chat_msg = [];
    }
    if (last_chat_msg.length <= 0) {
        var first_msg = await getChatMessages(0, {
            include_swipes: true,
        });
        if (first_msg && first_msg.length > 0) {
            last_chat_msg = first_msg;
        } else {
            console.error('不存在任何一条消息，退出');
            return;
        }
    }
    var last_msg = last_chat_msg[0];
    //检查最近一条消息的当前swipe
    var variables = last_msg.swipes_data[last_msg.swipe_id] as GameData & Record<string, any>;
    var lorebook_settings = await getLorebookSettings();
    var enabled_lorebook_list = lorebook_settings.selected_global_lorebooks;
    var char_lorebook = await getCurrentCharPrimaryLorebook();
    if (char_lorebook !== null) {
        enabled_lorebook_list.push(char_lorebook);
    }
    if (variables === undefined) {
        // initialized_lorebooks 初始化为空对象 {}
        variables = {
            display_data: {},
            initialized_lorebooks: {},
            stat_data: {},
            delta_data: {},
            schema: {},
        };
    }
    if (!_.has(variables, 'initialized_lorebooks')) {
        variables.initialized_lorebooks = {};
    }
    if (Array.isArray(variables.initialized_lorebooks)) {
        console.warn('Old "initialized_lorebooks" array format detected. Migrating to the new object format.');
        const oldArray = variables.initialized_lorebooks as string[];
        const newObject: Record<string, any[]> = {};
        for (const lorebookName of oldArray) {
            newObject[lorebookName] = []; // 按照新格式，值为一个空数组
        }
        variables.initialized_lorebooks = newObject;
    }
    if (!variables.stat_data) {
        variables.stat_data = {};
    }
    if (!variables.schema) {
        variables.schema = {};
    }

    var is_updated = false;
    for (const current_lorebook of enabled_lorebook_list) {
        // 检查方式从 _.includes 变为 _.has，以适应对象结构
        if (_.has(variables.initialized_lorebooks, current_lorebook)) continue;

        // 将知识库名称作为键添加到对象中，值为一个空数组，用于未来存储元数据
        variables.initialized_lorebooks[current_lorebook] = [];
        var init_entries = (await getLorebookEntries(current_lorebook)) as LorebookEntry[];

        for (const entry of init_entries) {
            if (entry.comment?.toLowerCase().includes('[initvar]')) {
                try {
                    const jsonData = YAML.parse(substitudeMacros(entry.content));
                    variables.stat_data = _.merge(variables.stat_data, jsonData);
                } catch (e: any) {
                    // 明确 e 的类型
                    console.error(`Failed to parse JSON from lorebook entry: ${e}`);
                    // @ts-ignore
                    toastr.error(e.message, 'Failed to parse JSON from lorebook entry', {
                        timeOut: 5000,
                    });
                    return;
                }
            }
        }
        is_updated = true;
    }

    // --- 一次性清理所有魔法字符串 ---
    if (is_updated) {
        // 递归遍历整个 stat_data，移除所有魔法字符串
        const cleanData = (data: any) => {
            if (Array.isArray(data)) {
                // 使用 filter 创建一个不含标记的新数组
                const cleanedArray = data.filter(item => item !== EXTENSIBLE_MARKER);
                // 递归清理数组内的对象或数组
                cleanedArray.forEach(cleanData);
                return cleanedArray;
            }
            if (_.isObject(data)) {
                const newObj: Record<string, any> = {};
                const typedData = data as Record<string, any>; // 类型断言
                for (const key in data) {
                    // 递归清理子节点，并将结果赋给新对象
                    newObj[key] = cleanData(typedData[key]);
                }
                return newObj;
            }
            return data;
        };
        // 在生成 Schema 之前，先清理一遍 stat_data
        // 这里需要先生成 Schema，再清理数据
        // 所以还是得用克隆
    }

    // 在所有 lorebook 初始化完成后，生成最终的模式
    if (is_updated || !variables.schema || _.isEmpty(variables.schema)) {
        // 1. 克隆数据用于 Schema 生成
        const dataForSchema = _.cloneDeep(variables.stat_data);
        // 2. generateSchema 会读取并移除克隆体中的标记，生成正确的 schema
        variables.schema = generateSchema(dataForSchema);
        // 3. 现在，清理真实的 stat_data，让它在后续操作中保持干净
        (function cleanUpMetaData(data) {
            // 如果是数组，移除魔法字符串并递归
            if (Array.isArray(data)) {
                let i = data.length;
                while (i--) {
                    if (data[i] === EXTENSIBLE_MARKER) {
                        data.splice(i, 1);
                    } else {
                        // 对数组中的其他元素（可能是对象或数组）进行递归清理
                        cleanUpMetaData(data[i]);
                    }
                }
            }
            // 如果是对象，移除 $meta 并递归
            else if (_.isObject(data) && !_.isDate(data)) {
                // 如果当前对象有 $meta，删除它
                if (data.$meta) {
                    delete data.$meta;
                }
                // 递归清理对象的所有属性值
                for (const key in data) {
                    cleanUpMetaData(data[key]);
                }
            }
        })(variables.stat_data);
    }

    if (!is_updated) {
        return;
    }

    console.info(`Init chat variables.`);
    await insertOrAssignVariables(variables);

    for (var i = 0; i < last_msg.swipes.length; i++) {
        var current_swipe_data = _.cloneDeep(variables);
        // 此处调用的是新版 updateVariables，它将支持更多命令
        // 不再需要手动调用 substitudeMacros，updateVariables 会处理
        await updateVariables(last_msg.swipes[i], current_swipe_data);
        //新版本这个接口给deprecated了，但是新版本的接口不好用，先这样
        //@ts-ignore
        await setChatMessage({ data: current_swipe_data }, last_msg.message_id, {
            refresh: 'none',
            swipe_id: i,
        });
    }

    const expected_settings = {
        /*预期设置*/
        context_percentage: 100,
        recursive: true,
    };
    const settings = await getLorebookSettings();
    if (_.isEqual(_.merge({}, settings, expected_settings), settings)) {
        setLorebookSettings(expected_settings);
    }
}

//window.initCheck = initCheck;
