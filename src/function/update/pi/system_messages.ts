import type { Api, Context, Message, TextContent } from './pi_gateway';
import {
    PiContextAdapterError,
    type PiContextAdapterResult,
    type PiLateSystemMessage,
} from './context_adapter';

/** 一次请求的 system 恢复桥接；context 仅供 Pi 构造请求，restore 必须用于 onPayload。 */
export interface PiSystemMessageBridge {
    context: Context;
    restore: (payload: unknown) => unknown;
    /** Pi 会把 hook 异常转为普通服务商错误，保留原始分类供运行时取回。 */
    readonly failure: PiContextAdapterError | undefined;
    assertRestored: () => void;
}

/** 同一原始位置的一组 system，锚定到下一条实际消息，不额外伪造对话回合。 */
type SystemAnchor = {
    marker: string;
    messages: readonly PiLateSystemMessage[];
};

/** 对服务商 JSON 节点移除锚点后的结果；remove 仅用于锚点独占的临时文本块。 */
type CleanedNode = { value: unknown; anchors: SystemAnchor[]; remove?: boolean };

let nextAnchorNamespace = 0;

/** 选用原始内容中不存在的请求级标记，防止用户文本被误识别为内部锚点。 */
function containsMarker(value: unknown, prefix: string): boolean {
    if (typeof value === 'string') return value.includes(prefix);
    if (Array.isArray(value)) return value.some(item => containsMarker(item, prefix));
    if (value && typeof value === 'object') {
        return Object.values(value).some(item => containsMarker(item, prefix));
    }
    return false;
}

/** 在已有消息的首个文本块前加锚点；保留消息角色，避免打断 Pi 的工具调用关联。 */
function anchorMessage(message: Message, marker: string, api: Api): Message {
    if (typeof message.content === 'string') {
        return { ...message, role: 'user', content: marker + message.content };
    }
    const content = [...message.content];
    const index = content.findIndex(block => block.type === 'text');
    let fallback = '';
    if (
        message.role === 'toolResult' &&
        !message.content
            .filter((block): block is TextContent => block.type === 'text')
            .map(block => block.text)
            .join('\n')
    ) {
        const hasImages = message.content.some(block => block.type === 'image');
        // 锚点不能抑制 SDK 原本为无文本工具结果生成的占位说明。
        if (api === 'openai-completions' || api === 'mistral-conversations') {
            fallback = hasImages ? '(see attached image)' : '(no tool output)';
        } else if (!hasImages && ['openai-responses', 'openai-codex-responses'].includes(api)) {
            fallback = '(no tool output)';
        }
    }
    if (index === -1) {
        content.unshift({ type: 'text', text: marker + fallback });
    } else {
        const block = content[index] as TextContent;
        content[index] = { ...block, text: marker + block.text + fallback };
    }
    return { ...message, content } as Message;
}

/** 按实际协议和消息位置自动选择角色，不暴露额外的渠道配置。 */
function systemMessageRole(
    context: Context,
    api: Api,
    message: PiLateSystemMessage
): 'system' | 'user' {
    if (api === 'google-generative-ai') return 'user';
    if (api === 'anthropic-messages') {
        const previous = context.messages[message.beforeMessageIndex - 1];
        const next = context.messages[message.beforeMessageIndex];
        // toolResult 在 Anthropic 协议里是携带工具结果的 user 回合。
        return (previous?.role === 'user' || previous?.role === 'toolResult') &&
            (!next || next.role === 'assistant')
            ? 'system'
            : 'user';
    }
    return 'system';
}

/**
 * 保留普通消息角色，在服务商完成拆分/合并之后按内容锚点恢复 system；不符合协议约束时转为 user。
 * 锚点只进入待转换的文本，发送前必须恰好移除一次；不修改捕获输入、共享上下文或全局 fetch。
 */
