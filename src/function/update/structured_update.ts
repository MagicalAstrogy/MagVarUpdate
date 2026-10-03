import { parseString } from '@util/common';
import { parse as parseJson5 } from 'json5';

/** 更新块在原文中的 UTF-16 区间，所有结束偏移均不包含对应位置的字符。 */
export interface UpdateMarkupBlock {
    start: number;
    end: number;
    contentStart: number;
    contentEnd: number;
    closed: boolean;
}

/**
 * 扫描更新标签，同时屏蔽思考区和结构化数据中的标签字面量。
 * 所有偏移均对应原始 UTF-16 字符串；扫描只生成视图，不改写原始负载。
 * @param input 模型回复或已持久化的楼层正文。
 * @returns structural 屏蔽字符串和注释等数据，visible 仅隐藏思考区，tokens 记录真实标签。
 */
export function scanUpdateMarkup(input: string) {
    // 通过等长空格屏蔽数据而不删除字符，让两个扫描视图与原文共用切片偏移。
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
    /** 屏蔽半开区间并保留换行；hide 同时从可见负载中隐藏思考区内容。 */
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
            // YAML 块标量内的标签属于文本，直到缩进退回标量声明所在层级才恢复标签识别。
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
        // 用栈跟踪嵌套思考标签；其中的补丁示例不能成为实际更新块。
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
        // 字符串中的闭合标签不能截断补丁，同时兼容 JSON 转义和 YAML 单引号双写。
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
                // YAML 普通标量允许包含类 XML 文本，冒号后的值不能误识别为结构标签。
                mask(i + 1, i + 1 + rest[0].length);
                i += rest[0].length;
            }
        }
    }
    return { structural: structural.join(''), visible: visible.join(''), tokens };
}

/**
 * 按标签类型配对更新块，忽略字符串、注释和思考区中的伪标签。
 * @param input 待扫描的原始文本。
 * @param kind patch 表示 JSONPatch，update 表示兼容的变量更新标签。
 * @returns 按起始位置排序的区间；未闭合块延伸至文末并标记 closed 为 false。
 */
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
    // 保留未闭合块供调用方决定兼容或拒绝，避免扫描阶段默默丢失截断回复。
    for (const opening of stack)
        blocks.push({ ...opening, contentEnd: input.length, end: input.length, closed: false });
    return blocks.sort((a, b) => a.start - b.start);
}

/**
 * 移除结构化内容最外层的 Markdown 代码围栏及首尾空白。
 * @param input 可能带 JSON、JSON5 或 YAML 围栏的文本。
 * @returns 待解析的原始负载，内部围栏和数据内容保持不变。
 */
export function cleanStructuredUpdate(input: string): string {
    return input
        .trim()
        .replace(/^```(?:json5?|ya?ml)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
}

/**
 * 优先解析 JSON/JSON5（含前置注释），失败后沿用 YAML 和残缺 JSON 的兼容解析。
 * 本方法不保证结果是补丁或可安全序列化，调用方需另外检查。
 * @param input 可能带代码围栏的结构化文本。
 * @returns 解析后的值。
 * @throws 兼容解析器也无法处理输入时向上传播其异常。
 */
export function parseStructuredUpdate(input: string): unknown {
    const content = cleanStructuredUpdate(input);
    try {
        // YAML 可能把以 // 或 /* 开头的合法 JSON5 当成普通字符串，不能优先接受该结果。
        return parseJson5(content);
    } catch {
        return parseString(content);
    }
}

/**
 * 检查结构化解析结果是否可安全序列化为 JSON，拒绝循环引用、非有限数值及非 JSON 类型。
 * @param value 待检查的解析结果。
 * @param ancestors 当前递归路径上的祖先对象，用于检测循环，调用方通常无需传入。
 * @returns 值及其所有可枚举子值都安全时返回 true。
 */
export function isJsonSafe(value: unknown, ancestors = new Set<object>()): boolean {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (!Array.isArray(value) && !_.isPlainObject(value)) return false;
    if (ancestors.has(value as object)) return false;
    ancestors.add(value as object);
    const safe = Object.values(value as object).every(child => isJsonSafe(child, ancestors));
    // 仅禁止当前祖先链上的循环；同一个对象被不同分支共享仍然可以序列化。
    ancestors.delete(value as object);
    return safe;
}
