import type { Api } from '@earendil-works/pi-ai';

export type MvuToolChoice =
    | 'auto'
    | 'none'
    | 'required'
    | 'any'
    | { type: 'function'; function: { name: string } };

export function resolvePiToolChoice(api: Api, choice: MvuToolChoice | undefined): unknown {
    const normalized = choice ?? 'auto';
    if (normalized === 'auto' || normalized === 'none') {
        return normalized;
    }

    const named = typeof normalized === 'object' ? normalized.function.name.trim() : undefined;
    if (named !== undefined && !named) {
        throw new Error('Pi named tool choice requires a tool name');
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
            throw new Error("Pi API 'openai-codex-responses' does not support a named tool choice");
        }
        return 'required';
    }
    if (api === 'anthropic-messages') {
        return named ? { type: 'tool', name: named } : 'any';
    }
    if (api === 'google-generative-ai') {
        if (named) {
            throw new Error("Pi API 'google-generative-ai' does not support a named tool choice");
        }
        return 'any';
    }
    throw new Error(`Pi API '${api}' does not support required tool choice`);
}
