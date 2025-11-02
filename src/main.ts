import { registerButtons, SetExtraModelSupported, SetReceivedCallbackFn } from '@/button';
import { exportGlobals, unsetGlobals } from '@/export_globals';
import {
    cleanupVariablesInMessages,
    handleVariablesInCallback,
    handleVariablesInMessage,
    updateVariable,
    updateVariables,
} from '@/function';
import {
    MVU_FUNCTION_NAME,
    overrideToolRequest,
    registerFunction,
    setFunctionCallEnabled,
    ToolCallBatches,
    unregisterFunction,
} from '@/function_call';
import { destroyPanel, initPanel } from '@/panel';
import { useSettingsStore } from '@/settings';
import {
    findLastValidMessage,
    getSillyTavernVersion,
    initSillyTavernVersion,
    initTavernHelperVersion,
    is_jest_environment,
    isFunctionCallingSupported,
} from '@/util';
import { exported_events, ExtraLLMRequestContent, MvuData } from '@/variable_def';
import { initCheck } from '@/variable_init';
import { compare } from 'compare-versions';
import { klona } from 'klona';

/**
 * 标记是否处于额外模型解析
 */
let duringExtraCall = false;

/**
 * 记录世界书是否支持额外模型
 */
let isExtraModelSupported = false;

async function handlePromptFilter(lores: {
    globalLore: Record<string, any>[];
    characterLore: Record<string, any>[];
    chatLore: Record<string, any>[];
    personaLore: Record<string, any>[];
}) {
    const settings = useSettingsStore().settings;

    //每次开始解析时都进行重置。
    isExtraModelSupported = false;

    //在这个回调中，会将所有lore的条目传入，此处可以去除所有 [mvu_update] 相关的条目，避免在非更新的轮次中输出相关内容。
    if (settings.更新方式 === '随AI输出') {
        return;
    }
    if (settings.额外模型解析配置.使用函数调用 && !isFunctionCallingSupported()) {
        toastr.warning(
            '当前预设/API 不支持函数调用，已退化回 `随AI输出`',
            '[MVU]无法使用函数调用',
            {
                timeOut: 2000,
            }
        );
        return;
    }

    const update_regex = /\[mvu_update\]/i;
    const plot_regex = /\[mvu_plot\]/i;
    const remove_and_check = (lore: Record<string, any>[]) => {
        const filtered = _.remove(lore, entry => {
            const is_update_regex = entry.comment.match(update_regex);
            const is_plot_regex = entry.comment.match(plot_regex);
            return duringExtraCall
                ? is_plot_regex && !is_update_regex
                : !is_plot_regex && is_update_regex;
        });
        if (filtered.length > 0) {
            isExtraModelSupported = true;
        }
    };
    remove_and_check(lores.globalLore);
    remove_and_check(lores.characterLore);
    remove_and_check(lores.chatLore);
    remove_and_check(lores.personaLore);
}

let vanilla_parseToolCalls: any = null;

