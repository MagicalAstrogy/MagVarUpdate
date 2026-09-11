/** Shared boundary scanner for update replies and persisted floor text.
 * Offsets always refer to the original UTF-16 string; payload text is never rewritten.
 */
export interface UpdateMarkupBlock {
    start: number;
    end: number;
    contentStart: number;
    contentEnd: number;
    closed: boolean;
}

export function scanUpdateMarkup(input: string) {
    const structural = input.split('');
    const visible = input.split('');
    const tokens: { name: string; closing: boolean; start: number; end: number }[] = [];
    const ignored: string[] = [];
    let mode: 'json' | 'yaml' | undefined;
    let pendingData = true;
    let quote = '';
    let escaped = false;
    let blockComment = false;
    let scalarIndent: number | undefined;
    let lineStart = 0;
    const mask = (start: number, end: number, hide = false) => {
        for (let i = start; i < end; i++) {
            if (input[i] !== '\n' && input[i] !== '\r') {
                structural[i] = ' ';
                if (hide) visible[i] = ' ';
            }
        }
    };
    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if (i === lineStart && pendingData && !ignored.length) {
            const first = input.slice(i).trimStart();
            if (first.startsWith('[') || first.startsWith('{') || /^(?:\/\/|\/\*|_\.)/.test(first))
                mode = 'json';
            else if (/^(?:-(?:\s|$)|#|[\w]+\s*:)/.test(first)) mode = 'yaml';
        }
        if (i === lineStart && mode === 'yaml' && !quote && !ignored.length) {
            const lineEnd = input.indexOf('\n', i) < 0 ? input.length : input.indexOf('\n', i);
            const line = input.slice(i, lineEnd).replace(/\r$/, '');
            const indent = line.match(/^\s*/)?.[0].length ?? 0;
            if (scalarIndent !== undefined) {
                if (!line.trim() || indent > scalarIndent) {
                    mask(i, lineEnd);
                    i = lineEnd;
                    lineStart = lineEnd + 1;
                    continue;
                }
                scalarIndent = undefined;
            }
            if (/^\s*(?:-\s+)?[^#\r\n]*:\s*[|>](?:[+-]?[1-9]?|[1-9][+-]?)\s*(?:#.*)?$/.test(line)) {
                scalarIndent = indent + (line.trimStart().startsWith('- ') ? 2 : 0);
                pendingData = false;
                mask(i, lineEnd);
                i = lineEnd;
                lineStart = lineEnd + 1;
                continue;
            }
        }
        if (char === '\n') lineStart = i + 1;
        if (ignored.length) {
            const tag = input
                .slice(i)
                .match(/^<(\/?)\s*(think|thinking|reasoning|analysis|analyze)\b[^>]*>/i);
            if (tag) {
                if (tag[1] && tag[2].toLowerCase() === ignored.at(-1)) ignored.pop();
                else if (!tag[1]) ignored.push(tag[2].toLowerCase());
                mask(i, i + tag[0].length, true);
                i += tag[0].length - 1;
                if (!ignored.length) pendingData = true;
            } else mask(i, i + 1, true);
            continue;
        }
        if (quote) {
            mask(i, i + 1);
            if (escaped) escaped = false;
            else if (char === '\\' && (mode !== 'yaml' || quote === '"')) escaped = true;
            else if (char === quote) {
                if (mode === 'yaml' && quote === "'" && input[i + 1] === "'") {
                    mask(i + 1, i + 2);
                    i++;
                } else quote = '';
            }
            continue;
        }
        if (blockComment) {
            mask(i, i + 1);
            if (char === '*' && input[i + 1] === '/') {
                mask(i + 1, i + 2);
                i++;
                blockComment = false;
            }
            continue;
        }
        if (char === '<') {
            const tag = input
                .slice(i)
                .match(
                    /^<(\/?)\s*(updatevariable|variableupdate|update|json_?patch|think|thinking|reasoning|analysis|analyze)\b[^>]*>/i
                );
            if (tag) {
                const name = tag[2].toLowerCase();
                if (/^(think|thinking|reasoning|analysis|analyze)$/.test(name)) {
                    if (!tag[1]) ignored.push(name);
                    mask(i, i + tag[0].length, true);
                } else {
                    tokens.push({
                        name: /^json/.test(name) ? 'patch' : 'update',
                        closing: !!tag[1],
                        start: i,
                        end: i + tag[0].length,
                    });
                    mode = undefined;
                    scalarIndent = undefined;
                    pendingData = !tag[1];
                }
                i += tag[0].length - 1;
                continue;
            }
        }
        if (pendingData && !/\s/.test(char)) {
            if (input.startsWith('```', i)) {
                const end = input.indexOf('\n', i);
                if (end >= 0) {
                    i = end;
                    lineStart = end + 1;
                    continue;
                }
            }
            mode =
                char === '[' || char === '{' || input.startsWith('_.', i)
                    ? 'json'
                    : /^-(?:\s|$)/.test(input.slice(i, i + 2)) || /^[\w]+\s*:/.test(input.slice(i))
                      ? 'yaml'
                      : mode;
            pendingData = false;
        }
        if (mode && (char === '"' || char === "'")) {
            quote = char;
            mask(i, i + 1);
        } else if (mode === 'json' && input.startsWith('/*', i)) {
            blockComment = true;
            mask(i, i + 2);
            i++;
        } else if (
            (mode === 'json' && input.startsWith('//', i)) ||
            (mode === 'yaml' && char === '#' && (i === lineStart || /\s/.test(input[i - 1])))
        ) {
            const end = input.indexOf('\n', i) < 0 ? input.length : input.indexOf('\n', i);
            mask(i, end);
            i = end - 1;
        } else if (mode === 'yaml' && char === ':' && /\s/.test(input[i + 1] ?? '')) {
            const rest = input.slice(i + 1).match(/^[ \t]+([^\s"'[{|>#\r\n][^\r\n]*)/);
            if (rest) {
                // YAML plain scalars may legitimately contain XML-like text.
                mask(i + 1, i + 1 + rest[0].length);
                i += rest[0].length;
            }
        }
    }
    return { structural: structural.join(''), visible: visible.join(''), tokens };
}

export function findUpdateMarkupBlocks(
    input: string,
    kind: 'patch' | 'update'
): UpdateMarkupBlock[] {
    const stack: { start: number; contentStart: number }[] = [];
    const blocks: UpdateMarkupBlock[] = [];
    for (const token of scanUpdateMarkup(input).tokens) {
        if (token.name !== kind) continue;
        if (!token.closing) stack.push({ start: token.start, contentStart: token.end });
        else {
            const opening = stack.pop();
            if (opening)
                blocks.push({ ...opening, contentEnd: token.start, end: token.end, closed: true });
        }
    }
    for (const opening of stack)
        blocks.push({ ...opening, contentEnd: input.length, end: input.length, closed: false });
    return blocks.sort((a, b) => a.start - b.start);
}

export function cleanStructuredUpdate(input: string): string {
    return input
        .trim()
        .replace(/^```(?:json5?|ya?ml)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
}

/** Check before JSON.stringify: YAML aliases can be cyclic, and JSON5 admits non-finite values. */
export function isJsonSafe(value: unknown, ancestors = new Set<object>()): boolean {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (!Array.isArray(value) && !_.isPlainObject(value)) return false;
    if (ancestors.has(value as object)) return false;
    ancestors.add(value as object);
    const safe = Object.values(value as object).every(child => isJsonSafe(child, ancestors));
    ancestors.delete(value as object);
    return safe;
}
