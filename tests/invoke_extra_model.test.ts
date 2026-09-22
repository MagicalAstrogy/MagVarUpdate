/**
 * 测试场景：验证额外模型的工具调用和格式化输出能提取为统一变量更新块，并正确拒绝无效结果。
 */
import {
    extractFromFormattedOutput,
    extractFromGenerateToolCallResult,
    extractFromToolCall,
    MVU_FUNCTION_NAME,
    MVU_JSON_PATCH_RESPONSE_SCHEMA,
} from '@/function/function_call';
import { parseAndValidateExtraModelResult } from '@/function/update/invoke_extra_model';
import YAML from 'yaml';

/**
 * # 额外模型回复解析用例矩阵
 *
 * 对应 `parseAndValidateExtraModelResult()`，用例位于
 * `tests/invoke_extra_model.test.ts`。此函数接收模型回复文本，输出统一的 `<UpdateVariable>` 文本、返回
 * `null`，或抛出校验错误。它检查格式和 JSON 安全性，不执行变量操作，也不代替增量校正的业务校验。
 *
 * ## 包装与内容矩阵
 *
 * `U` 表示 `<UpdateVariable>…</UpdateVariable>`；`P` 表示
 * `<JSONPatch>…</JSONPatch>`。数组指 MVU 操作数组；对象指包含补丁字段的对象，不是任意变量快照。
 *
 * | 内容                                   | 裸回复                   | U 内直接放内容       | P 内放内容               | U → P → 内容 |
 * | -------------------------------------- | ------------------------ | -------------------- | ------------------------ | ------------ |
 * | JSON 操作数组                          | 接受并转成标准 JSON 补丁 | 同左                 | 接受，保留补丁原文       | 同左         |
 * | JSON5 操作数组                         | 接受并转成标准 JSON 补丁 | 同左                 | 接受，保留补丁原文       | 同左         |
 * | YAML 操作数组                          | 接受并转成标准 JSON 补丁 | 同左                 | 接受，保留补丁原文       | 同左         |
 * | JSON 补丁对象                          | 接受并提取补丁及分析字段 | 同左                 | 抛错，P 内必须是操作数组 | 同左         |
 * | JSON5 补丁对象                         | 接受并提取补丁及分析字段 | 同左                 | 抛错，P 内必须是操作数组 | 同左         |
 * | YAML 补丁对象                          | 接受并提取补丁及分析字段 | 同左                 | 抛错，P 内必须是操作数组 | 同左         |
 * | 旧脚本 `_.set(...)` 等                 | 接受并补 U 包装          | 接受，去掉思考区内容 | 抛错                     | 抛错         |
 * | 普通说明或无补丁字段的对象             | 返回 null                | 返回 null            | 抛错                     | 抛错         |
 * | 非有限数值、循环引用或无效操作数组结构 | 返回 null                | 返回 null            | 抛错                     | 抛错         |
 *
 * 核心结构化矩阵按以下维度交叉执行，共 144 项：
 *
 * - 四种包装：裸回复、U、P、U → P。
 * - 三种语法：JSON、JSON5、YAML。
 * - 两种数据形态：操作数组、补丁对象。
 * - 三种围栏：无围栏、匿名代码围栏、对应语言代码围栏。
 * - 两种模式：普通模式、`require_single_update: true`。
 *
 * 断言同时检查接受或拒绝的结果，以及完整返回文本。已有 P 标签时保留原文；没有 P 标签时（包括 U 内直接放 YAML/JSON5）转换为标准 JSON 补丁。
 *
 * ## 语法及字段边界
 *
 * | 维度         | 用例                                                           | 预期                                 |
 * | ------------ | -------------------------------------------------------------- | ------------------------------------ |
 * | JSON5 特性   | 单引号、无引号键、尾逗号、前置行注释和块注释                   | 接受；注释不能被 YAML 优先解析成文本 |
 * | YAML 字符串  | 单引号及双单引号转义、双引号、普通标量、`\|-` 和 `>-` 多行标量 | 保留实际字符串值                     |
 * | 数据中的标签 | 字符串中出现 U、P、Think 标签                                  | 不识别为更新或思考区边界             |
 * | 注释中的标签 | JSON5/YAML 注释中出现伪更新标签                                | 不参与更新块计数                     |
 * | YAML 引用    | 非循环别名、循环别名                                           | 前者接受，后者拒绝                   |
 * | 数值安全     | JSON5 的 NaN/Infinity、YAML 的 .nan/.inf                       | 拒绝                                 |
 * | 对象补丁字段 | json_patch、jsonPatch、patch、delta                            | 提取操作数组；也支持字符串化的补丁   |
 * | 分析字段     | analysis、analyze                                              | 放入规范输出的 Analyze 块            |
 * | 换行和围栏   | LF、CRLF、匿名围栏、json/json5/yaml/yml 围栏                   | 接受                                 |
 * | 空补丁       | `[]`                                                           | 接受，表示无操作                     |
 *
 * YAML 内容和 XML 闭合标签采用独立行。若把 `</JSONPatch>`
 * 接在 YAML 普通标量的同一行，扫描器可能将其视为标量内容，不属于本矩阵承诺的包装形式。
 *
 * ## 选择、回退与单块模式
 *
 * | 情形                             | 普通模式                       | 单块模式                             |
 * | -------------------------------- | ------------------------------ | ------------------------------------ |
 * | 一个更新块，直接含数组或补丁对象 | 接受 JSON/JSON5/YAML           | 同左                                 |
 * | 多个更新块                       | 优先最后一个闭合块             | 抛错，含直接结构化内容的更新块也一样 |
 * | 没有闭合 U，但有完整 P           | 可兼容最后一个未闭合 U         | 若只有一个 U/P，可以通过基础校验     |
 * | 存在未闭合 P                     | 抛错                           | 抛错                                 |
 * | 一个 U 内含多个 P                | 接受并保留                     | 抛错                                 |
 * | 空或无效 U 后面跟完整 P          | 从全文回退提取 P               | 仍受单块数量限制                     |
 * | P 外围有剧情或说明               | 兜底时只返回 P                 | 同左                                 |
 * | 真正的 U 内混合 P、分析和旧指令  | 保留块内内容                   | 操作是否允许仍由后续业务校验决定     |
 * | 思考区中的示例                   | 忽略，不参与更新计数或指令识别 | 同左                                 |
 * | 仅字符串或注释中出现旧指令       | 不因此判为成功                 | 同左                                 |
 *
 * 兼容边界：`parseString` 仍可能修复残缺 JSON，例如把 `[` 解析为
 * `[]`。存在 P 标签时保留的是原始补丁文本，基础校验通过不代表已重新序列化该文本。 `isJsonPatch`
 * 只检查数组、操作对象、op/path 等基本字段类型；未知操作、缺少 value、路径存在性、幂等性和业务规则不由此函数完整验证。
 *
 * 本次矩阵发现并修复：JSON5 前置注释被优先按 YAML 解析；无 P 标签的更新块绕过单块数量检查。
 */
