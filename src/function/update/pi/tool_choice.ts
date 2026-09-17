import type { Api } from '@earendil-works/pi-ai';

/** MVU 接受的工具选择规则；required/any 均表示必须调用工具，发送前按协议转换。 */
export type MvuToolChoice =
    | 'auto'
    | 'none'
    | 'required'
    | 'any'
    | { type: 'function'; function: { name: string } };

/**
 * 把 MVU 工具选择转换为当前协议接受的形式。
 * 保留 auto/none，转换 required/any 与具名调用；不支持具名选择的协议提前拒绝。
 */
export function resolvePiToolChoice(api: Api, choice: MvuToolChoice | undefined): unknown {
    const normalized = choice ?? 'auto';
    if (normalized === 'auto' || normalized === 'none') {
        return normalized;
    }

    const named = typeof normalized === 'object' ? normalized.function.name.trim() : undefined;
    if (named !== undefined && !named) {
        throw new Error('More source named tool choice requires a tool name');
    }

    if (api === 'openai-completions') {
        return named
            ? { type: 'function', function: { name: named } }
            : normalized === 'any'
              ? 'required'
              : normalized;
    }
    if (api === 'openai-responses') {
        return named ? { type: 'function', name: named } : 'required';
    }
    if (api === 'openai-codex-responses') {
        if (named) {
            throw new Error(
                "More source API 'openai-codex-responses' does not support a named tool choice"
            );
        }
        return 'required';
    }
    if (api === 'anthropic-messages') {
        return named ? { type: 'tool', name: named } : 'any';
    }
    if (api === 'google-generative-ai') {
        if (named) {
            throw new Error(
                "More source API 'google-generative-ai' does not support a named tool choice"
            );
        }
        return 'any';
    }
    if (api === 'mistral-conversations') {
        return named ? { type: 'function', function: { name: named } } : normalized;
    }
    throw new Error(`More source API '${api}' does not support required tool choice`);
}