async function onMessageReceived(message_id: number) {
    const current_chatmsg = getChatMessages(message_id).at(-1);
    if (!current_chatmsg) {
        return;
    }

    const message_content = current_chatmsg.message;
    if (message_content.length < 5) {
        //MESSAGE_RECEIVED 有时候也会在请求的一开始递交，会包含一个 "..." 的消息
        return;
    }

    const settings = useSettingsStore().settings;
    duringExtraCall = false;

    SetExtraModelSupported(isExtraModelSupported);
    if (
        settings.更新方式 === '随AI输出' ||
        (settings.额外模型解析配置.使用函数调用 && !isFunctionCallingSupported()) || //与上面相同的退化情况。
        isExtraModelSupported === false // 角色卡未适配时, 依旧使用 "随AI输出"
    ) {
        await handleVariablesInMessage(message_id);
        return;
    }

    duringExtraCall = true;
    let user_input = ExtraLLMRequestContent;
    if (settings.额外模型解析配置.使用函数调用) {
        user_input += `\n use \`mvu_VariableUpdate\` tool to update variables.`;
    }
    const generateFn = settings.额外模型解析配置.发送预设 === false ? generateRaw : generate;

    let result: string = '';
    let retries = 0;

    try {
        setFunctionCallEnabled(true);
        //因为部分预设会用到 {{lastUserMessage}}，因此进行修正。
        console.log('Before RegisterMacro');
        if (compare(getSillyTavernVersion(), '1.13.4', '<=')) {
            //https://github.com/SillyTavern/SillyTavern/pull/4614
            //需要等待1s来错开 dry_run
            await new Promise(res => setTimeout(res, 1000));
        }
        SillyTavern.registerMacro('lastUserMessage', () => {
            return user_input;
        });
        console.log('After RegisterMacro');
        const promptInjects: InjectionPrompt[] = [
            {
                id: '817114514',
                position: 'in_chat',
                depth: 0,
                should_scan: false,
                role: 'system',
                content: user_input,
            },
            {
                id: '817114515',
                position: 'in_chat',
                depth: 2,
                should_scan: false,
                role: 'assistant',
                content: '<past_observe>',
            },
            {
                id: '817114516',
                position: 'in_chat',
                depth: 1,
                should_scan: false,
                role: 'assistant',
                content: '</past_observe>',
            },
        ]; //部分预设会在后面强调 user_input 的演绎行为，需要找个方式肘掉它

        let collected_tool_calls: ToolCallBatches | undefined = undefined;
        if (settings.额外模型解析配置.使用函数调用) {
            vanilla_parseToolCalls = SillyTavern.ToolManager.parseToolCalls;
            const vanilla_bound = SillyTavern.ToolManager.parseToolCalls.bind(
                SillyTavern.ToolManager
            );
            SillyTavern.ToolManager.parseToolCalls = (tool_calls: any, parsed: any) => {
                vanilla_bound(tool_calls, parsed);
                collected_tool_calls = tool_calls;
            };
        }

        for (retries = 0; retries < 3; retries++) {
            if (settings.通知.额外模型解析中) {
                toastr.info(
                    `[MVU]额外模型分析变量更新中...${retries === 0 ? '' : ` 重试 ${retries}/3`}`
                );
            }
            collected_tool_calls = undefined;
            const current_result = await generateFn(
                settings.额外模型解析配置.模型来源 === '与插头相同'
                    ? {
                          user_input: `遵循后续的 <must> 指令`,
                          injects: promptInjects,
                          max_chat_history: 2,
                          should_stream: settings.额外模型解析配置.使用函数调用,
                      }
                    : {
                          user_input: `遵循后续的 <must> 指令`,
                          custom_api: {
                              apiurl: settings.额外模型解析配置.api地址,
                              key: settings.额外模型解析配置.密钥,
                              model: settings.额外模型解析配置.模型名称,
                              temperature: settings.额外模型解析配置.温度,
                              frequency_penalty: settings.额外模型解析配置.频率惩罚,
                              presence_penalty: settings.额外模型解析配置.存在惩罚,
                              max_tokens: settings.额外模型解析配置.最大回复token数,
                          },
                          injects: promptInjects,
                          max_chat_history: 2,
                          should_stream: settings.额外模型解析配置.使用函数调用,
                      }
            );
            if (collected_tool_calls !== undefined) {
                const content = _.get(collected_tool_calls as ToolCallBatches, '[0]');
                if (content) {
                    const mvu_function_call = _(content).findLast(
                        fn => fn.function.name === MVU_FUNCTION_NAME
                    );
                    if (mvu_function_call) {
                        const mvu_function_call_content = _.get(
                            mvu_function_call,
                            'function.arguments'
                        );
                        if (mvu_function_call_content) {
                            try {
                                const mvu_function_call_json =
                                    JSON.parse(mvu_function_call_content);
                                if (
                                    mvu_function_call_json.delta &&
                                    mvu_function_call_json.delta.length > 5
                                ) {
                                    result = `<UpdateVariable><Analyze>${mvu_function_call_json.analysis}</Analyze>${mvu_function_call_json.delta}</UpdateVariable>`;
                                    break;
                                }
                            } catch (e) {
                                console.log(
                                    `failed to parse function call content,retry: ${mvu_function_call_content}: ${e}`
                                );
                            }
                        }
                    }
                }
            }
            console.log(`Vanilla Response: ${current_result}`);
            if (current_result.indexOf('<UpdateVariable>') !== -1) {
                //至少要出现一个变量设置语句，因为可能会有跑完thinking 直接截断的情况。
                //此外还存在<UpdateVariable><UpdateVariable></UpdateVariable> 的情况
                //因为可能在 thinking 中提及需要输出 <UpdateVariable> 块。
                const lastUpdateVariableIndex = current_result.lastIndexOf('<UpdateVariable>');
                const last_content = current_result
                    .slice(lastUpdateVariableIndex + 16)
                    .replace(/<\/UpdateVariable>/g, '');
                const fn_call_match =
                    /_\.(?:set|insert|assign|remove|unset|delete|add)\s*\([\s\S]*?\)\s*;/.test(
                        last_content
                    );
                if (fn_call_match) {
                    result = `<UpdateVariable>${last_content}</UpdateVariable>`;
                    break;
                }
            }
        }
    } catch (e) {
        console.error(`变量更新请求发生错误: ${e}`);
        await handleVariablesInMessage(message_id);
        return;
    } finally {
        if (vanilla_parseToolCalls !== null) {
            SillyTavern.ToolManager.parseToolCalls = vanilla_parseToolCalls;
            vanilla_parseToolCalls = null;
        }
        SillyTavern.unregisterMacro('lastUserMessage');
        setFunctionCallEnabled(false);
        duringExtraCall = false;
        //因为 generate 过程中会使得这个变量变为 false，影响重试。
        isExtraModelSupported = true;
    }

    if (result !== '') {
        // QUESTION: 目前的方案是直接将额外模型对变量的解析结果直接尾附到楼层中, 会不会像 tool calling 那样把结果新建为一个楼层更好?
        const chat_message = getChatMessages(message_id);

        await setChatMessages(
            [
                {
                    message_id,
                    message: chat_message[0].message + result,
                },
            ],
            {
                refresh: 'none',
            }
        );
    } else {
        toastr.error('建议调整变量更新方式/额外模型解析模式', '[MVU]额外模型分析变量更新失败');
    }
    await handleVariablesInMessage(message_id);
}
async function initialize() {
    await initSillyTavernVersion();
    await initTavernHelperVersion();

    if (compare(getTavernHelperVersion(), '3.4.17', '<')) {
        toastr.warning(
            '酒馆助手版本过低, 无法正常处理, 请更新至 3.4.17 或更高版本（建议保持酒馆助手最新）',
            '[MVU]不支持当前酒馆助手版本'
        );
    }

    const store = useSettingsStore();

    registerButtons();
    const { 要保留变量的最近楼层数, 启用 } = store.settings.auto_cleanup;

    // 对于旧聊天文件, 清理过早楼层的变量
    if (
        启用 &&
        SillyTavern.chat.length > 要保留变量的最近楼层数 &&
        _.has(SillyTavern.chat, [1, 'variables', 0, 'stat_data'])
    ) {
        toastr.info('即将开始清理就聊天记录的变量，自动生成备份...', '[MVU]自动清理');
        let is_backup_success = false;
        try {
            const body = {
                is_group: false,
                avatar_url: SillyTavern.characters[Number(SillyTavern.characterId)]?.avatar,
                file: `${SillyTavern.getCurrentChatId()}.jsonl`,
                exportfilename: `${SillyTavern.getCurrentChatId()}.jsonl`,
                format: 'jsonl',
            };

            const response = await fetch('/api/chats/export', {
                method: 'POST',
                body: JSON.stringify(body),
                headers: SillyTavern.getRequestHeaders(),
            });
            const data = await response.json();
            if (!response.ok) {
                toastr.error(`聊天记录导出失败，放弃清理: ${data.message}`, '[MVU]自动清理');
            } else {
                toastr.success(data.message);
                //自动发起一个下载
                const serialized = data.result;
                const blob = new Blob([serialized], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = body.exportfilename;
                link.click();
                URL.revokeObjectURL(url);
                is_backup_success = true;
            }
        } catch (error) {
            // display error message
            toastr.error(`聊天记录导出失败，放弃清理: ${error}`, '[MVU]自动清理');
        }
        if (is_backup_success) {
            const counter = cleanupVariablesInMessages(
                1, //0 层永不清理，以保证始终有快照能力。
                SillyTavern.chat.length - 1 - 要保留变量的最近楼层数,
                store.settings.快照保留间隔
            );
            if (counter > 0) {
                toastr.info(`已清理老聊天记录中的 ${counter} 条消息`, '[MVU]自动清理', {
                    timeOut: 1000,
                });
            }
        }
    }

    // 删除时恢复旧楼层变量
    eventOn(
        tavern_events.MESSAGE_DELETED,
        _.debounce(async () => {
            //默认参数下，debounce 是尾触发的，在这个场景意味着所有删除操作结束后，才会进行恢复操作
            const last_message_id = SillyTavern.chat.length - 1;

            const store = useSettingsStore();
            const { 触发恢复变量的最近楼层数 } = store.settings.auto_cleanup;

            const last_10th_message_id = Math.max(1, last_message_id - 触发恢复变量的最近楼层数);
            const last_not_has_variable_message_id = SillyTavern.chat.findLastIndex(
                chat_message =>
                    !_.has(chat_message, ['variables', chat_message.swipe_id ?? 0, 'stat_data']) ||
                    !_.has(chat_message, ['variables', chat_message.swipe_id ?? 0, 'schema'])
            );
            if (last_10th_message_id > last_not_has_variable_message_id) {
                // 最近 10 楼都还有楼层变量
                console.info(`最近 ${触发恢复变量的最近楼层数} 层都包含变量数据，不需要进行恢复。`);
                return;
            }

            const last_20th_message_id = Math.max(1, last_message_id - 要保留变量的最近楼层数);
            const snapshot_message_id = findLastValidMessage(last_20th_message_id);
            if (
                snapshot_message_id === -1 ||
                !_.has(SillyTavern.chat, [snapshot_message_id, 'variables', 0, 'stat_data'])
            ) {
                // 无法恢复
                toastr.warning(
                    `在 0 ~ ${last_20th_message_id} 层找不到有效的变量信息，无法进行楼层变量恢复`,
                    '[MVU]恢复旧楼层变量'
                );
                return;
            }
            const snapshot_chat_message = SillyTavern.chat[snapshot_message_id];

            toastr.info(`恢复变量内容中...`, '[MVU]恢复旧楼层变量', { timeOut: 1000 });

            //需要一条一条的进行重演，才能保证 start/end 事件符合预期地触发，保证 "同一轮次内最多增加10" 类逻辑能正常运行。
            let message = SillyTavern.chat[snapshot_message_id + 1].mes;
            let variables = klona(
                snapshot_chat_message.variables![snapshot_chat_message.swipe_id ?? 0] as MvuData
            );
            for (let i = snapshot_message_id + 1; i <= last_not_has_variable_message_id; i++) {
                message = SillyTavern.chat[i].mes;
                //每一层被赋值的变量状态是当前层的变量更新已处理的状态
                await updateVariables(message, variables);
                const chat_message = SillyTavern.chat[i];
                const is_valid_message =
                    _.has(chat_message, ['variables', chat_message.swipe_id ?? 0, 'stat_data']) &&
                    _.has(chat_message, ['variables', chat_message.swipe_id ?? 0, 'schema']);

                //如果原本当前 message_id 是一个快照，那么不对它进行变更。
                //原因是如果一切逻辑正常运行，assert这个楼层的内容应该是与重演一致的。
                //在这里不进行修改，之后如果出现问题了，可以通过传递聊天记录，来比较轻松的定位到。
                if (i >= last_20th_message_id && !is_valid_message) {
                    await updateVariablesWith(
                        data => {
                            data.initialized_lorebooks = variables.initialized_lorebooks;
                            data.stat_data = variables.stat_data;
                            if (variables.schema !== undefined) {
                                data.schema = variables.schema;
                            } else {
                                _.unset(data, 'schema');
                            }
                            data.display_data = variables.display_data;
                            data.delta_data = variables.delta_data;
                            return data;
                        },
                        { type: 'message', message_id: i }
                    );
                    //因为原本variables 里面的对象引用，已经用在对应楼层的变量中了，所以需要重新进行一次深复制。
                    variables = klona(variables);
                }
                // 在没有进行 update 的场合，也就不需要重新进行深复制了
            }

            toastr.info(`恢复完成。`, '[MVU]恢复旧楼层变量', { timeOut: 3000 });
        }, 2000)
    );

    eventOn(tavern_events.GENERATION_STARTED, initCheck);
    eventOn(tavern_events.MESSAGE_SENT, initCheck);
    eventOn(tavern_events.MESSAGE_SENT, handleVariablesInMessage);

    // 3.6.5 版本以上酒馆助手的 `tavern_events` 才存在这个字段, 因此直接用字符串
    eventOn('worldinfo_entries_loaded', handlePromptFilter);

    eventOn(
        tavern_events.MESSAGE_RECEIVED,
        is_jest_environment ? onMessageReceived : _.throttle(onMessageReceived, 3000)
    );
    SetReceivedCallbackFn(onMessageReceived);

    eventOn(exported_events.INVOKE_MVU_PROCESS, handleVariablesInCallback);
    eventOn(exported_events.UPDATE_VARIABLE, updateVariable);
    eventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, overrideToolRequest);
    eventOn(tavern_events.CHAT_CHANGED, reloadScript);

    _.set(window.parent, 'handleVariablesInMessage', handleVariablesInMessage);
    registerFunction();

    // 清理旧楼层变量，这个操作的优先级需要比更新操作低，保证在所有事情做完之后，再进行变量的清理。
    eventOn(tavern_events.MESSAGE_RECEIVED, message_id => {
        const store = useSettingsStore();
        const { 启用 } = store.settings.auto_cleanup;
        if (!启用) {
            return;
        }
        if (SillyTavern.chat.length % 5 !== 0) {
            return; // 每 5 层执行一次清理。
        }
        const old_message_id = message_id - 要保留变量的最近楼层数; //排除对应楼层为user楼层的场合
        if (old_message_id > 0) {
            const counter = cleanupVariablesInMessages(
                //考虑到部分情况下会 消息楼层会是 user，所以需要 * 2，寻找更远范围的。
                Math.max(1, old_message_id - 2 - 要保留变量的最近楼层数 * 2), // 因为没有监听 MESSAGE_SENT
                old_message_id,
                store.settings.快照保留间隔
            );
            console.log(`[MVU]已清理 ${counter} 层的消息`);
        }
    });

    if (store.settings.internal.已提醒更新了配置界面 === false) {
        toastr.info(
            '配置界面位于酒馆扩展界面-「正则」下方, 请点开了解新功能或自定义配置',
            '[MVU]已更新独立配置界面'
        );
        store.settings.internal.已提醒更新了配置界面 = true;
    }
    if (store.settings.internal.已提醒自动清理旧变量功能 === false) {
        toastr.info(
            'MVU 现在可以自动清理旧变量来减少聊天文件大小; 这不会影响你回退游玩以前的楼层；在设置中开启 `变量自动清理` 启用',
            '[MVU]已更新自动清理旧变量功能'
        );
        store.settings.internal.已提醒自动清理旧变量功能 = true;
    }
    if (store.settings.internal.已提醒更新了API温度等配置 === false) {
        toastr.info(
            'MVU 现在可以自定义 API 的温度、频率惩罚、存在惩罚、最大回复 token 数；需要酒馆助手版本 >= 4.0.14',
            '[MVU]已更新更多自定义API配置'
        );
        store.settings.internal.已提醒更新了API温度等配置 = true;
    }
    toastr.info(
        `构建信息: ${__BUILD_DATE__ ?? 'Unknown'} (${__COMMIT_ID__ ?? 'Unknown'})`,
        '[MVU]脚本加载成功'
    );
}

async function destroy() {
    if (vanilla_parseToolCalls !== null) {
        SillyTavern.ToolManager.parseToolCalls = vanilla_parseToolCalls;
        vanilla_parseToolCalls = null;
    }
    unregisterFunction();
    eventClearAll();
}

$(() => {
    exportGlobals();
    initPanel();
    initialize();
});
$(window).on('pagehide', async () => {
    destroyPanel();
    destroy();
    unsetGlobals();
});
let current_chat_id = SillyTavern.getCurrentChatId();
function reloadScript(chat_id: string) {
    if (current_chat_id !== chat_id) {
        current_chat_id = chat_id;
        destroy();
        initialize();
    }
}
