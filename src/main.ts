import { registerButtons } from '@/button';
import { exportGlobals } from '@/export_globals';
import { handleVariablesInCallback, handleVariablesInMessage, updateVariable } from '@/function';
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
    getSillyTavernVersion,
    initSillyTavernVersion,
    is_jest_environment,
    isFunctionCallingSupported,
} from '@/util';
import { exported_events, ExtraLLMRequestContent } from '@/variable_def';
import { initCheck } from '@/variable_init';
import { compare } from 'compare-versions';

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

    const remove_and_check = (lore: Record<string, any>[], regex: RegExp) => {
        const filtered = _.remove(lore, entry => {
            const match = entry.comment.match(regex);
            return !!match;
        });
        if (filtered.length > 0) {
            isExtraModelSupported = true;
        }
    };
    const regex_to_remove = duringExtraCall ? /\[mvu_update\]/i : /\[mvu_plot\]/i;
    remove_and_check(lores.globalLore, regex_to_remove);
    remove_and_check(lores.characterLore, regex_to_remove);
    remove_and_check(lores.chatLore, regex_to_remove);
    remove_and_check(lores.personaLore, regex_to_remove);
}

let vanilla_parseToolCalls: any = null;

async function onMessageReceived(message_id: number) {
    const current_chatmsg = getChatMessages(message_id).at(-1);
    if (!current_chatmsg) {
        return;
    }
    //

    const message_content = current_chatmsg.message;
    if (message_content.length < 5) {
        //MESSAGE_RECEIVED 有时候也会在请求的一开始递交，会包含一个 "..." 的消息
        return;
    }

    const settings = useSettingsStore().settings;

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
                          },
                          injects: promptInjects,
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

$(async () => {
    if (compare(await getTavernHelperVersion(), '3.4.17', '<')) {
        toastr.warning(
            '酒馆助手版本过低, 无法正常处理, 请更新至 3.4.17 或更高版本（建议保持酒馆助手最新）',
            '[MVU]不支持当前酒馆助手版本'
        );
    }

    await initSillyTavernVersion();

    initPanel();

    exportGlobals();
    registerButtons();
    eventOn(tavern_events.GENERATION_STARTED, initCheck);
    eventOn(tavern_events.MESSAGE_SENT, initCheck);
    eventOn(tavern_events.MESSAGE_SENT, handleVariablesInMessage);

    // 3.6.5 版本以上酒馆助手的 `tavern_events` 才存在这个字段, 因此直接用字符串
    eventOn('worldinfo_entries_loaded', handlePromptFilter);

    eventOn(
        tavern_events.MESSAGE_RECEIVED,
        is_jest_environment ? onMessageReceived : _.throttle(onMessageReceived, 3000)
    );

    eventOn(exported_events.INVOKE_MVU_PROCESS, handleVariablesInCallback);
    eventOn(exported_events.UPDATE_VARIABLE, updateVariable);
    eventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, overrideToolRequest);

    _.set(window.parent, 'handleVariablesInMessage', handleVariablesInMessage);
    registerFunction();

    toastr.info(
        `构建信息: ${__BUILD_DATE__ ?? 'Unknown'} (${__COMMIT_ID__ ?? 'Unknown'})`,
        '[MVU]脚本加载成功'
    );
});

$(window).on('pagehide', () => {
    if (vanilla_parseToolCalls !== null) {
        SillyTavern.ToolManager.parseToolCalls = vanilla_parseToolCalls;
        vanilla_parseToolCalls = null;
    }
    destroyPanel();
    unregisterFunction();
});