export function createPiSystemMessageBridge(
    adapted: PiContextAdapterResult,
    api: Api
): PiSystemMessageBridge {
    const { context, lateSystemMessages } = adapted;
    if (!lateSystemMessages.length) {
        return {
            context,
            restore: payload => payload,
            failure: undefined,
            assertRestored: () => {},
        };
    }

    let prefix: string;
    do {
        prefix = `__mvu_pi_system_anchor_${++nextAnchorNamespace}_`;
    } while (containsMarker(adapted, prefix));

    const groups = new Map<number, PiLateSystemMessage[]>();
    for (const message of lateSystemMessages) {
        const group = groups.get(message.beforeMessageIndex) ?? [];
        group.push(message);
        groups.set(message.beforeMessageIndex, group);
    }
    const anchors: SystemAnchor[] = [];
    const messages = context.messages.map((message, index) => {
        const group = groups.get(index);
        if (!group) return message;
        const anchor = { marker: `${prefix}${index}__`, messages: group };
        anchors.push(anchor);
        return anchorMessage(message, anchor.marker, api);
    });
    const tail = groups.get(context.messages.length) ?? [];
    const field =
        api === 'google-generative-ai'
            ? 'contents'
            : api === 'openai-responses' || api === 'openai-codex-responses'
              ? 'input'
              : 'messages';
    const hasUserFallback = lateSystemMessages.some(
        message => systemMessageRole(context, api, message) === 'user'
    );
    let failure: PiContextAdapterError | undefined;
    let applied = false;
    const restoredPayloads = new WeakSet<object>();

    const mismatch = () =>
        new PiContextAdapterError(
            'More source could not restore intermediate system messages in the provider payload.',
            'system-payload-mismatch',
            lateSystemMessages[0].sourceIndex
        );
    const nativeMessages = (group: readonly PiLateSystemMessage[]) =>
        group.map(message =>
            api === 'google-generative-ai'
                ? { role: 'user', parts: [{ text: message.text }] }
                : { role: systemMessageRole(context, api, message), content: message.text }
        );

    /** 工具结果可能被 SDK 合并进同一 user；按工具结果块拆出插入边界，避免把指令提前到整组结果前。 */
    const splitToolResultGroups = (items: unknown[]): unknown[] =>
        items.flatMap(item => {
            if (!item || typeof item !== 'object' || !hasUserFallback) return [item];
            const message = item as Record<string, unknown>;
            const key = api === 'google-generative-ai' ? 'parts' : 'content';
            const blocks = message[key];
            if (message.role !== 'user' || !Array.isArray(blocks)) return [item];
            const result: unknown[] = [];
            let current: unknown[] = [];
            for (const block of blocks) {
                const isToolResult =
                    block &&
                    typeof block === 'object' &&
                    (block.type === 'tool_result' || block.functionResponse);
                if (isToolResult && current.length && containsMarker(block, prefix)) {
                    result.push({ ...message, [key]: current });
                    current = [];
                }
                current.push(block);
            }
            result.push({ ...message, [key]: current });
            return result;
        });

    /** 与酒馆兼容处理一致，user 回退后合并相邻 user，同时保留内容块、图片及工具结果的顺序。 */
    const mergeFallbackUsers = (items: unknown[]): unknown[] => {
        if (!hasUserFallback || (api !== 'anthropic-messages' && api !== 'google-generative-ai'))
            return items;
        const key = api === 'google-generative-ai' ? 'parts' : 'content';
        const asBlocks = (value: unknown) =>
            typeof value === 'string' ? [{ type: 'text', text: value }] : value;
        const merged: unknown[] = [];
        for (const item of items) {
            const current = item as Record<string, unknown>;
            const previous = merged.at(-1) as Record<string, unknown> | undefined;
            if (current?.role === 'user' && previous?.role === 'user') {
                const before = asBlocks(previous[key]);
                const after = asBlocks(current[key]);
                if (Array.isArray(before) && Array.isArray(after)) {
                    merged[merged.length - 1] = { ...previous, [key]: [...before, ...after] };
                    continue;
                }
            }
            merged.push(item);
        }
        return merged;
    };

    /** 只遍历原生消息字段；完整保留工具 ID、图片、缓存标记和其他服务商元数据。 */
    const clean = (value: unknown): CleanedNode => {
        if (typeof value === 'string') {
            if (!value.includes(prefix)) return { value, anchors: [] };
            const found: SystemAnchor[] = [];
            let text = value;
            for (const anchor of anchors) {
                const parts = text.split(anchor.marker);
                for (let index = 1; index < parts.length; index++) found.push(anchor);
                text = parts.join('');
            }
            return { value: text, anchors: found };
        }
        if (Array.isArray(value)) {
            const children = value.map(clean);
            return {
                value: children.filter(child => !child.remove).map(child => child.value),
                anchors: children.flatMap(child => child.anchors),
            };
        }
        if (!value || typeof value !== 'object') return { value, anchors: [] };
        const entries = Object.entries(value).map(([key, item]) => [key, clean(item)] as const);
        const found = entries.flatMap(([, child]) => child.anchors);
        if (!found.length) return { value, anchors: [] };
        const result = Object.fromEntries(entries.map(([key, child]) => [key, child.value]));
        const emptyAnchorBlock =
            result.text === '' &&
            (api === 'google-generative-ai' ||
                (typeof result.type === 'string' &&
                    ['text', 'input_text', 'output_text'].includes(result.type)));
        // Responses 会把仅含工具调用的 assistant 上新增的锚点文本拆成单独消息，恢复后移除它。
        const emptyAnchorMessage =
            result.type === 'message' &&
            Array.isArray(result.content) &&
            result.content.length === 0;
        // Mistral 的纯工具助手消息省略 content，不能把临时定位块变成空内容数组。
        if (
            api === 'mistral-conversations' &&
            result.role === 'assistant' &&
            Array.isArray(result.content) &&
            !result.content.length
        ) {
            delete result.content;
        }
        return { value: result, anchors: found, remove: emptyAnchorBlock || emptyAnchorMessage };
    };

    return {
        context: { ...context, messages },
        get failure() {
            return failure;
        },
        restore(payload) {
            try {
                if (!payload || typeof payload !== 'object') throw mismatch();
                if (restoredPayloads.has(payload)) return payload;
                const original = payload as Record<string, unknown>;
                const items = original[field];
                if (!Array.isArray(items)) throw mismatch();
                const seen = new Set<SystemAnchor>();
                const restored: unknown[] = [];
                for (const item of splitToolResultGroups(items)) {
                    const result = clean(item);
                    if (result.anchors.length > 1) throw mismatch();
                    const anchor = result.anchors[0];
                    if (anchor) {
                        if (seen.has(anchor) || anchors[seen.size] !== anchor) throw mismatch();
                        seen.add(anchor);
                        restored.push(...nativeMessages(anchor.messages));
                    }
                    if (!result.remove) restored.push(result.value);
                }
                if (seen.size !== anchors.length) throw mismatch();
                restored.push(...nativeMessages(tail));
                const result = { ...original, [field]: mergeFallbackUsers(restored) };
                if (containsMarker(result, prefix)) throw mismatch();
                restoredPayloads.add(result);
                applied = true;
                return result;
            } catch (error) {
                failure = error instanceof PiContextAdapterError ? error : mismatch();
                throw failure;
            }
        },
        assertRestored() {
            if (failure) throw failure;
            if (!applied) throw mismatch();
        },
    };
}
