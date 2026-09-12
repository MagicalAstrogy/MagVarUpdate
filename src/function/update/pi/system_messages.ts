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

/** 只接受提供消息内 system 的协议；Anthropic 同时遵循 user → system → assistant 的位置规则。 */
function assertNativeSystemPlacement(
    { context, lateSystemMessages }: PiContextAdapterResult,
    api: Api
): void {
    if (!lateSystemMessages.length) return;
    if (
        ![
            'openai-completions',
            'openai-responses',
            'openai-codex-responses',
            'anthropic-messages',
            'mistral-conversations',
        ].includes(api)
    ) {
        throw new PiContextAdapterError(
            `More source API '${api}' cannot preserve intermediate system messages.`,
            'system-role-unsupported',
            lateSystemMessages[0].sourceIndex
        );
    }
    if (api !== 'anthropic-messages') return;
    for (const message of lateSystemMessages) {
        const previous = context.messages[message.beforeMessageIndex - 1];
        const next = context.messages[message.beforeMessageIndex];
        // 本转换层中的 toolResult 在 Anthropic 协议里是携带工具结果的 user 回合。
        if (
            (previous?.role !== 'user' && previous?.role !== 'toolResult') ||
            (next && next.role !== 'assistant')
        ) {
            throw new PiContextAdapterError(
                `Message ${message.sourceIndex}: Anthropic intermediate system messages must follow a user turn and precede an assistant turn or end the request.`,
                'system-placement',
                message.sourceIndex
            );
        }
    }
}

/**
 * 保留普通消息角色，在服务商完成拆分/合并之后按内容锚点恢复 system。
 * 锚点只进入待转换的文本，发送前必须恰好移除一次；不修改捕获输入、共享上下文或全局 fetch。
 */
export function createPiSystemMessageBridge(
    adapted: PiContextAdapterResult,
    api: Api
): PiSystemMessageBridge {
    assertNativeSystemPlacement(adapted, api);
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
        api === 'openai-responses' || api === 'openai-codex-responses' ? 'input' : 'messages';
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
        group.map(message => ({
            role: 'system',
            content: message.text,
        }));

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
            typeof result.type === 'string' &&
            ['text', 'input_text', 'output_text'].includes(result.type) &&
            result.text === '';
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
                for (const item of items) {
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
                const result = { ...original, [field]: restored };
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