describe('parseAndValidateExtraModelResult', () => {
    // parseString 在宿主中使用全局 YAML；此处注入真实解析器，并在本组用例结束后恢复。
    const originalYaml = Object.getOwnPropertyDescriptor(globalThis, 'YAML');
    beforeAll(() => {
        Object.defineProperty(globalThis, 'YAML', { configurable: true, value: YAML });
    });
    afterAll(() => {
        if (originalYaml) Object.defineProperty(globalThis, 'YAML', originalYaml);
        else Reflect.deleteProperty(globalThis, 'YAML');
    });

    const patch = '[{"op":"replace","path":"/hp","value":72}]';
    const patchBlock = `<JSONPatch>${patch}</JSONPatch>`;
    const updateBlock = `<UpdateVariable>${patchBlock}</UpdateVariable>`;

    // 输入矩阵见本组测试上方的块注释。
    // 四种包装 × 三种语法 × 数组/对象 × 无围栏/匿名围栏/语言围栏 × 普通/单块模式。
    const wrappers = [
        { name: 'bare', tagged: false, wrap: (text: string) => text },
        {
            name: 'update',
            tagged: false,
            wrap: (text: string) => `<UpdateVariable>\n${text}\n</UpdateVariable>`,
        },
        {
            name: 'patch',
            tagged: true,
            wrap: (text: string) => `<JSONPatch>\n${text}\n</JSONPatch>`,
        },
        {
            name: 'update+patch',
            tagged: true,
            wrap: (text: string) =>
                `<UpdateVariable>\n<JSONPatch>\n${text}\n</JSONPatch>\n</UpdateVariable>`,
        },
    ];
    const formats = [
        {
            name: 'json',
            array: patch,
            object: `{"analysis":"checked","json_patch":${patch}}`,
        },
        {
            name: 'json5',
            array: "// JSON5 comment\n[{op: 'replace', path: '/hp', value: 72,},]",
            object: "/* JSON5 comment */\n{analysis: 'checked', json_patch: [{op: 'replace', path: '/hp', value: 72,},],}",
        },
        {
            name: 'yaml',
            array: '# YAML comment\n- op: replace\n  path: /hp\n  value: 72',
            object: 'analysis: checked\njson_patch:\n  - op: replace\n    path: /hp\n    value: 72',
        },
    ];
    const structuredCases = formats.flatMap(format =>
        (['array', 'object'] as const).flatMap(shape =>
            ['none', 'anonymous', 'language'].flatMap(fence =>
                [false, true].map(require_single_update => ({
                    name: `${format.name}/${shape}/${fence}/${require_single_update ? 'single' : 'ordinary'}`,
                    shape,
                    require_single_update,
                    text:
                        fence === 'none'
                            ? format[shape]
                            : `\`\`\`${fence === 'language' ? format.name : ''}\n${format[shape]}\n\`\`\``,
                }))
            )
        )
    );
    const normalizedUpdate = (analysis: string, operations: unknown[]) =>
        [
            '<UpdateVariable>',
            '<Analyze>',
            analysis,
            '</Analyze>',
            '<JSONPatch>',
            JSON.stringify(operations, null, 2),
            '</JSONPatch>',
            '</UpdateVariable>',
        ].join('\n');

    describe.each(wrappers)('structured matrix / $name', wrapper => {
        test.each(structuredCases)('$name', ({ shape, text, require_single_update }) => {
            const parse = () =>
                parseAndValidateExtraModelResult(wrapper.wrap(text), { require_single_update });
            if (wrapper.tagged && shape === 'object') {
                // 显式 JSONPatch 标签只接受操作数组，不能再套一层 json_patch 对象。
                expect(parse).toThrow('JSONPatch 内容不合法或包含非有限值');
            } else if (wrapper.tagged) {
                // 已有补丁标签：只统一外层包装，补丁及代码围栏原文不变。
                const expected =
                    wrapper.name === 'patch'
                        ? `<UpdateVariable>${wrapper.wrap(text)}</UpdateVariable>`
                        : wrapper.wrap(text);
                expect(parse()).toBe(expected);
            } else {
                // 无补丁标签（包括 UpdateVariable 内直接放 YAML/JSON5）：转为标准 JSON 补丁。
                expect(parse()).toBe(
                    normalizedUpdate(shape === 'object' ? 'checked' : '', [
                        { op: 'replace', path: '/hp', value: 72 },
                    ])
                );
            }
        });

        test.each([
            { name: 'JSON missing op', text: '[{"path":"/hp","value":72}]' },
            { name: 'JSON5 NaN', text: "[{op:'replace', path:'/hp', value:NaN}]" },
            { name: 'JSON5 Infinity', text: "[{op:'replace', path:'/hp', value:-Infinity}]" },
            { name: 'YAML missing path', text: '- op: replace\n  value: 72' },
            { name: 'YAML NaN', text: '- op: replace\n  path: /hp\n  value: .nan' },
            { name: 'YAML Infinity', text: '- op: replace\n  path: /hp\n  value: .inf' },
            { name: 'YAML cycle', text: '- &loop\n  op: replace\n  path: /hp\n  value: *loop' },
        ])('rejects $name', ({ text }) => {
            const parse = () => parseAndValidateExtraModelResult(wrapper.wrap(text));
            if (wrapper.tagged) expect(parse).toThrow('JSONPatch 内容不合法或包含非有限值');
            else expect(parse()).toBeNull();
        });

        test('legacy commands require a body without JSONPatch tags', () => {
            const command = "_.set('hp', 72);";
            const parse = () => parseAndValidateExtraModelResult(wrapper.wrap(command));
            if (wrapper.tagged) expect(parse).toThrow('JSONPatch 内容不合法或包含非有限值');
            else
                expect(parse()).toBe(
                    wrapper.name === 'bare'
                        ? `<UpdateVariable>${command}</UpdateVariable>`
                        : wrapper.wrap(command)
                );
        });
    });

    // 对象字段别名及字符串化补丁也必须经过真实解析，而非只验证输出里出现标签。
    test.each(['json_patch', 'jsonPatch', 'patch', 'delta'])(
        'accepts the %s field in wrapped JSON5 and YAML objects',
        field => {
            for (const text of [
                `{analyze: 'checked', ${field}: [{op: 'replace', path: '/hp', value: 72}]}`,
                `analyze: checked\n${field}:\n  - op: replace\n    path: /hp\n    value: 72`,
                JSON.stringify({ analyze: 'checked', [field]: patch }),
            ]) {
                expect(parseAndValidateExtraModelResult(wrappers[1].wrap(text))).toBe(
                    normalizedUpdate('checked', [{ op: 'replace', path: '/hp', value: 72 }])
                );
            }
        }
    );

    // 无 JSONPatch 标签时，多块规则仍应适用于更新块里的数组和对象。
    test.each(formats)('multiple direct $name updates', format => {
        const first = wrappers[1].wrap('[]');
        const last = wrappers[1].wrap(format.object);
        expect(parseAndValidateExtraModelResult(first + '\n' + last)).toBe(
            normalizedUpdate('checked', [{ op: 'replace', path: '/hp', value: 72 }])
        );
        expect(() =>
            parseAndValidateExtraModelResult(first + '\n' + last, { require_single_update: true })
        ).toThrow('增量校正返回了多个更新块');
    });

    const literal = '</JSONPatch><UpdateVariable><Think>literal</Think></UpdateVariable>';
    describe.each(wrappers)('data boundaries / $name', wrapper => {
        test.each([
            {
                name: 'JSON5 quotes, escaped apostrophe and comments',
                text:
                    `/* <UpdateVariable><JSONPatch>fake</JSONPatch></UpdateVariable> */\n` +
                    `[{op:'replace', path:'/template', value:'it\\'s ${literal}',},]`,
                value: `it's ${literal}`,
            },
            {
                name: 'YAML single quotes and escaped apostrophe',
                text: `- op: replace\n  path: /template\n  value: 'it''s ${literal}'`,
                value: `it's ${literal}`,
            },
            {
                name: 'YAML double quotes',
                text: `- op: replace\n  path: /template\n  value: "${literal}"`,
                value: literal,
            },
            {
                name: 'YAML plain scalar and comment',
                text:
                    `# <UpdateVariable><JSONPatch>fake</JSONPatch></UpdateVariable>\n` +
                    `- op: replace\n  path: /template\n  value: prefix ${literal}`,
                value: `prefix ${literal}`,
            },
            {
                name: 'YAML literal block scalar',
                text: `- op: replace\n  path: /template\n  value: |-\n    ${literal}\n    second line`,
                value: `${literal}\nsecond line`,
            },
            {
                name: 'YAML folded block scalar',
                text: `- op: replace\n  path: /template\n  value: >-\n    ${literal}\n    second line`,
                value: `${literal} second line`,
            },
        ])('preserves $name', ({ text, value }) => {
            const result = parseAndValidateExtraModelResult(wrapper.wrap(text), {
                require_single_update: true,
            });
            expect(result).toBe(
                wrapper.tagged
                    ? wrapper.name === 'patch'
                        ? `<UpdateVariable>${wrapper.wrap(text)}</UpdateVariable>`
                        : wrapper.wrap(text)
                    : normalizedUpdate('', [{ op: 'replace', path: '/template', value }])
            );
        });
    });

    test('accepts non-cyclic YAML aliases inside a fenced update block', () => {
        const response = wrappers[1].wrap(
            '```yml\n- &change\n  op: replace\n  path: /hp\n  value: 72\n- *change\n```'
        );
        expect(parseAndValidateExtraModelResult(response)).toBe(
            normalizedUpdate('', [
                { op: 'replace', path: '/hp', value: 72 },
                { op: 'replace', path: '/hp', value: 72 },
            ])
        );
    });

    test.each(formats)('accepts $name in a CRLF update block after reasoning examples', format => {
        const response = wrappers[1]
            .wrap(`<Analysis>_.set('wrong', 0);</Analysis>\n${format.array}`)
            .replace(/\n/g, '\r\n');
        expect(parseAndValidateExtraModelResult(response)).toBe(
            normalizedUpdate('', [{ op: 'replace', path: '/hp', value: 72 }])
        );
    });

    // 更新块边界：兼容别名、缺失包装和未闭合外层，但优先使用最后一个完整更新块。
    test.each(['UpdateVariable', 'VariableUpdate', 'update', 'UPDATEVARIABLE'])(
        'normalizes the %s wrapper and patch tag aliases',
        tag => {
            expect(
                parseAndValidateExtraModelResult(
                    `<${tag}><json_patch>${patch}</JSON_Patch></${tag}>`
                )
            ).toBe(updateBlock);
        }
    );

    test('prefers the last complete update over earlier and trailing incomplete blocks', () => {
        const response =
            '<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>' +
            updateBlock +
            '<UpdateVariable>unfinished';

        expect(parseAndValidateExtraModelResult(response)).toBe(updateBlock);
    });

    test('accepts an incomplete outer wrapper when its patch is complete', () => {
        expect(parseAndValidateExtraModelResult(`<UpdateVariable>${patchBlock}`)).toBe(updateBlock);
    });

    test.each([
        '',
        '<UpdateVariable></UpdateVariable>',
        '<UpdateVariable>invalid</UpdateVariable>',
    ])('extracts a fallback patch without importing surrounding prose: %s', prefix => {
        expect(
            parseAndValidateExtraModelResult(`${prefix}\n剧情正文\n${patchBlock}\n后续说明`)
        ).toBe(updateBlock);
    });

    test('ignores update examples in reasoning before and after the actual result', () => {
        const example = '<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>';
        expect(
            parseAndValidateExtraModelResult(
                `<Think>${example}</Think>${updateBlock}<Analysis>${example}</Analysis>`,
                { require_single_update: true }
            )
        ).toBe(updateBlock);
    });

    test('preserves literal tags in patch strings without treating them as block boundaries', () => {
        const value = '</JSONPatch><UpdateVariable><Think>literal</Think></UpdateVariable>';
        const payload = JSON.stringify([{ op: 'replace', path: '/template', value }]);
        const response = `<UpdateVariable><JSONPatch>${payload}</JSONPatch></UpdateVariable>`;

        expect(parseAndValidateExtraModelResult(response, { require_single_update: true })).toBe(
            response
        );
    });

    // 补丁校验：拒绝不完整标签、无效结构和不安全的值，单块模式额外拒绝歧义更新。
    test.each([
        '<JSONPatch>[]',
        '<UpdateVariable><JSONPatch>[]</UpdateVariable>',
        `${patchBlock}<JSONPatch>[]`,
    ])('rejects unclosed patch tags: %s', response => {
        expect(() => parseAndValidateExtraModelResult(response)).toThrow('JSONPatch 标签未闭合');
    });

    test.each([
        '{}',
        '[{"path":"/hp","value":72}]',
        '[{"op":"replace","path":42,"value":72}]',
        '[{"op":"replace","path":"/hp","value":NaN}]',
        '[{"op":"replace","path":"/hp","value":Infinity}]',
        '\n- &loop\n  op: replace\n  path: /hp\n  value: *loop\n',
    ])('rejects invalid or JSON-unsafe patch content: %s', payload => {
        expect(() => parseAndValidateExtraModelResult(`<JSONPatch>${payload}</JSONPatch>`)).toThrow(
            'JSONPatch 内容不合法或包含非有限值'
        );
    });

    test('retains parseString recovery of a truncated empty array', () => {
        expect(parseAndValidateExtraModelResult('<JSONPatch>[</JSONPatch>')).toBe(
            '<UpdateVariable><JSONPatch>[</JSONPatch></UpdateVariable>'
        );
    });

    test('accepts an empty patch as a no-op in single-update mode', () => {
        expect(
            parseAndValidateExtraModelResult('<JSONPatch>[]</JSONPatch>', {
                require_single_update: true,
            })
        ).toBe('<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>');
    });

    test.each([
        `<UpdateVariable>${patchBlock}${patchBlock}</UpdateVariable>`,
        `${updateBlock}${updateBlock}`,
        `<UpdateVariable>${patchBlock}${updateBlock}`,
    ])('rejects multiple patches or update wrappers in single-update mode: %s', response => {
        expect(() =>
            parseAndValidateExtraModelResult(response, { require_single_update: true })
        ).toThrow('增量校正返回了多个更新块');
    });

    test('keeps multiple patches and mixed legacy content inside an ordinary update block', () => {
        const response =
            `<UpdateVariable><Analysis>检查结果</Analysis>${patchBlock}` +
            "_.set('other', 1);<json_patch>[]</json_patch></UpdateVariable>";

        expect(parseAndValidateExtraModelResult(response)).toBe(
            response.replace('<json_patch>[]</json_patch>', '<JSONPatch>[]</JSONPatch>')
        );
    });

    test('joins fallback patches without retaining intervening prose', () => {
        expect(parseAndValidateExtraModelResult(`${patchBlock}\n剧情\n${patchBlock}`)).toBe(
            `<UpdateVariable>${patchBlock}\n${patchBlock}</UpdateVariable>`
        );
    });

    // 旧脚本兼容：真实指令可以通过，思考区、字符串和注释里的示例不能触发成功。
    test.each(['set', 'insert', 'assign', 'remove', 'unset', 'delete', 'add'])(
        'accepts a legacy _.%s command',
        method => {
            const command = `_.${method}('hp', 72);`;
            expect(parseAndValidateExtraModelResult(command)).toBe(
                `<UpdateVariable>${command}</UpdateVariable>`
            );
        }
    );

    test('removes reasoning examples while preserving actual legacy command arguments', () => {
        const command = "_.set('template', '<Think>literal</Think>');";
        const result = parseAndValidateExtraModelResult(
            `<UpdateVariable><Think>_.set('wrong', 1);</Think>\n${command}</UpdateVariable>`
        );

        expect(result).toContain(command);
        expect(result).not.toContain('wrong');
    });

    test.each([
        "<Think>_.set('hp', 72);</Think>",
        "<Analysis>_.set('hp', 72);</Analysis>",
        '<Think><JSONPatch>[]</JSONPatch></Think>',
        JSON.stringify({ example: "_.set('hp', 72);" }),
        "/* _.set('hp', 72); */",
        "// _.set('hp', 72);",
    ])('does not accept commands or patches that only appear in examples: %s', response => {
        expect(parseAndValidateExtraModelResult(response)).toBeNull();
    });

    test.each([
        '',
        '没有需要更新的内容',
        '<UpdateVariable>提到了 json_patch，但没有指令</UpdateVariable>',
        '{"unrelated":true}',
        '[{"op":"replace","path":"/hp","value":NaN}]',
        '- &loop\n  op: replace\n  path: /hp\n  value: *loop',
    ])('returns null when no valid update can be extracted: %s', response => {
        expect(parseAndValidateExtraModelResult(response)).toBeNull();
    });
});

