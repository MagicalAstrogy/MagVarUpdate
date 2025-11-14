import TavernHelper = globalThis.TavernHelper;

let sillytavern_version: string = '1.0.0';
export async function initSillyTavernVersion(): Promise<void> {
    sillytavern_version = await fetch('/version')
        .then(res => res.json())
        .then(data => data.pkgVersion)
        .catch(() => '1.0.0');
}
export function getSillyTavernVersion(): string {
    return sillytavern_version;
}

let tavernhelper_version: string = '1.0.0';
export async function initTavernHelperVersion(): Promise<void> {
    tavernhelper_version = await TavernHelper.getTavernHelperVersion();
}
export function getTavernHelperVersion(): string {
    return tavernhelper_version;
}

export function isFunctionCallingSupported() {
    if (!SillyTavern.ToolManager.isToolCallingSupported()) {
        return false;
    }
    if (SillyTavern.chatCompletionSettings.function_calling === false) {
        return false;
    }
    return true;
}

declare const jest: any;
declare const process: any;

export const is_jest_environment =
    typeof jest !== 'undefined' ||
    (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test');

export const saveChatDebounced = _.debounce(SillyTavern.saveChat, 1000);

/**
 * 寻找包含变量信息的最后一个楼层
 * @param end_message_id 从哪一条消息开始倒序搜索(不含那一条)
 */
export function findLastValidMessage(end_message_id: number) {
    return _(SillyTavern.chat)
        .slice(0, end_message_id) // 不包括那个下标
        .findLastIndex(chat_message => {
            return (
                _.get(chat_message, ['variables', chat_message.swipe_id ?? 0, 'stat_data']) !==
                    undefined &&
                _.get(chat_message, ['variables', chat_message.swipe_id ?? 0, 'schema']) !==
                    undefined
            ); //需要同时有 schema 和 stat_data
        });
}

// 酒馆助手 4.1.6 有原生支持, 但为了向后兼容性, 自己包装一层
const stop_lists: Array<() => void> = [];
export function stoppableEventOn<T extends EventType>(event_type: T, listener: ListenerType[T]) {
    eventOn(event_type, listener);
    stop_lists.push(() => eventRemoveListener(event_type, listener));
}
export function clearStoppableEvent() {
    stop_lists.forEach(stop => stop());
}
