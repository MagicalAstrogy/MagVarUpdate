import { registerButtons } from '@/button';
import { exportGlobals } from '@/export_globals';
import { handleVariablesInCallback, handleVariablesInMessage, updateVariable } from '@/function';
import {
    overrideToolRequest,
    registerFunction,
    setFunctionCallEnabled,
    unregisterFunction,
} from '@/function_call';
import { destroyPanel, initPanel } from '@/panel';
import { useSettingsStore } from '@/settings';
import { initSillyTavernVersion, is_jest_environment, isFunctionCallingSupported } from '@/util';
import { exported_events, ExtraLLMRequestContent } from '@/variable_def';
import { initCheck } from '@/variable_init';
import { compare } from 'compare-versions';

/**
 * 标记是否启用提示词筛选，将 [mvu_update] 条目排除在外
 */
let enabledPromptFilter = true;

/**
 * 记录在世界书处理过程中，筛选掉的条目总数，根据总数判断是否需要fallback。
 */
let matchedLores = 0;

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
    if (enabledPromptFilter) {
        const remove_and_count = (lore: Record<string, any>[]) => {
            const filtered = _.remove(lore, entry => {
                const match = entry.comment.match(/\[mvu_update\]/i);
                return !!match;
            });
            return filtered.length;
        };
        matchedLores =
            remove_and_count(lores.globalLore) +
            remove_and_count(lores.characterLore) +
            remove_and_count(lores.chatLore) +
            remove_and_count(lores.personaLore);
    }
}

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

    //const primary_worldbook = getCharWorldbookNames('current').primary;
    if (
        settings.更新方式 === '随AI输出' ||
        //primary_worldbook === null || 这种情况下， matchLores 也等于 0 ，不需要专门比对
        (settings.额外模型解析配置.使用函数调用 && !isFunctionCallingSupported()) || //与上面相同的退化情况。
        // 角色卡未适配时, 依旧使用 "随AI输出"
        matchedLores === 0 // 代表实际上没有任何 世界书条目被筛选掉，也就是并没有对应去支持 [mvu_update] 逻辑。
    ) {
        await handleVariablesInMessage(message_id);
        return;
    }

    enabledPromptFilter = false;
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
        for (retries = 0; retries < 3; retries++) {
            if (settings.通知.额外模型解析中) {
                toastr.info(
                    `[MVU]额外模型分析变量更新中...${retries === 0 ? '' : ` 重试 ${retries}/3`}`
                );
            }
            const current_result = await generateFn(
                settings.额外模型解析配置.模型来源 === '与插头相同'
                    ? {
                          user_input: `遵循后续的 <must> 指令`,
                          injects: promptInjects,
                          max_chat_history: 2,
                      }
                    : {
                          user_input: `遵循后续的 <must> 指令`,
                          custom_api: {
                              apiurl: settings.额外模型解析配置.api地址,
                              key: settings.额外模型解析配置.密钥,
                              model: settings.额外模型解析配置.模型名称,
                          },
                          injects: promptInjects,
                      }
            );
            if (current_result.indexOf('<UpdateVariable>') !== -1) {
                result = current_result;
                break;
            }
        }
    } catch (e) {
        console.error(`变量更新请求发生错误: ${e}`);
        await handleVariablesInMessage(message_id);
        return;
    } finally {
        SillyTavern.unregisterMacro('lastUserMessage');
        setFunctionCallEnabled(false);
        enabledPromptFilter = true;
    }

    if (result !== '') {
        // QUESTION: 目前的方案是直接将额外模型对变量的解析结果直接尾附到楼层中, 会不会像 tool calling 那样把结果新建为一个楼层更好?
        const chat_message = getChatMessages(message_id);
        // 允许在变量更新中包含推理
        const updateContent = result.match(/<UpdateVariable[^>]*>(.*)<\/UpdateVariable[^>]*>/s);
        await setChatMessages(
            [
                {
                    message_id,
                    message: chat_message[0].message + (updateContent?.[0] ?? ''),
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
            '酒馆助手版本过低, 可能无法正常处理, 请更新至 3.4.17 或更高版本（建议保持酒馆助手最新）',
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
        is_jest_environment ? onMessageReceived : _.debounce(onMessageReceived, 3000)
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
    destroyPanel();
    unregisterFunction();
});
