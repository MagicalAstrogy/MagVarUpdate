import {
    createEntryFilterContext,
    type EntryFilterContext,
} from '@/function/request/filter_entries';
import { useDataStore, type MvuSettings } from '@/store';
import { uuidv4 } from '@util/common';

/** 单次额外变量分析的登记信息；标记仅用于本次扫描，不写入持久化数据。 */
export type WorldinfoRequest = {
    generation_id: string;
    marker: string;
    filter_context: EntryFilterContext;
};

/** 仅保存尚未结束的 MVU 额外请求，普通生成不会加入此表。 */
const pending_requests = new Map<string, WorldinfoRequest>();
const MARKER_PREFIX = '__MVU_WI_REQUEST_';
const MARKER_REGEX = /\n?__MVU_WI_REQUEST_[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}__/gi;
const PROMPT_READY = 'chat_completion_prompt_ready';
const SETTINGS_READY = 'chat_completion_settings_ready';

/**
 * 原地清理待发送消息中的请求标记，支持字符串和多模态文本块。
 *
 * 必须同步执行：generateRaw 不等待提示词就绪事件完成，首位监听器需要立即清理。
 * 仅含标记的普通消息会被移除，工具调用及其他多模态内容保留。
 *
 * @param data 提示词就绪事件的 chat，或请求设置就绪事件的 messages。
 */
export function stripWorldinfoRequestMarkers(data: {
    chat?: SillyTavern.SendingMessage[];
    messages?: SillyTavern.SendingMessage[];
}) {
    const messages = data.chat ?? data.messages;
    if (!messages) return;
    // 遍历副本，避免删除当前消息后漏过紧邻的另一条标记消息。
    for (const message of [...messages]) {
        if (typeof message.content === 'string') {
            const original = message.content;
            message.content = original.replace(MARKER_REGEX, '');
            // 原先被禁用的角色描述可能只含标记，不留下额外的空消息。
            if (
                original !== message.content &&
                message.content === '' &&
                message.role !== 'tool' &&
                !('tool_calls' in message)
            ) {
                _.remove(messages, candidate => candidate === message);
            }
        } else if (Array.isArray(message.content)) {
            for (const part of message.content) {
                if (part.type === 'text') {
                    part.text = part.text.replace(MARKER_REGEX, '');
                }
            }
        }
    }
}

/**
 * 为单次额外变量分析登记独立标记和过滤策略快照。
 *
 * 仅在 MVU 与额外分析开关均开启时登记；首个请求安装消息清理监听器，
 * 最后一个请求释放时卸载。策略在请求开始时保存，不随之后的面板修改变化。
 *
 * @param generation_id 本次生成的唯一编号，与传给酒馆助手的编号一致。
 * @param request_settings 用于创建本次世界书过滤快照的额外模型配置。
 * @returns 幂等清理函数；调用方必须在 finally 中执行，未启用时返回空操作。
 * @throws 同一编号已有在途请求时抛出异常。
 */
export async function registerWorldinfoRequest(
    generation_id: string,
    request_settings: MvuSettings['额外模型解析配置']
): Promise<() => void> {
    const store = useDataStore();
    if (!store.should_enable || !store.runtimes.is_during_extra_analysis) return () => {};
    const filter_context = await createEntryFilterContext(true, request_settings);
    if (pending_requests.has(generation_id)) {
        throw new Error(`Worldinfo request is already pending: ${generation_id}`);
    }
    const request = {
        generation_id,
        marker: `${MARKER_PREFIX}${uuidv4()}__`,
        filter_context,
    };
    if (pending_requests.size === 0) {
        // 不依赖聊天级订阅的存活时间；切换聊天或关闭过滤时仍清理正在构建的消息。
        eventMakeFirst(PROMPT_READY, stripWorldinfoRequestMarkers);
        eventMakeFirst(SETTINGS_READY, stripWorldinfoRequestMarkers);
    }
    pending_requests.set(generation_id, request);
    // 按登记对象校验身份，重复清理不能误删随后复用相同编号的请求。
    return () => {
        if (pending_requests.get(generation_id) !== request) return;
        pending_requests.delete(generation_id);
        if (pending_requests.size === 0) {
            eventRemoveListener(PROMPT_READY, stripWorldinfoRequestMarkers);
            eventRemoveListener(SETTINGS_READY, stripWorldinfoRequestMarkers);
        }
    };
}

/**
 * 获取当前在途请求的数组快照，供世界书加载阶段生成识别探针。
 *
 * @returns 新数组中的登记项仍为原对象，调用方应只读使用记录及其过滤策略。
 */
export function getPendingWorldinfoRequests(): readonly WorldinfoRequest[] {
    return Array.from(pending_requests.values());
}

/**
 * 为已登记请求的角色描述覆盖值附加唯一标记。
 *
 * 酒馆助手将该值传入本次扫描的局部 scanData，不写角色卡、世界书缓存或共享注入。
 * 优先保留调用方的描述覆盖值，包括显式空字符串；未覆盖时读取当前角色描述。
 *
 * @param config 即将传给 generate 或 generateRaw 的配置。
 * @returns 已登记时返回附带标记的新配置；未登记时原样返回传入对象。
 */
export function withWorldinfoRequestMarker<T extends GenerateConfig | GenerateRawConfig>(
    config: T
): T {
    const request = config.generation_id ? pending_requests.get(config.generation_id) : undefined;
    if (!request) return config;
    const description =
        config.overrides?.char_description ??
        SillyTavern.getCharacterCardFields()?.description ??
        '';
    return {
        ...config,
        overrides: {
            ...config.overrides,
            char_description: `${description}\n${request.marker}`,
        },
    };
}
