import { registerButtons, SetReceivedCallbackFn } from '@/button';
import { exportGlobals, unsetGlobals } from '@/export_globals';
import {
    cleanupVariablesInMessages,
    handleVariablesInCallback,
    handleVariablesInMessage,
    updateVariable,
    updateVariables,
} from '@/function';
import { overrideToolRequest, registerFunction, unregisterFunction } from '@/function_call';
import { invokeExtraModelWithStrategy } from '@/invoke_extra_model';
import { showNotifications } from '@/notifications';
import { initPanel } from '@/panel';
import { handlePromptFilter } from '@/prompt_filter';
import { useDataStore } from '@/store';
import {
    clearScopedEvent,
    findLastValidMessage,
    getTavernHelperVersion,
    initSillyTavernVersion,
    initTavernHelperVersion,
    is_jest_environment,
    isFunctionCallingSupported,
    scopedEventOn,
} from '@/util';
import { exported_events, MvuData } from '@/variable_def';
import { initCheck } from '@/variable_init';
import { compare } from 'compare-versions';
import { klona } from 'klona';

async function onMessageReceived(message_id: number, extra_param?: any) {
    const current_chatmsg = getChatMessages(message_id).at(-1);
    if (!current_chatmsg) {
        return;
    }

    const message_content = current_chatmsg.message;
    if (message_content.length < 5) {
        //MESSAGE_RECEIVED 有时候也会在请求的一开始递交，会包含一个 "..." 的消息
        return;
    }

    const store = useDataStore();
    store.runtimes.is_during_extra_analysis = false;

    if (
        store.settings.更新方式 === '随AI输出' ||
        (store.settings.额外模型解析配置.使用函数调用 && !isFunctionCallingSupported()) || //与上面相同的退化情况。
        store.runtimes.is_extra_model_supported === false // 角色卡未适配时, 依旧使用 "随AI输出"
    ) {
        await handleVariablesInMessage(message_id);
        return;
    }

    if (SillyTavern.chat.length <= 1) {
        console.log('[MVU] 对第一层永不进行额外模型解析');
        return;
    }

    if (store.settings.额外模型解析配置.启用自动请求 === false && extra_param !== 'manual_emit') {
        console.log('[MVU] 不自动触发额外模型解析');
        return;
    }

    const result = await invokeExtraModelWithStrategy();
    if (result !== null) {
        const chat_message = getChatMessages(message_id);

        await setChatMessages(
            [
                {
                    message_id,
                    message: chat_message[0].message.trimEnd() + '\n\n' + result,
                },
            ],
            {
                refresh: 'none',
            }
        );
    } else {
        toastr.error(
            '建议调整变量更新方式, 「输入框左下角魔棒-日志查看器」可查看具体情况',
            '[MVU额外模型解析]变量更新失败'
        );
    }
    await handleVariablesInMessage(message_id);
}
async function removeChatVariables() {
    updateVariablesWith(
        variables => {
            _.unset(variables, 'initialized_lorebooks');
            _.unset(variables, 'stat_data');
            _.unset(variables, 'schema');
            _.unset(variables, 'display_data');
            _.unset(variables, 'delta_data');
            return variables;
        },
        { type: 'chat' }
    );
}
async function initialize() {
    if (compare(getTavernHelperVersion(), '3.4.17', '<')) {
        toastr.warning(
            '酒馆助手版本过低, 无法正常处理, 请更新至 3.4.17 或更高版本（建议保持酒馆助手最新）',
            '[MVU]不支持当前酒馆助手版本'
        );
    }

    const store = useDataStore();
    store.resetRuntimes();

    registerButtons();

    if (store.settings.兼容性.更新到聊天变量 === false) {
        await removeChatVariables();
    }

    // 对于旧聊天文件, 清理过早楼层的变量
    if (
        store.settings.自动清理变量.启用 &&
        SillyTavern.chat.length > store.settings.自动清理变量.要保留变量的最近楼层数 + 5 &&
        _.has(SillyTavern.chat, [1, 'variables', 0, 'stat_data']) &&
        !_.has(SillyTavern.chat, [1, 'variables', 0, 'ignore_cleanup'])
    ) {
        const result = await SillyTavern.callGenericPopup(
            '检测可以清理本聊天文件的旧变量从而减少文件体积, 是否清理?(备份会消耗较多内存，手机上建议关闭其他后台应用后进行，或是在计算机上备份)',
            SillyTavern.POPUP_TYPE.CONFIRM,
            '',
            {
                okButton: '仅清理',
                cancelButton: '不再提醒',
                customButtons: ['备份并清理'],
            }
        );
        if (
            result === SillyTavern.POPUP_RESULT.CANCELLED ||
            result === SillyTavern.POPUP_RESULT.NEGATIVE
        ) {
            _.set(SillyTavern.chat, [1, 'variables', 0, 'ignore_cleanup'], true);
        } else {
            toastr.info(
                `即将开始清理就聊天记录的变量${result === SillyTavern.POPUP_RESULT.CUSTOM1 ? '，自动生成备份' : ''}...`,
                '[MVU]自动清理'
            );
            let is_backup_success = false;
            if (result === SillyTavern.POPUP_RESULT.CUSTOM1 || result === 2) {
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
                        toastr.error(
                            `聊天记录导出失败，放弃清理: ${data.message}`,
                            '[MVU]自动清理'
                        );
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
            }
            if (result === SillyTavern.POPUP_RESULT.AFFIRMATIVE || is_backup_success) {
                const counter = cleanupVariablesInMessages(
                    1, //0 层永不清理，以保证始终有快照能力。
                    SillyTavern.chat.length -
                        1 -
                        store.settings.自动清理变量.要保留变量的最近楼层数,
                    store.settings.自动清理变量.快照保留间隔
                );
                if (counter > 0) {
                    toastr.info(`已清理老聊天记录中的 ${counter} 条消息`, '[MVU]自动清理', {
                        timeOut: 1000,
                    });
                }
            }
        }
    }

    // 删除时恢复旧楼层变量
    scopedEventOn(
        tavern_events.MESSAGE_DELETED,
        _.debounce(async () => {
            //默认参数下，debounce 是尾触发的，在这个场景意味着所有删除操作结束后，才会进行恢复操作
            const last_message_id = SillyTavern.chat.length - 1;

            const store = useDataStore();
            const { 触发恢复变量的最近楼层数 } = store.settings.自动清理变量;

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

            const last_20th_message_id = Math.max(
                1,
                last_message_id - store.settings.自动清理变量.要保留变量的最近楼层数
            );
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
                            if (variables.display_data !== undefined) {
                                _.set(data, 'display_data', variables.display_data);
                            } else {
                                _.unset(data, 'display_data');
                            }
                            if (variables.delta_data !== undefined) {
                                _.set(data, 'delta_data', variables.delta_data);
                            } else {
                                _.unset(data, 'delta_data');
                            }
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

    await initCheck();
    scopedEventOn(tavern_events.GENERATION_STARTED, initCheck);
    scopedEventOn(tavern_events.MESSAGE_SENT, initCheck);
    scopedEventOn(tavern_events.MESSAGE_SENT, handleVariablesInMessage);

    // 3.6.5 版本以上酒馆助手的 `tavern_events` 才存在这个字段, 因此直接用字符串
    scopedEventOn('worldinfo_entries_loaded', handlePromptFilter);

    scopedEventOn(
        tavern_events.MESSAGE_RECEIVED,
        is_jest_environment ? onMessageReceived : _.throttle(onMessageReceived, 3000)
    );

    SetReceivedCallbackFn(onMessageReceived);

    scopedEventOn(exported_events.INVOKE_MVU_PROCESS, handleVariablesInCallback);
    scopedEventOn(exported_events.UPDATE_VARIABLE, updateVariable);
    scopedEventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, overrideToolRequest);

    _.set(window.parent, 'handleVariablesInMessage', handleVariablesInMessage);
    registerFunction();

    // 清理旧楼层变量，这个操作的优先级需要比更新操作低，保证在所有事情做完之后，再进行变量的清理。
    scopedEventOn(tavern_events.MESSAGE_RECEIVED, message_id => {
        const store = useDataStore();
        if (!store.settings.自动清理变量.启用) {
            return;
        }
        if (SillyTavern.chat.length % 5 !== 0) {
            return; // 每 5 层执行一次清理。
        }
        const old_message_id = message_id - store.settings.自动清理变量.要保留变量的最近楼层数; //排除对应楼层为user楼层的场合
        if (old_message_id > 0) {
            const counter = cleanupVariablesInMessages(
                //考虑到部分情况下会 消息楼层会是 user，所以需要 * 2，寻找更远范围的。
                Math.max(
                    1,
                    old_message_id - 2 - store.settings.自动清理变量.要保留变量的最近楼层数 * 2
                ), // 因为没有监听 MESSAGE_SENT
                old_message_id,
                store.settings.自动清理变量.快照保留间隔
            );
            console.log(`[MVU]已清理 ${counter} 层的消息`);
        }
    });

    showNotifications();
}

async function destroy() {
    unregisterFunction();
    clearScopedEvent();
}

$(async () => {
    await initSillyTavernVersion();
    await initTavernHelperVersion();
    const { destroy: destroyPanel } = initPanel();
    eventOn(tavern_events.CHAT_CHANGED, reloadScript);
    await initialize();
    await exportGlobals();

    $(window).on('pagehide', async () => {
        destroyPanel();
        destroy();
        unsetGlobals();
    });
});

let current_chat_id = SillyTavern.getCurrentChatId();
function reloadScript(chat_id: string) {
    if (current_chat_id !== chat_id) {
        current_chat_id = chat_id;
        destroy();
        initialize();
    }
}
