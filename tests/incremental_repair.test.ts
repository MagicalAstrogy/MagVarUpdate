import {
    buildIncrementalRepairTask,
    buildIncrementalRepairPromptTail,
    collectIncrementalStateChanges,
    extractLatestUpdateVariableBlock,
    mergeIncrementalRepairBlock,
    mergeIncrementalRepairMetadata,
    normalizeAndValidateIncrementalRepairResult,
    normalizeIncrementalRepairBlock,
    validateIncrementalRepairAgainstState,
    validateIncrementalRepairBlock,
    validateIncrementalRepairCommands,
    verifyIncrementalRepairApplied,
} from '@/function/update/incremental_repair';
import { extractCommands } from '@/function/update_variables';

describe('incremental extra-model repair', () => {
    test('collects only changes already applied on the current floor', () => {
        expect(
            collectIncrementalStateChanges(
                { hp: 100, inventory: ['water'], unchanged: true },
                { hp: 72, inventory: ['water', 'key'], unchanged: true }
            )
        ).toEqual([
            { path: '/hp', before: 100, after: 72 },
            { path: '/inventory', before: ['water'], after: ['water', 'key'] },
        ]);
    });

    test('prompt requires corrections instead of recalculating correct changes', () => {
        const task = buildIncrementalRepairTask([{ path: '/hp', before: 100, after: 72 }]);
        expect(task).toContain('本次是增量变量校正，不是完整重试');
        expect(task).toContain('已经正确的变化禁止重复输出');
        expect(task).toContain('不得重算或覆盖整份变量');
        expect(task).toContain('/hp: 100 -> 72');
        expect(task).toContain('没有需要修正的内容时输出空 JSONPatch 数组');
    });

    test('places an optional user direction in a final prompt reminder', () => {
        expect(buildIncrementalRepairPromptTail('核对生命值归零后的即时后果')).toContain(
            '<incremental_repair_final_check>'
        );
        expect(buildIncrementalRepairPromptTail('核对生命值归零后的即时后果')).toContain(
            '核对生命值归零后的即时后果'
        );
        expect(buildIncrementalRepairPromptTail()).toContain('用户未补充方向');
    });

    test('merges repair content into the last existing update block', () => {
        const message = [
            '剧情正文',
            '<UpdateVariable>',
            "_.set('hp', 100, 72);//受伤",
            '</UpdateVariable>',
            '尾注',
        ].join('\n');
        const repair = [
            '<UpdateVariable>',
            '<JSONPatch>[{"op":"replace","path":"/infection","value":10}]</JSONPatch>',
            '</UpdateVariable>',
        ].join('\n');
        const merged = mergeIncrementalRepairBlock(message, repair);

        expect(merged.match(/<UpdateVariable>/g)).toHaveLength(1);
        expect(merged).toContain("_.set('hp', 100, 72);//受伤");
        expect(merged).toContain('"path":"/infection"');
        expect(merged.endsWith('尾注')).toBe(true);
    });

    test('creates one update block when the message has none', () => {
        const merged = mergeIncrementalRepairBlock(
            '剧情正文',
            '<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>'
        );
        expect(merged).toBe(
            '剧情正文\n\n<UpdateVariable>\n<JSONPatch>[]</JSONPatch>\n</UpdateVariable>'
        );
    });

    test('normalizes fenced and aliased patch output before persistence', () => {
        expect(
            normalizeIncrementalRepairBlock(
                '<VariableUpdate><json_patch>```json\n[{"op":"replace","path":"/hp","value":72}]\n```</json_patch></VariableUpdate>'
            )
        ).toBe(
            '<UpdateVariable>\n<JSONPatch>\n[\n  {\n    "op": "replace",\n    "path": "/hp",\n    "value": 72\n  }\n]\n</JSONPatch>\n</UpdateVariable>'
        );
    });

    test('canonicalizes a compatible existing update wrapper while merging', () => {
        const merged = mergeIncrementalRepairBlock(
            '<VariableUpdate>\n<JSONPatch>[]</JSONPatch>\n</VariableUpdate>',
            '<UpdateVariable><JSONPatch>[{"op":"replace","path":"/hp","value":72}]</JSONPatch></UpdateVariable>'
        );
        expect(merged.match(/<UpdateVariable>/g)).toHaveLength(1);
        expect(merged).not.toContain('<VariableUpdate>');
        expect(merged).toContain('"path":"/hp"');
    });

    test('extracts the last complete update block', () => {
        const message =
            '<UpdateVariable>first</UpdateVariable>正文<UpdateVariable>second</UpdateVariable>';
        expect(extractLatestUpdateVariableBlock(message)).toBe(
            '<UpdateVariable>second</UpdateVariable>'
        );
    });

    test('rejects non-idempotent and internal-path commands', () => {
        const delta = extractCommands(
            '<JSONPatch>[{"op":"delta","path":"/hp","value":-5}]</JSONPatch>'
        );
        expect(validateIncrementalRepairCommands(delta)).toContain('绝对值 replace');

        const internal = extractCommands(
            '<JSONPatch>[{"op":"replace","path":"/$internal/busy","value":true}]</JSONPatch>'
        );
        expect(validateIncrementalRepairCommands(internal)).toContain('禁止修改 MVU 内部路径');

        const nestedInsert =
            '<JSONPatch>[{"op":"insert","path":"/player/$internal","value":true}]</JSONPatch>';
        expect(validateIncrementalRepairBlock(nestedInsert)).toContain('禁止修改 MVU 内部路径');
        expect(validateIncrementalRepairCommands(extractCommands(nestedInsert))).toContain(
            '禁止修改 MVU 内部路径'
        );
    });

    test('requires exactly one conservative JSON patch block', () => {
        expect(validateIncrementalRepairBlock("_.set('hp', 72);")).toContain('一个 JSONPatch');
        expect(
            validateIncrementalRepairBlock(
                '<JSONPatch>[{"op":"delta","path":"/hp","value":-5}]</JSONPatch>'
            )
        ).toContain('不接受 delta');
        expect(
            validateIncrementalRepairBlock('<JSONPatch>[{"op":"replace","path":"/hp"}]</JSONPatch>')
        ).toContain('缺少 value');
        expect(
            validateIncrementalRepairBlock(
                '<JSONPatch>[{"op":"replace","path":"/hp","value":72}]</JSONPatch>'
            )
        ).toBeNull();
    });

    test('accepts absolute replacements and removals', () => {
        const commands = extractCommands(
            '<JSONPatch>[{"op":"replace","path":"/hp","value":72},{"op":"remove","path":"/bad"}]</JSONPatch>'
        );
        expect(validateIncrementalRepairCommands(commands)).toBeNull();
    });

    test('normalizes and validates a response before request strategy acceptance', () => {
        expect(() =>
            normalizeAndValidateIncrementalRepairResult(
                '<UpdateVariable><JSONPatch>[{"op":"delta","path":"/hp","value":-5}]</JSONPatch></UpdateVariable>'
            )
        ).toThrow('不接受 delta');
        expect(
            normalizeAndValidateIncrementalRepairResult(
                '<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>'
            )
        ).toContain('<JSONPatch>');
    });

    test('preflights targets and confirms every operation took effect', () => {
        const patch =
            '<UpdateVariable><JSONPatch>[{"op":"replace","path":"/hp","value":72},{"op":"replace","path":"/inventory","value":["key"]}]</JSONPatch></UpdateVariable>';
        expect(validateIncrementalRepairAgainstState(patch, { hp: 100, inventory: [] })).toBeNull();
        expect(validateIncrementalRepairAgainstState(patch, { inventory: [] })).toContain(
            '目标路径不存在'
        );
        expect(
            verifyIncrementalRepairApplied(
                patch,
                { hp: 100, inventory: [] },
                { hp: 72, inventory: ['key'] }
            )
        ).toBeNull();
        expect(
            verifyIncrementalRepairApplied(
                patch,
                { hp: 100, inventory: [] },
                { hp: 72, inventory: [] }
            )
        ).toContain('替换操作未完整生效');
    });

    test('verifies the effective value while preserving a value description', () => {
        const patch = '<JSONPatch>[{"op":"replace","path":"/hp","value":72}]</JSONPatch>';
        expect(
            verifyIncrementalRepairApplied(
                patch,
                { hp: [100, 'current HP'] },
                {
                    hp: [72, 'current HP'],
                }
            )
        ).toBeNull();
    });

    test('merges repair metadata without dropping the original floor records', () => {
        const applied = {
            display_data: { hp: '72->64 (json_patch)', infection: 30 },
            delta_data: { hp: '72->64 (json_patch)' },
        };
        mergeIncrementalRepairMetadata(
            {
                display_data: { hp: '100->72 (json_patch)', infection: '0->30 (json_patch)' },
                delta_data: { hp: '100->72 (json_patch)', infection: '0->30 (json_patch)' },
            },
            applied
        );
        expect(applied).toEqual({
            display_data: { hp: '72->64 (json_patch)', infection: '0->30 (json_patch)' },
            delta_data: { hp: '72->64 (json_patch)', infection: '0->30 (json_patch)' },
        });
    });

    test('allows independent top-level inserts and rejects overlapping or indexed array edits', () => {
        const inserts =
            '<JSONPatch>[{"op":"insert","path":"/a","value":1},{"op":"insert","path":"/b","value":2}]</JSONPatch>';
        expect(validateIncrementalRepairCommands(extractCommands(inserts))).toBeNull();
        expect(validateIncrementalRepairAgainstState(inserts, {})).toBeNull();
        expect(
            validateIncrementalRepairAgainstState(
                '<JSONPatch>[{"op":"remove","path":"/items/0"}]</JSONPatch>',
                { items: ['a', 'b'] }
            )
        ).toContain('整体校正');
        expect(
            validateIncrementalRepairAgainstState(
                '<JSONPatch>[{"op":"replace","path":"/a","value":{}},{"op":"replace","path":"/a/b","value":2}]</JSONPatch>',
                { a: { b: 1 } }
            )
        ).toContain('相互覆盖');
    });
});
