import { tr } from '@/i18n';

export type RegexCompileResult = {
    regex?: RegExp;
    error?: string;
};

function isEscaped(value: string, index: number): boolean {
    let backslash_count = 0;
    for (let i = index - 1; i >= 0 && value[i] === '\\'; i--) {
        backslash_count++;
    }
    return backslash_count % 2 === 1;
}

function findClosingSlash(value: string): number {
    for (let i = value.length - 1; i > 0; i--) {
        if (value[i] === '/' && !isEscaped(value, i)) {
            return i;
        }
    }
    return -1;
}

export function compileRegex(value: string): RegexCompileResult {
    const trimmed = value.trim();
    if (trimmed === '') {
        return {};
    }

    try {
        if (trimmed.startsWith('/')) {
            const closing_slash = findClosingSlash(trimmed);
            if (closing_slash <= 0) {
                throw new Error(tr('runtime.regex.jsStyleSyntax'));
            }
            return {
                regex: new RegExp(
                    trimmed.slice(1, closing_slash),
                    trimmed.slice(closing_slash + 1)
                ),
            };
        }

        return { regex: new RegExp(trimmed) };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}
