import { appendIncrementalRepairBlock } from '@/function/update/incremental_repair';
import {
    closeUpdateMarkup,
    findUpdateMarkupBlocks,
    scanUpdateMarkup,
} from '@/function/update/structured_update';
import { extractCommands, updateVariables } from '@/function/update_variables';
import { type MvuData } from '@/variable_def';
import { klona } from 'klona';
import YAML from 'yaml';

const patch = (body: string) => `<JSONPatch>\n${body}\n</JSONPatch>`;
const originalOperation = '[{"op":"replace","path":"/hp","value":75}]';
const originalPatch = patch(originalOperation);
const originalScript = "_.set('hp', 75);";
const repairPatch = patch('[{"op":"delta","path":"/hp","value":5}]');
const variables = (): MvuData => ({
    stat_data: { hp: 72, note: '' },
    schema: { type: 'object', properties: {}, extensible: true },
    initialized_lorebooks: {},
});

/** 原文形态矩阵：实际执行前后对比，确保补边界只释放新补丁，不激活旧残缺命令。 */
const originals: { name: string; text: string }[] = [
    {
        name: 'fences adjacent to tags',
        text: '<JSONPatch>```json\n' + originalOperation + '\n```</JSONPatch>',
    },
    { name: 'unclosed fence adjacent to patch', text: originalPatch + '\n<JSONPatch>```json\n[]' },
    { name: 'bare script', text: originalScript },
    { name: 'multiline script', text: "_.set(\n'hp',\n75\n);" },
    { name: 'wrapped script', text: `<UpdateVariable>${originalScript}</UpdateVariable>` },
    { name: 'unclosed update around script', text: `<UpdateVariable>${originalScript}` },
    { name: 'bare JSONPatch', text: originalPatch },
    { name: 'wrapped JSONPatch', text: `<UpdateVariable>${originalPatch}</UpdateVariable>` },
    { name: 'unclosed update around patch', text: `<UpdateVariable>${originalPatch}` },
    { name: 'multiple patches', text: patch('[]') + '\n' + originalPatch },
    {
        name: 'unclosed update with multiple patches',
        text: '<UpdateVariable>' + patch('[]') + originalPatch,
    },
    {
        name: 'multiple update wrappers',
        text: `<UpdateVariable>${patch('[]')}</UpdateVariable><UpdateVariable>${originalPatch}</UpdateVariable>`,
    },
    {
        name: 'nested update wrappers',
        text: `<UpdateVariable><UpdateVariable>${originalPatch}</UpdateVariable>`,
    },
    {
        name: 'two unclosed update wrappers',
        text: `<UpdateVariable><VariableUpdate>${originalPatch}`,
    },
    { name: 'mixed scripts and patch', text: originalScript + '\n' + patch('[]') },
    { name: 'JSON5', text: patch("[{op:'replace',path:'/hp',value:75,},]") },
    {
        name: 'JSON5 internal comment',
        text: patch("[/* data */{op:'replace',path:'/hp',value:75,},]"),
    },
    {
        name: 'JSON5 leading comment retains executor behavior',
        text: patch("// comment\n[{op:'replace',path:'/hp',value:75,},]"),
    },
    { name: 'YAML', text: patch('- op: replace\n  path: /hp\n  value: 75') },
    {
        name: 'YAML comments',
        text: patch('# comment\n- op: replace\n  path: /hp\n  value: 75 # done'),
    },
    { name: 'JSON fenced inside patch', text: patch('```json\n' + originalOperation + '\n```') },
    {
        name: 'YAML fenced inside patch',
        text: patch('```yaml\n- op: replace\n  path: /hp\n  value: 75\n```'),
    },
    { name: 'outer closed fence', text: '```xml\n' + originalPatch + '\n```' },
    { name: 'outer unclosed fence', text: '```xml\n' + originalPatch },
    { name: 'outer four-backtick fence', text: '````xml\n' + originalPatch },
    { name: 'outer tilde fence', text: '~~~xml\n' + originalPatch },
    { name: 'fenced script', text: '```js\n' + originalScript + '\n```' },
    { name: 'unclosed fenced script', text: '```js\n' + originalScript },
    {
        name: 'case and tag attributes',
        text: `<VariableUpdate><json_patch data-x="1">${originalOperation}</JSON_PATCH></VariableUpdate>`,
    },
    { name: 'update alias', text: `<Update>${originalPatch}</Update>` },
    {
        name: 'closed reasoning with example',
        text:
            '<Think>' +
            patch('[{"op":"replace","path":"/hp","value":999}]') +
            '</Think>' +
            originalPatch,
    },
    { name: 'surrounding prose', text: '剧情开始\n' + originalPatch + '\n剧情结束' },
    { name: 'trailing whitespace is preserved', text: originalPatch + '\n\n  ' },
    { name: 'CRLF', text: `<UpdateVariable>\r\n${originalPatch.replaceAll('\n', '\r\n')}\r\n` },
    { name: 'trailing line comment', text: originalScript + '// done' },
    { name: 'closed block comment', text: originalScript + ' /* done */' },
    { name: 'unclosed block comment', text: originalScript + ' /* incomplete' },
    { name: 'unclosed block comment ending in star', text: originalScript + ' /* incomplete*' },
    { name: 'unclosed double quote', text: originalScript + '\n"incomplete' },
    { name: 'unclosed single quote', text: originalScript + "\n'incomplete" },
    { name: 'unclosed quote ending in backslash', text: originalScript + '\n"incomplete\\' },
    { name: 'unclosed reasoning', text: originalPatch + '\n<Think>unfinished' },
    { name: 'unclosed Analyze', text: originalPatch + '\n<Analyze>unfinished' },
    { name: 'nested reasoning', text: originalPatch + '\n<Thinking><Analysis>unfinished' },
    {
        name: 'reasoning in unclosed update',
        text: '<UpdateVariable>' + originalPatch + '\n<Reasoning>unfinished',
    },
    {
        name: 'reasoning in unclosed fence',
        text: '```xml\n' + originalPatch + '\n<Think>unfinished',
    },
    { name: 'unclosed patch with empty array', text: originalPatch + '\n<JSONPatch>[]' },
    {
        name: 'unclosed patch must not activate complete operations',
        text: originalPatch + '\n<JSONPatch>[{"op":"replace","path":"/hp","value":999}]',
    },
    {
        name: 'unclosed patch must not activate repairable operations',
        text: originalPatch + '\n<JSONPatch>[{"op":"replace","path":"/hp","value":999}',
    },
    {
        name: 'unclosed patch with open string',
        text: originalPatch + '\n<JSONPatch>[{"value":"unfinished',
    },
    {
        name: 'unclosed patch string with backslash',
        text: originalPatch + '\n<JSONPatch>[{"value":"unfinished\\',
    },
    {
        name: 'unclosed patch with block comment',
        text: originalPatch + '\n<JSONPatch>[/*unfinished',
    },
    {
        name: 'unclosed patch with line comment',
        text: originalPatch + '\n<JSONPatch>[//unfinished',
    },
    {
        name: 'unclosed patch with reasoning',
        text: originalPatch + '\n<JSONPatch><Think>unfinished',
    },
    {
        name: 'unclosed patch containing a valid inner patch',
        text: `<UpdateVariable><JSONPatch>${originalPatch}`,
    },
    {
        name: 'unclosed patch inside unclosed update',
        text: '<UpdateVariable>' + originalPatch + '\n<json_patch>[]',
    },
    {
        name: 'unclosed inner fence inside unclosed patch',
        text: originalPatch + '\n<JSONPatch>```json\n[]',
    },
    {
        name: 'unclosed outer fence around unclosed patch',
        text: '```xml\n' + originalPatch + '\n<JSONPatch>[]',
    },
    {
        name: 'unclosed YAML quoted value',
        text: originalPatch + '\n<JSONPatch>- op: replace\n  path: /note\n  value: "unfinished',
    },
    {
        name: 'unclosed YAML block scalar',
        text:
            originalPatch +
            '\n<JSONPatch>- op: replace\n  path: /note\n  value: |-\n    unfinished',
    },
    {
        name: 'literal tags and fences inside a JSON string',
        text: patch(
            '[{"op":"replace","path":"/hp","value":75},{"op":"replace","path":"/note","value":"</JSONPatch><Think>literal```"}]'
        ),
    },
    {
        name: 'literal tags and fences in YAML scalar',
        text: patch(
            '- op: replace\n  path: /hp\n  value: 75\n- op: replace\n  path: /note\n  value: |-\n    <Think>\n    ```\n    </JSONPatch>'
        ),
    },
    { name: 'bare JSON remains unrecognized by executor', text: originalOperation },
    {
        name: 'bare JSON inside update remains unrecognized',
        text: `<UpdateVariable>${originalOperation}</UpdateVariable>`,
    },
    { name: 'bare YAML remains unrecognized', text: '- op: replace\n  path: /hp\n  value: 75' },
];