type ToolCallBatches = Array<
    Array<{
        index: number;
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
    }>
>;

const makeToolCalls = (argumentsValue: string, name = MVU_FUNCTION_NAME): ToolCallBatches => [
    [
        {
            index: 0,
            id: 'tool_0',
            type: 'function',
            function: {
                name,
                arguments: argumentsValue,
            },
        },
    ],
];

// 工具调用提取：从匹配工具的参数中读取 delta，处理包装标签、无效参数和 Slash 返回结构。
describe('extractFromToolCall', () => {
    // 无效工具结果：缺少调用、工具名或有效 delta 时返回空结果。
    test('returns null when tool_calls is missing or empty', () => {
        expect(extractFromToolCall(undefined)).toBeNull();
        expect(extractFromToolCall([] as ToolCallBatches)).toBeNull();
    });

    test('returns null when the first batch is empty', () => {
        const toolCalls = [[]] as unknown as ToolCallBatches;
        expect(extractFromToolCall(toolCalls)).toBeNull();
    });

    test('returns null when no matching tool name exists', () => {
        const args = JSON.stringify({
            delta: '[{"op":"add","path":"/x","value":1}]',
            analysis: 'ok',
        });
        const toolCalls = makeToolCalls(args, 'other_tool');
        expect(extractFromToolCall(toolCalls)).toBeNull();
    });

    test('returns null when arguments do not contain delta', () => {
        const toolCalls = makeToolCalls('not json');
        expect(extractFromToolCall(toolCalls)).toBeNull();
    });

    test('returns null when arguments are empty', () => {
        const toolCalls = makeToolCalls('');
        expect(extractFromToolCall(toolCalls)).toBeNull();
    });

    test('returns null when delta is too short', () => {
        const args = JSON.stringify({ delta: '1234', analysis: 'short' });
        const toolCalls = makeToolCalls(args);
        expect(extractFromToolCall(toolCalls)).toBeNull();
    });

    test('accepts an empty JSONPatch array as a no-op', () => {
        const args = JSON.stringify({ delta: '[]', analysis: 'no changes' });
        const toolCalls = makeToolCalls(args);
        const result = extractFromToolCall(toolCalls);
        expect(result).toContain('<JSONPatch>');
        expect(result).toContain('[]');
    });

    // 有效结果与标签边界：选择正确调用，保留补丁值中的字面标签。
    test('extracts from the last matching call in the first batch', () => {
        const firstArgs = JSON.stringify({
            delta: '[{"op":"replace","path":"/first","value":1}]',
            analysis: 'first',
        });
        const secondArgs = JSON.stringify({
            delta: '[{"op":"replace","path":"/second","value":2}]',
            analysis: 'second',
        });
        const toolCalls: ToolCallBatches = [
            [
                {
                    index: 0,
                    id: 'tool_0',
                    type: 'function',
                    function: { name: MVU_FUNCTION_NAME, arguments: firstArgs },
                },
                {
                    index: 1,
                    id: 'tool_1',
                    type: 'function',
                    function: { name: 'other_tool', arguments: firstArgs },
                },
                {
                    index: 2,
                    id: 'tool_2',
                    type: 'function',
                    function: { name: MVU_FUNCTION_NAME, arguments: secondArgs },
                },
            ],
        ];

        const expected = [
            '<UpdateVariable>',
            '<Analyze>',
            'second',
            '</Analyze>',
            '<JSONPatch>',
            '[',
            '  {',
            '    "op": "replace",',
            '    "path": "/second",',
            '    "value": 2',
            '  }',
            ']',
            '</JSONPatch>',
            '</UpdateVariable>',
        ].join('\n');

        expect(extractFromToolCall(toolCalls)).toBe(expected);
    });

    test('handles UpdateVariable-style delta payload', () => {
        const delta = [
            '<UpdateVariable>',
            '<Analysis>',
            '    希雅.与理的关系: Y',
            '</Analysis>',
            "_.set('希雅.与理的关系', '恋人');",
            '</UpdateVariable>',
        ].join('\n');
        const analysis = 'Time passed: 1 hour.';
        const args = JSON.stringify({ delta, analysis });
        const toolCalls = makeToolCalls(args);

        const expected = [
            '<UpdateVariable>',
            '<Analyze>',
            analysis,
            '</Analyze>',
            `${delta}`,
            '</UpdateVariable>',
        ].join('\n');

        expect(extractFromToolCall(toolCalls)).toBe(expected);
    });

    test('preserves literal wrapper tags inside json patch values', () => {
        const patch = [
            {
                op: 'replace',
                path: '/template',
                value: '<UpdateVariable><Analysis>literal</Analysis></UpdateVariable>',
            },
        ];
        const delta = [
            '<UpdateVariable>',
            '<Analysis>',
            '    模板内容需要原样保留',
            '</Analysis>',
            '<JSONPatch>',
            JSON.stringify(patch, null, 2),
            '</JSONPatch>',
            '</UpdateVariable>',
        ].join('\n');
        const analysis = 'Preserve literal tags.';
        const args = JSON.stringify({ delta, analysis });
        const toolCalls = makeToolCalls(args);

        const expected = [
            '<UpdateVariable>',
            '<Analyze>',
            analysis,
            '</Analyze>',
            '<JSONPatch>',
            JSON.stringify(patch, null, 2),
            '</JSONPatch>',
            '</UpdateVariable>',
        ].join('\n');

        expect(extractFromToolCall(toolCalls)).toBe(expected);
    });

    test('accepts mixed JSONPatch tag variants on the outer wrapper', () => {
        const patch = [{ op: 'replace', path: '/x', value: 1 }];
        const delta = ['<JSONPatch>', JSON.stringify(patch), '</JSON_Patch>'].join('\n');
        const analysis = 'Mixed wrapper tags.';
        const args = JSON.stringify({ delta, analysis });
        const toolCalls = makeToolCalls(args);

        const expected = [
            '<UpdateVariable>',
            '<Analyze>',
            analysis,
            '</Analyze>',
            '<JSONPatch>',
            JSON.stringify(patch, null, 2),
            '</JSONPatch>',
            '</UpdateVariable>',
        ].join('\n');

        expect(extractFromToolCall(toolCalls)).toBe(expected);
    });

    test('returns null when json patch tag exists but is invalid', () => {
        const delta = '<JSONPatch>{"foo":1}</JSONPatch>';
        const args = JSON.stringify({ delta, analysis: 'bad patch' });
        const toolCalls = makeToolCalls(args);
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        expect(extractFromToolCall(toolCalls)).toBeNull();
        expect(errorSpy).toHaveBeenCalled();

        errorSpy.mockRestore();
    });

    test('returns null when delta is not a json patch and not legacy', () => {
        const delta = '{"foo":1}';
        const args = JSON.stringify({ delta, analysis: 'not a patch' });
        const toolCalls = makeToolCalls(args);

        expect(extractFromToolCall(toolCalls)).toBeNull();
    });

    test('alt', () => {
        const content = {
            id: 'it3NaZ64I5XhtfAP7aTP6Ag',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        tool_calls: [
                            {
                                id: 'tc_b6b29356-fd5d-477e-9a34-186b373484fb',
                                type: 'function',
                                function: {
                                    name: 'mvu_VariableUpdate_test-script-id',
                                    arguments:
                                        '{"analysis":"(1) Approx 1 hour passed; (2) No; (3) 世界/当前时间段, 触手君/饱食度, 触手君/湿润度, 触手君/信赖度, 触手君/占有欲, 触手君/成长经验值, 触手君/当前情绪, 触手君/已掌握的技能, 触手君/身体部位好感度/手, player/当前情绪, player/体力, player/受影响程度, player/本次互动高光部位; (4) 世界/当前时间段: Y, 触手君/饱食度: Y, 触手君/湿润度: Y, 触手君/信赖度: Y, 触手君/占有欲: Y, 触手君/成长经验值: Y, 触手君/当前情绪: Y, 触手君/已掌握的技能: Y, 触手君/身体部位好感度/手: Y, player/当前情绪: Y, player/体力: Y, player/受影响程度: Y, player/本次互动高光部位: Y; (5) Evaluated based on \\u003cpast_observe\\u003e.","delta":"\\u003cUpdateVariable\\u003e\\n\\u003cAnalysis\\u003e\\n(1) 时间流逝约1小时；(2) 否；(3) 世界/当前时间段, 触手君/饱食度, 触手君/湿润度, 触手君/信赖度, 触手君/占有欲, 触手君/成长经验值, 触手君/当前情绪, 触手君/已掌握的技能, 触手君/身体部位好感度/手, player/当前情绪, player/体力, player/受影响程度, player/本次互动高光部位；(4) Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y。\\n\\u003c/Analysis\\u003e\\n\\u003cJSONPatch\\u003e\\n[\\n  { \\"op\\": \\"replace\\", \\"path\\": \\"/世界/当前时间段\\", \\"value\\": \\"傍晚\\" },\\n  { \\"op\\": \\"delta\\", \\"path\\": \\"/触手君/饱食度\\", \\"value\\": -5 },\\n  { \\"op\\": \\"delta\\", \\"path\\": \\"/触手君/湿润度\\", \\"value\\": -5 },\\n  { \\"op\\": \\"delta\\", \\"path\\": \\"/触手君/信赖度\\", \\"value\\": 5 },\\n  { \\"op\\": \\"delta\\", \\"path\\": \\"/触手君/占有欲\\", \\"value\\": 3 },\\n  { \\"op\\": \\"delta\\", \\"path\\": \\"/触手君/成长经验值\\", \\"value\\": 10 },\\n  { \\"op\\": \\"replace\\", \\"path\\": \\"/触手君/当前情绪\\", \\"value\\": \\"期待/温情\\" },\\n  { \\"op\\": \\"insert\\", \\"path\\": \\"/触手君/已掌握的技能/物品递送（进阶）\\", \\"value\\": { \\"detail\\": \\"学会区分干净与脏污，能按指令或需求准确递送物品。\\" } },\\n  { \\"op\\": \\"delta\\", \\"path\\": \\"/触手君/身体部位好感度/手\\", \\"value\\": 3 },\\n  { \\"op\\": \\"replace\\", \\"path\\": \\"/player/当前情绪\\", \\"value\\": \\"虚弱/舒缓\\" },\\n  { \\"op\\": \\"delta\\", \\"path\\": \\"/player/体力\\", \\"value\\": -5 },\\n  { \\"op\\": \\"delta\\", \\"path\\": \\"/player/受影响程度\\", \\"value\\": 2 },\\n  { \\"op\\": \\"replace\\", \\"path\\": \\"/player/本次互动高光部位\\", \\"value\\": \\"手腕\\" }\\n]\\n\\u003c/JSONPatch\\u003e\\n\\u003c/UpdateVariable\\u003e"}',
                                },
                                index: 0,
                            },
                        ],
                    },
                    finish_reason: 'tool_calls',
                },
            ],
            object: 'chat.completion',
            created: 1775099295,
            model: 'gemini-3-flash-preview',
            usage: {
                prompt_tokens: 6559,
                completion_tokens: 3527,
                total_tokens: 10086,
                prompt_tokens_details: null,
                completion_tokens_details: {
                    audio_tokens: 0,
                    reasoning_tokens: 2642,
                    accepted_prediction_tokens: 0,
                    rejected_prediction_tokens: 0,
                },
            },
        };
        const input = [content];
        const toolCalls = input[0].choices[0].message.tool_calls;

        const outer = [];
        outer[0] = toolCalls;
        expect(extractFromToolCall(outer as any)).not.toBeNull();
    });

    // 解析与调用方兼容：参数解析失败可控，支持 Slash 的标准工具结果结构。
    test('returns null when argument parsing throws', () => {
        jest.isolateModules(() => {
            jest.doMock('@util/common', () => {
                const actual = jest.requireActual('@util/common');
                return {
                    ...actual,
                    parseString: jest.fn(() => {
                        throw new Error('boom');
                    }),
                };
            });
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs a synchronous import
            const { extractFromToolCall, MVU_FUNCTION_NAME } = require('@/function/function_call');
            const args = JSON.stringify({
                delta: '[{"op":"add","path":"/x","value":1}]',
                analysis: 'ok',
            });
            const toolCalls = [
                [
                    {
                        index: 0,
                        id: 'tool_0',
                        type: 'function',
                        function: { name: MVU_FUNCTION_NAME, arguments: args },
                    },
                ],
            ];

            expect(extractFromToolCall(toolCalls)).toBeNull();
        });
    });

    test('extracts from slash-runner GenerateToolCallResult', () => {
        const args = JSON.stringify({
            analysis: 'tool result',
            delta: '[{"op":"replace","path":"/x","value":1}]',
        });
        const result: GenerateToolCallResult = {
            content: '',
            tool_calls: [
                {
                    id: 'tool_0',
                    type: 'function',
                    function: {
                        name: MVU_FUNCTION_NAME,
                        arguments: args,
                    },
                },
            ],
        };

        expect(extractFromGenerateToolCallResult(result)).toBe(
            [
                '<UpdateVariable>',
                '<Analyze>',
                'tool result',
                '</Analyze>',
                '<JSONPatch>',
                '[',
                '  {',
                '    "op": "replace",',
                '    "path": "/x",',
                '    "value": 1',
                '  }',
                ']',
                '</JSONPatch>',
                '</UpdateVariable>',
            ].join('\n')
        );
    });
});

