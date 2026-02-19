import * as jsonpatch from 'fast-json-patch';
import { jsonrepair } from 'jsonrepair';
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
export function scopedEventOn<T extends EventType>(event_type: T, listener: ListenerType[T]) {
    eventOn(event_type, listener);
    stop_lists.push(() => eventRemoveListener(event_type, listener));
}
export function clearScopedEvent() {
    stop_lists.forEach(stop => stop());
}

export function literalYamlify(object: Record<string, any>) {
    return YAML.stringify(object, { blockQuote: 'literal' });
}

export function parseString(content: string): any {
    const json_first = /^[[{]/s.test(content.trimStart());
    try {
        return json_first
            ? JSON.parse(jsonrepair(content))
            : YAML.parseDocument(content, { merge: true }).toJS();
    } catch (e1) {
        try {
            return json_first
                ? YAML.parseDocument(content, { merge: true }).toJS()
                : JSON.parse(jsonrepair(content));
        } catch (e2) {
            const toError = (error: unknown) =>
                error instanceof Error
                    ? `${error.stack ? error.stack : error.message}`
                    : String(error);

            const error = { 字符串内容: content };
            _.set(error, json_first ? 'JSON错误信息' : 'YAML错误信息', toError(e1));
            _.set(error, json_first ? 'YAML错误信息' : 'JSON错误信息', toError(e2));
            throw new Error(
                literalYamlify({
                    [`要解析的字符串不是有效的 ${json_first ? 'JSON/YAML' : 'YAML/JSON'} 格式`]:
                        error,
                })
            );
        }
    }
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

// 修正 _.merge 对数组的合并逻辑, [1, 2, 3] 和 [4, 5] 合并后变成 [4, 5] 而不是 [4, 5, 3]
export function correctlyMerge<TObject, TSource>(lhs: TObject, rhs: TSource): TObject & TSource {
    return _.mergeWith(lhs, rhs, (_lhs, rhs) => (_.isArray(rhs) ? rhs : undefined));
}

export function uuidv4(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
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
