import { isMvuData, MvuData } from '@/variable_def';
import * as jsonpatch from 'fast-json-patch';

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
    tavernhelper_version = await getTavernHelperVersion();
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
export function getLastValidMessageId(end_message_id: number): number {
    return _(SillyTavern.chat)
        .slice(0, end_message_id)
        .findLastIndex(chat_message => {
            return isMvuData(_.get(chat_message, ['variables', chat_message.swipe_id ?? 0], {}));
        });
}

export function getLastValidVariable(end_message_id: number): MvuData | undefined {
    const message_id = getLastValidMessageId(end_message_id);
    if (message_id === -1) {
        return undefined;
    }
    return klona(
        _.get(
            SillyTavern.chat[message_id],
            ['variables', SillyTavern.chat[message_id].swipe_id ?? 0],
            {}
        ) as MvuData
    );
}

// 酒馆助手 4.1.6 有原生支持, 但为了向后兼容性, 自己包装一层
const stop_lists: Array<() => void> = [];
export function scopedEventOn<T extends EventType>(event_type: T, listener: ListenerType[T]) {
    eventOn(event_type, listener);
    stop_lists.push(() => eventRemoveListener(event_type, listener));
}
export function clearScopedEvent() {
    stop_lists.forEach(stop => stop());
}

export function isJsonPatch(patch: any): patch is jsonpatch.Operation[] {
    if (!Array.isArray(patch)) {
        return false;
    }
    // An empty array is a valid patch.
    if (patch.length === 0) {
        return true;
    }
    return patch.every(
        op =>
            _.isPlainObject(op) &&
            typeof op.op === 'string' &&
            (typeof op.path === 'string' || (op.op === 'move' && typeof op.to === 'string'))
    );
}

export function showHelpPopup(content: string) {
    SillyTavern.callGenericPopup(content, SillyTavern.POPUP_TYPE.TEXT, '', {
        allowVerticalScrolling: true,
        leftAlign: true,
        wide: true,
    });
}

export function normalizeBaseURL(api_url: string): string {
    api_url = api_url.trim().replace(/\/+$/, '');
    if (!api_url) {
        return '';
    }
    if (api_url.endsWith('/v1')) {
        return api_url;
    }
    if (api_url.endsWith('/models')) {
        return api_url.replace(/\/models$/, '');
    }
    if (api_url.endsWith('/chat/completions')) {
        return api_url.replace(/\/chat\/completions$/, '');
    }
    return `${api_url}/v1`;
}
