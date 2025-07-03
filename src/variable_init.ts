// 整体游戏数据类型
import { updateVariables } from '@/function';
import {GameData} from "@/variable_def";

type LorebookEntry = {
    content: string;
    comment?: string;
};

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
        variables = { display_data: {}, initialized_lorebooks: [], stat_data: {}, delta_data: {} };
    }
    if (!_.has(variables, 'initialized_lorebooks')) {
        variables.initialized_lorebooks = [];
    }
    if (!variables.stat_data) {
        variables.stat_data = {};
    }

    let is_updated = false;
    for (const current_lorebook of enabled_lorebook_list) {
        if (variables.initialized_lorebooks.includes(current_lorebook)) continue;
        variables.initialized_lorebooks.push(current_lorebook);
        const init_entries = (await getLorebookEntries(current_lorebook)) as LorebookEntry[];

        for (const entry of init_entries) {
            if (entry.comment?.toLowerCase().includes('[initvar]')) {
                try {
                    const jsonData = YAML.parse(substitudeMacros(entry.content));
                    variables.stat_data = _.merge(variables.stat_data, jsonData);
                } catch (e) {
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
    if (!is_updated) {
        return;
    }

    console.info(`Init chat variables.`);
    await insertOrAssignVariables(variables);

    for (let i = 0; i < last_msg.swipes.length; i++) {
        const current_swipe_data = _.cloneDeep(variables);
        await updateVariables(substitudeMacros(last_msg.swipes[i]), current_swipe_data);
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
