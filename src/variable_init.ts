// 整体游戏数据类型
import { updateVariables } from '@/function';
import { GameData } from '@/main';

type LorebookEntry = {
    content: string;
    comment?: string;
};

// 模式生成函数
/**
 * 递归地为数据对象生成一个模式。
 * @param data - 要为其生成模式的数据对象 (stat_data)。
 * @returns - 生成的模式对象。
 */
function generateSchema(data: any): any {
    if (Array.isArray(data)) {
        // 数组将其元素的 schema 生成委托出去
        return {
            type: 'array',
            elementType: data.length > 0 ? generateSchema(data[0]) : { type: 'any' },
        };
    }
    if (_.isObject(data) && !_.isDate(data)) {
        const typedData = data as Record<string, any>; // 类型断言
        const schemaNode: any = {
            type: 'object',
            properties: {},
            extensible: false,
        };

        // 检查当前节点是否可扩展
        let isCurrentlyExtensible = false;
        if (typedData.$meta) {
            if (typedData.$meta.extensible) {
                schemaNode.extensible = true;
                isCurrentlyExtensible = true; // 标记当前节点是可扩展的
            }
            // 从实际数据中移除 $meta 键
            delete typedData.$meta;
        }

        for (const key in data) {
            // 递归生成子节点的 schema
            const childSchema = generateSchema(typedData[key]);

            // 子节点是否必需，取决于当前节点 (即其父节点) 是否可扩展。
            // 如果当前节点是可扩展的 (isCurrentlyExtensible is true)，那么其子节点就不是必需的。
            childSchema.required = !isCurrentlyExtensible;

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
                    const jsonData = JSON.parse(substitudeMacros(entry.content));
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

    // 在所有 lorebook 初始化完成后，生成最终的模式
    if (is_updated || !variables.schema || _.isEmpty(variables.schema)) {
        variables.schema = generateSchema(_.cloneDeep(variables.stat_data));
    }

    if (!is_updated) {
        return;
    }

    console.info(`Init chat variables.`);
    await insertOrAssignVariables(variables);

    for (var i = 0; i < last_msg.swipes.length; i++) {
        var current_swipe_data = _.cloneDeep(variables);
        // 此处调用的是新版 updateVariables，它将支持 insert/delete
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
