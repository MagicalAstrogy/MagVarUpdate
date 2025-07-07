// 整体游戏数据类型
import {updateVariables, getLastValidVariable} from '@/function';
import {GameData} from "@/variable_def";
import {EXTENSIBLE_MARKER, generateSchema} from "@/schema";

type LorebookEntry = {
    content: string;
    comment?: string;
};

// 本函数尝试解决 error_data, delta_data 的同步问题，特此告知。
// 目标：解决 swipe 一次仍然沿用上一个当前楼层swipe的报错信息 的问题，使得swipe一次之后，沿用的是非本楼层的error_data状态与delta_data的上一次MagVarUpdate更新后的状态。
export async function init2() {
    const current_generating_msg_id = getLastMessageId();
    // 如果这是第一次生成 (id < 0), 则无需操作。
    if (current_generating_msg_id < 0) return;
    // 调用已修正的 getLastValidVariable，它能正确地找到上一个稳定消息的状态。
    const last_stable_variables = await getLastValidVariable(current_generating_msg_id);
    if (last_stable_variables && _.has(last_stable_variables, 'stat_data')) {
        // 强制用上一个稳定状态覆盖 chat-level 变量。
        // 这样，即将构建的 prompt 中的 {{get_chat_variable::...}} 就会读取到正确的上下文。
        await replaceVariables(_.cloneDeep(last_stable_variables), { type: 'chat' });
    }
}

export async function initCheck() {
    //generation_started 的最新一条是正在生成的那条。
    let last_chat_msg: ChatMessageSwiped[] = [];
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
        const first_msg = await getChatMessages(0, {
            include_swipes: true,
        });
        if (first_msg && first_msg.length > 0) {
            last_chat_msg = first_msg;
        } else {
            console.error('不存在任何一条消息，退出');
            return;
        }
    }
    const last_msg = last_chat_msg[0];
    //检查最近一条消息的当前swipe
    let variables = last_msg.swipes_data[last_msg.swipe_id] as GameData & Record<string, any>;
    const lorebook_settings = await getLorebookSettings();
    const enabled_lorebook_list = lorebook_settings.selected_global_lorebooks;
    const char_lorebook = await getCurrentCharPrimaryLorebook();
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
            error_data: [],
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

    let is_updated = false;
    for (const current_lorebook of enabled_lorebook_list) {
        // 检查方式从 _.includes 变为 _.has，以适应对象结构
        if (_.has(variables.initialized_lorebooks, current_lorebook)) continue;

        // 将知识库名称作为键添加到对象中，值为一个空数组，用于未来存储元数据
        variables.initialized_lorebooks[current_lorebook] = [];
        const init_entries = (await getLorebookEntries(current_lorebook)) as LorebookEntry[];

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

    for (let i = 0; i < last_msg.swipes.length; i++) {
        const current_swipe_data = _.cloneDeep(variables);
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
