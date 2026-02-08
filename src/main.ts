import { registerButtons } from '@/button';
import { cleanupLegacyChat } from '@/function/cleanup/cleanup_legacy_chat';
import { cleanupMessageVariables } from '@/function/cleanup/cleanup_variables';
import { removeChatVariables } from '@/function/cleanup/remove_chat_variables';
import { restoreVariables } from '@/function/cleanup/restore_variables';
import { initGlobals } from '@/function/global';
import { initCheck } from '@/function/init/variable_init';
import { initNotification } from '@/function/notification';
import { filterEntries } from '@/function/request/filter_entries';
import { filterPrompts } from '@/function/request/filter_prompts';
import {
    overrideToolRequest,
    registerFunction,
    unregisterFunction,
} from '@/function/request/function_call';
import { onMessageReceived } from '@/function/response/on_message_received';
import { handleVariablesInMessage } from '@/function/update_variables';
import { initPanel } from '@/panel';
import { useDataStore } from '@/store';
import {
    clearScopedEvent,
    getTavernHelperVersion,
    initSillyTavernVersion,
    initTavernHelperVersion,
    is_jest_environment,
    scopedEventOn,
} from '@/util';
import { compare } from 'compare-versions';

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
    if (store.settings.internal.已开启默认不兼容假流式 === false) {
        store.settings.额外模型解析配置.兼容假流式 = false;
        store.settings.internal.已开启默认不兼容假流式 = true;
    }

    // 对于旧聊天文件, 清理过早楼层的变量
    if (
        store.settings.自动清理变量.启用 &&
        SillyTavern.chat.length > store.settings.自动清理变量.要保留变量的最近楼层数 + 5 &&
        _.has(SillyTavern.chat, [1, 'variables', 0, 'stat_data']) &&
        !_.has(SillyTavern.chat, [1, 'variables', 0, 'ignore_cleanup'])
    ) {
        cleanupLegacyChat();
    }

    // 删除时恢复旧楼层变量
    scopedEventOn(tavern_events.MESSAGE_DELETED, _.debounce(restoreVariables, 2000));

    await initCheck();
    scopedEventOn(tavern_events.GENERATION_STARTED, initCheck);
    scopedEventOn(tavern_events.MESSAGE_SENT, initCheck);
    scopedEventOn(tavern_events.MESSAGE_SENT, handleVariablesInMessage);

    // 3.6.5 版本以上酒馆助手的 `tavern_events` 才存在这个字段, 因此直接用字符串
    scopedEventOn('worldinfo_entries_loaded', filterEntries);

    scopedEventOn(
        tavern_events.MESSAGE_RECEIVED,
        is_jest_environment ? onMessageReceived : _.throttle(onMessageReceived, 3000)
    );

    scopedEventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, overrideToolRequest);
    scopedEventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, filterPrompts);

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
            const counter = cleanupMessageVariables(
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

    if (store.settings.通知.MVU框架加载成功) {
        toastr.info(
            `构建信息: ${__BUILD_DATE__ ?? 'Unknown'} (${__COMMIT_ID__ ?? 'Unknown'})`,
            '[MVU]脚本加载成功'
        );
    }
}

async function destroy() {
    unregisterFunction();
    clearScopedEvent();
}

setActivePinia(getActivePinia() ?? createPinia());

$(async () => {
    const stop_list: Array<() => void> = [];

    await initSillyTavernVersion();
    await initTavernHelperVersion();
    stop_list.push(initPanel());
    stop_list.push(await initGlobals());
    stop_list.push(initNotification());

    $(window).on('pagehide', async () => {
        stop_list.forEach(stop);
    });
});

// TODO: 重新考虑哪些在 CHAT_CHANGED 时应该被重载
eventOn(tavern_events.CHAT_CHANGED, reloadScript);
let current_chat_id = SillyTavern.getCurrentChatId();
function reloadScript(chat_id: string) {
    if (current_chat_id !== chat_id) {
        current_chat_id = chat_id;
        destroy();
        initialize();
    }
}
