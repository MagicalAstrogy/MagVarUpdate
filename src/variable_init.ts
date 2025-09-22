// 整体游戏数据类型
import { updateVariables } from '@/function';
import { MvuData } from '@/variable_def';
import JSON5 from 'json5';
import TOML from 'toml';

type LorebookEntry = {
    content: string;
    comment?: string;
};

/**
 * 获取所有启用的 lorebook 列表
 */
export async function getEnabledLorebookList(): Promise<string[]> {
    const lorebook_settings = await getLorebookSettings();
    const enabled_lorebook_list = [...lorebook_settings.selected_global_lorebooks];
    const char_lorebook = await getCurrentCharPrimaryLorebook();
    if (char_lorebook !== null) {
        enabled_lorebook_list.push(char_lorebook);
    }
    return enabled_lorebook_list;
}

/**
 * 从 lorebook 中加载所有 InitVar 数据并合并到提供的 GameData 中
 */
export async function loadInitVarData(
    mvu_data: MvuData,
    lorebook_list?: string[]
): Promise<boolean> {
    const enabled_lorebook_list = lorebook_list || (await getEnabledLorebookList());
    let is_updated = false;

    for (const current_lorebook of enabled_lorebook_list) {
        if (mvu_data.initialized_lorebooks.includes(current_lorebook)) continue;
        mvu_data.initialized_lorebooks.push(current_lorebook);
        const init_entries = (await getLorebookEntries(current_lorebook)) as LorebookEntry[];

        for (const entry of init_entries) {
            if (entry.comment?.toLowerCase().includes('[initvar]')) {
                const content = substitudeMacros(entry.content);
                let parsedData: any = null;
                let parseError: Error | null = null;

                // Try YAML first (which also handles JSON)
                try {
                    parsedData = YAML.parse(content);
                } catch (e) {
                    // Try JSON5
                    try {
                        parsedData = JSON5.parse(content);
                    } catch (e2) {
                        // Try TOML
                        try {
                            parsedData = TOML.parse(content);
                        } catch (e3) {
                            parseError = new Error(
                                `Failed to parse content as YAML/JSON, JSON5, or TOML: ${e3}`
                            );
                        }
                    }
                }

                if (parseError) {
                    console.error(`Failed to parse lorebook entry: ${parseError}`);
                    // @ts-ignore
                    toastr.error(parseError.message, 'Failed to parse lorebook entry', {
                        timeOut: 5000,
                    });
                    throw parseError;
                }

                if (parsedData) {
                    mvu_data.stat_data = _.merge(mvu_data.stat_data, parsedData);
                }
            }
        }
        is_updated = true;
    }

    return is_updated;
}

/**
 * 创建一个新的空 GameData 对象
 */
export function createEmptyGameData(): MvuData {
    return {
        display_data: {},
        initialized_lorebooks: [],
        stat_data: {},
        delta_data: {},
    };
}

/**
 * 获取最后一条消息的变量数据
 */
export async function getLastMessageVariables(): Promise<{
    message: ChatMessageSwiped;
    variables: MvuData | undefined;
}> {
    let last_chat_msg: ChatMessageSwiped[] = [];
    try {
        last_chat_msg = (await getChatMessages(-2, {
            role: 'assistant',
            include_swipes: true,
        })) as ChatMessageSwiped[];
    } catch (e) {
        // 在第一行时，必定发生异常。
    }

    if (!last_chat_msg || last_chat_msg.length <= 0) {
        const first_msg = await getChatMessages(0, {
            include_swipes: true,
        });
        if (first_msg && first_msg.length > 0) {
            last_chat_msg = first_msg;
        } else {
            throw new Error('不存在任何一条消息');
        }
    }

    const last_msg = last_chat_msg[0];
    const variables = last_msg.swipes_data[last_msg.swipe_id] as MvuData & Record<string, any>;

    return { message: last_msg, variables };
}

/**
 * 更新 lorebook 设置为推荐配置
 */
export async function updateLorebookSettings(): Promise<void> {
    /*Ref:https://github.com/lolo-desu/lolocard/blob/master/src/%E6%97%A5%E8%AE%B0%E7%BB%9C%E7%BB%9C/%E8%84%9A%E6%9C%AC/%E8%B0%83%E6%95%B4%E4%B8%96%E7%95%8C%E4%B9%A6%E5%85%A8%E5%B1%80%E8%AE%BE%E7%BD%AE.ts
     */
    const dst_setting: Partial<LorebookSettings> = {
        scan_depth: 2,
        context_percentage: 100,
        budget_cap: 0,
        min_activations: 0,
        max_depth: 0,
        max_recursion_steps: 0,

        insertion_strategy: 'character_first',

        include_names: false,
        recursive: true,
        case_sensitive: false,
        match_whole_words: false,
        use_group_scoring: false,
        overflow_alert: false,
    };
    const settings = getLorebookSettings();
    if (!_.isEqual(_.merge({}, settings, dst_setting), settings)) {
        setLorebookSettings(dst_setting);
    }
}

export async function initCheck() {
    let last_msg: ChatMessageSwiped;
    let variables: MvuData & Record<string, any>;

    try {
        const result = await getLastMessageVariables();
        last_msg = result.message;
        variables = result.variables ?? createEmptyGameData();
    } catch (e) {
        console.error('不存在任何一条消息，退出');
        return;
    }

    // 确保变量结构完整
    if (variables === undefined) {
        variables = createEmptyGameData();
    }
    if (!_.has(variables, 'initialized_lorebooks')) {
        variables.initialized_lorebooks = [];
    }
    if (!variables.stat_data) {
        variables.stat_data = {};
    }

    // 加载 InitVar 数据
    const is_updated = await loadInitVarData(variables);
    if (!is_updated) {
        return;
    }

    console.info(`Init chat variables.`);
    await updateVariablesWith(data => _.assign(data, variables));

    await setChatMessages([
        {
            message_id: last_msg.message_id,
            swipes_data: await Promise.all(
                last_msg.swipes.map(async swipe => {
                    const current_data = _.cloneDeep(variables);
                    await updateVariables(substitudeMacros(swipe), current_data);
                    return current_data;
                })
            ),
        },
    ]);

    // 更新 lorebook 设置
    await updateLorebookSettings();
}

//window.initCheck = initCheck;