// 格式化输出提取：支持对象、根数组和服务商文本返回，统一包装为变量更新块。
describe('extractFromFormattedOutput', () => {
    test('extracts json_patch object response into UpdateVariable block', () => {
        const content = JSON.stringify({
            analysis: 'formatted result',
            json_patch: [
                { op: 'delta', path: '/主角/体力', value: -2 },
                {
                    op: 'add',
                    path: '/主角/持有物品/-',
                    value: { name: '铜钥匙', description: '铜钥匙' },
                },
            ],
        });

        expect(extractFromFormattedOutput(content)).toBe(
            [
                '<UpdateVariable>',
                '<Analyze>',
                'formatted result',
                '</Analyze>',
                '<JSONPatch>',
                '[',
                '  {',
                '    "op": "delta",',
                '    "path": "/主角/体力",',
                '    "value": -2',
                '  },',
                '  {',
                '    "op": "add",',
                '    "path": "/主角/持有物品/-",',
                '    "value": {',
                '      "name": "铜钥匙",',
                '      "description": "铜钥匙"',
                '    }',
                '  }',
                ']',
                '</JSONPatch>',
                '</UpdateVariable>',
            ].join('\n')
        );
    });

    test('accepts root array response as fallback', () => {
        const content = JSON.stringify([{ op: 'replace', path: '/x', value: 1 }]);

        expect(extractFromFormattedOutput(content)).toBe(
            [
                '<UpdateVariable>',
                '<Analyze>',
                '',
                '</Analyze>',
                '<JSONPatch>',
                '[',
                '  {',
                '    "op": "replace",',
                '    "path": "/x",',
                '    "value": 1',
                '  }',
                ']',
                '</JSONPatch>',
                '</UpdateVariable>',
            ].join('\n')
        );
    });

    test('extracts real provider formatted-output content string', () => {
        const content =
            '{\n  "analysis": "The `理.好感度` is incremented by 8 due to the pleasant interaction, increasing from 15 to 23. `理.情绪状态.pleasure` and `理.情绪状态.arousal` are increased by 0.2 and 0.1 respectively as she experiences a mix of unexpected intimacy and nervousness. `理.情绪状态.dominance` is decreased by 0.1 as she is caught off guard and put in a submissive position. `理.情绪状态.affinity` is increased by 0.1 due to the unexpected physical intimacy. `理.当前所想` is updated to reflect her current focus on the unusual interaction and maintaining composure. `日期` and `时间` are updated to reflect the passage of 5 minutes during the interaction. `天数` remains unchanged as the interaction occurs within the same day.",\n  "json_patch": [\n    {\n      "op": "delta",\n      "path": "/理/好感度",\n      "value": 8\n    },\n    {\n      "op": "delta",\n      "path": "/理/情绪状态/pleasure",\n      "value": 0.2\n    },\n    {\n      "op": "delta",\n      "path": "/理/情绪状态/arousal",\n      "value": 0.1\n    },\n    {\n      "op": "delta",\n      "path": "/理/情绪状态/dominance",\n      "value": -0.1\n    },\n    {\n      "op": "delta",\n      "path": "/理/情绪状态/affinity",\n      "value": 0.1\n    },\n    {\n      "op": "replace",\n      "path": "/理/当前所想",\n      "value": "悠纪大人为什么会...是新的礼节吗？怎样才能表现得更得体一些？"\n    },\n    {\n      "op": "replace",\n      "path": "/时间",\n      "value": "09:05"\n    }\n  ]\n}';

        const result = extractFromFormattedOutput(content);

        expect(result).not.toBeNull();
        expect(result).toContain('<UpdateVariable>');
        expect(result).toContain('The `理.好感度` is incremented by 8');
        expect(result).toContain('"path": "/理/好感度"');
        expect(result).toContain('"value": 8');
        expect(result).toContain('"path": "/理/情绪状态/dominance"');
        expect(result).toContain('"value": -0.1');
        expect(result).toContain('"path": "/时间"');
        expect(result).toContain('"value": "09:05"');
        expect(result).toContain('</UpdateVariable>');
    });

    test('formatted response schema wraps json patch in a root object', () => {
        expect(MVU_JSON_PATCH_RESPONSE_SCHEMA.value.type).toBe('object');
        expect(MVU_JSON_PATCH_RESPONSE_SCHEMA.value.required).toEqual(['analysis', 'json_patch']);
        expect(MVU_JSON_PATCH_RESPONSE_SCHEMA.value.properties.json_patch.type).toBe('array');
    });
});