describe('append repair across original message boundaries', () => {
    const originalYaml = Object.getOwnPropertyDescriptor(globalThis, 'YAML');
    beforeAll(() => Object.defineProperty(globalThis, 'YAML', { configurable: true, value: YAML }));
    afterAll(() => {
        if (originalYaml) Object.defineProperty(globalThis, 'YAML', originalYaml);
        else Reflect.deleteProperty(globalThis, 'YAML');
    });

    test.each(originals)(
        '$name retains original commands and appends each repair form',
        async ({ text }) => {
            // 主路径追加 JSONPatch；已有的多个补丁、脚本和混合结果也必须维持此前接受的语义。
            for (const repair of [
                repairPatch,
                `<UpdateVariable>${repairPatch}</UpdateVariable>`,
                "_.add('hp', 5);",
                patch('[]') + '\n' + repairPatch,
            ]) {
                const appended = appendIncrementalRepairBlock(text, repair);
                expect(extractCommands(appended)).toEqual([
                    ...extractCommands(text),
                    ...extractCommands(repair),
                ]);

                const original = variables();
                const originalErrors: string[] = [];
                await updateVariables(text, original, originalErrors);
                const expected = klona(original.stat_data);
                expected.hp = Number(expected.hp) + 5;
                const actual = variables();
                const errors: string[] = [];
                await updateVariables(appended, actual, errors);
                expect(actual.stat_data).toEqual(expected);
                expect(errors).toEqual(originalErrors);
            }
        }
    );

    test.each(originals)('$name leaves a closed boundary before the new patch', ({ text }) => {
        const closed = text + closeUpdateMarkup(text);
        const scan = scanUpdateMarkup(closed);
        expect(scan.tail).toEqual({ quote: '', blockComment: false, reasoning: [] });
        expect(findUpdateMarkupBlocks(closed, 'patch').every(block => block.closed)).toBe(true);
        expect(findUpdateMarkupBlocks(closed, 'update').every(block => block.closed)).toBe(true);
        expect(closeUpdateMarkup(closed)).toBe('\n');
    });

    test('closes an inline inner fence before its incomplete patch', () => {
        const original = '<JSONPatch>```json\n[]';
        const closed = original + closeUpdateMarkup(original);
        expect(closed.indexOf('```', original.length)).toBeGreaterThanOrEqual(original.length);
        expect(closed.indexOf('```', original.length)).toBeLessThan(closed.indexOf('</JSONPatch>'));
        expect(extractCommands(closed)).toEqual([]);
    });

    test('preserves the ignore marker across multiple subsequent appends', async () => {
        const original = originalPatch + '\n<JSONPatch>[{"op":"replace","path":"/hp","value":999}]';
        const once = appendIncrementalRepairBlock(original, repairPatch);
        const twice = appendIncrementalRepairBlock(once, repairPatch);
        expect(twice.startsWith(once)).toBe(true);
        expect(extractCommands(twice)).toEqual([
            ...extractCommands(original),
            ...extractCommands(repairPatch),
            ...extractCommands(repairPatch),
        ]);
        const actual = variables();
        await updateVariables(twice, actual, []);
        expect(actual.stat_data.hp).toBe(85);
    });

    test('does not modify original tags or trailing prose', () => {
        const original = `<VariableUpdate>${originalPatch}</VariableUpdate>\n尾注  `;
        expect(
            appendIncrementalRepairBlock(
                original,
                `<UpdateVariable>${repairPatch}</UpdateVariable>`
            )
        ).toBe(`<VariableUpdate>${originalPatch}\n\n${repairPatch}\n</VariableUpdate>\n尾注  `);
    });

    test('inserts into the last closed wrapper and keeps repeated repairs inside it', () => {
        const original = `<UpdateVariable>${patch('[]')}</UpdateVariable>\n<UpdateVariable>${originalPatch}</UpdateVariable>\n尾注`;
        const once = appendIncrementalRepairBlock(original, repairPatch);
        const twice = appendIncrementalRepairBlock(once, repairPatch);
        const target = findUpdateMarkupBlocks(twice, 'update').at(-1)!;
        expect(twice.slice(target.contentStart, target.contentEnd)).toContain(repairPatch + '\n');
        expect(extractCommands(twice.slice(target.end))).toEqual([]);
        // 现有完整重试删除最后一个更新块时，也会删除其中的全部增量校正。
        const retried =
            twice.slice(0, twice.lastIndexOf('<UpdateVariable>')) +
            twice.slice(twice.lastIndexOf('</UpdateVariable>') + 17);
        expect(extractCommands(retried)).toEqual([]);
    });

    test('falls back to the end if a closed wrapper is followed by executable commands', () => {
        const original = `<UpdateVariable>${originalPatch}</UpdateVariable>\n_.set('hp', 90);`;
        const appended = appendIncrementalRepairBlock(original, repairPatch);
        expect(appended.startsWith(original)).toBe(true);
        expect(extractCommands(appended)).toEqual([
            ...extractCommands(original),
            ...extractCommands(repairPatch),
        ]);
    });

    test.each(['', '  ', '<UpdateVariable>\n</UpdateVariable>'])(
        'keeps the original verbatim for empty repair %s',
        repair => {
            const original = originalPatch + '\n<Think>unfinished';
            expect(appendIncrementalRepairBlock(original, repair)).toBe(original);
        }
    );
});
