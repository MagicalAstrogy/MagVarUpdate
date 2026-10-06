import { parseString } from '@util/common';
import { parse as parseJson5 } from 'json5';

/** 标记因追加校正而补齐的旧残缺补丁，避免宽松解析器将原本忽略的内容修复成命令。 */
const INCOMPLETE_PATCH_MARKER = '<!-- mvu:discard-incomplete-json-patch -->';

/** 更新块在原文中的 UTF-16 区间，所有结束偏移均不包含对应位置的字符。 */
export interface UpdateMarkupBlock {
    start: number;
    end: number;
    contentStart: number;
    contentEnd: number;
    closed: boolean;
    /** 已补齐标签但仍应忽略的旧残缺补丁；其内部原有的闭合补丁单独提取。 */
    discarded?: boolean;
}

/**
 * 扫描更新标签，同时屏蔽思考区和结构化数据中的标签字面量。
 * 所有偏移均对应原始 UTF-16 字符串；扫描只生成视图，不改写原始负载。
 * @param input 模型回复或已持久化的楼层正文。
 * @returns structural/visible 为等长扫描视图，tokens 记录真实标签，tail 保留末尾未闭合状态。
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
    let markupDepth = 0;
    const hasExplicitUpdate = /<(?:updatevariable|variableupdate|update)\b[^>]*>/i.test(input);
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
                    markupDepth = Math.max(0, markupDepth + (tag[1] ? -1 : 1));
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
        // 有显式更新块时，块外单词中的撇号不是字符串起点，不能吞掉后面的块。
        // 块内的数据字符串及没有更新包装的输入仍沿用原有规则。
        const proseApostrophe =
            hasExplicitUpdate &&
            markupDepth === 0 &&
            char === "'" &&
            /[\p{L}\p{N}]/u.test(input[i - 1] ?? '');
        if (mode && (char === '"' || char === "'") && !proseApostrophe) {
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
    return {
        structural: structural.join(''),
        visible: visible.join(''),
        tokens,
        tail: { quote, blockComment, reasoning: ignored },
    };
}

/**
 * 按标签类型配对更新块，忽略字符串、注释和思考区中的伪标签。
 * @param input 待扫描的原始文本。
 * @param kind patch 表示 JSONPatch，update 表示兼容的变量更新标签。
 * @returns 按起始位置排序的区间；未闭合块标记 closed=false，补齐但保持忽略的旧补丁标记 discarded。
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
            if (opening) {
                blocks.push({
                    ...opening,
                    contentEnd: token.start,
                    end: token.end,
                    closed: true,
                    ...(kind === 'patch' && input.startsWith(INCOMPLETE_PATCH_MARKER, token.end)
                        ? { discarded: true }
                        : {}),
                });
            }
        }
    }
    // 保留未闭合块供调用方决定兼容或拒绝，避免扫描阶段默默丢失截断回复。
    for (const opening of stack)
        blocks.push({ ...opening, contentEnd: input.length, end: input.length, closed: false });
    return blocks.sort((a, b) => a.start - b.start);
}

/**
 * 为正文末尾生成边界闭合文本，让随后追加的补丁从独立的扫描上下文开始。
 * 仅追加字符；按现有扫描器的状态闭合字符串、块注释、思考区、更新标签和代码围栏。
 * @param input 原始正文，不会被裁剪或改写。
 * @returns 含起始换行的闭合文本；没有未闭合结构时只返回换行。
 */
export function closeUpdateMarkup(input: string): string {
    // 先加换行结束 // 和 YAML # 行注释，也消费字符串末尾的反斜杠转义。
    const scanned = scanUpdateMarkup(`${input}\n`);
    let suffix = '\n';
    if (scanned.tail.quote) suffix += scanned.tail.quote + '\n';
    if (scanned.tail.blockComment) suffix += '*/\n';
    for (const name of [...scanned.tail.reasoning].reverse()) suffix += `</${name}>\n`;

    const openings: typeof scanned.tokens = [];
    for (const token of scanned.tokens) {
        if (!token.closing) openings.push(token);
        else {
            // 与 findUpdateMarkupBlocks 一致，按兼容标签类别配对，不把数据中的标签当作结构。
            const index = openings.findLastIndex(opening => opening.name === token.name);
            if (index >= 0) openings.splice(index, 1);
        }
    }
    const endings = openings.map(opening => {
        const tag = input.slice(opening.start, opening.end).match(/^<\s*([^\s/>]+)/)![1];
        // 只补标签会让 parseString 将旧残缺内容修复成命令；显式标记继续忽略该旧块。
        const marker = opening.name === 'patch' ? INCOMPLETE_PATCH_MARKER : '';
        return { start: opening.start, text: `</${tag}>${marker}\n` };
    });

    // 围栏只在未被屏蔽的行上识别，避免补丁字符串、YAML 块标量或思考区里的 ``` 干扰。
    // 把真实标签视为行边界，兼容 <JSONPatch>```json 和 ```</JSONPatch>，同时保留原文偏移。
    const fence_view = scanned.structural.split('');
    for (const token of scanned.tokens) fence_view.fill('\n', token.start, token.end);
    let fence: { start: number; delimiter: string } | undefined;
    for (const match of fence_view.join('').matchAll(/^[ \t]{0,3}(`{3,}|~{3,})([^\r\n]*)$/gm)) {
        if (!fence) fence = { start: match.index, delimiter: match[1] };
        else if (
            match[1][0] === fence.delimiter[0] &&
            match[1].length >= fence.delimiter.length &&
            !match[2].trim()
        )
            fence = undefined;
    }
    if (fence) endings.push({ start: fence.start, text: `${fence.delimiter}\n` });
    // 补丁内的围栏先于补丁闭合，包住整个更新块的外层围栏则最后闭合。
    for (const ending of endings.sort((a, b) => b.start - a.start)) suffix += ending.text;
    return suffix;
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
