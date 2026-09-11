import {
    buildIncrementalRepairTask,
    buildIncrementalRepairUserInput,
    collectIncrementalStateChanges,
    extractLatestUpdateVariableBlock,
    mergeIncrementalRepairBlock,
    validateIncrementalRepairBlock,
    validateIncrementalRepairCommands,
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

    test('includes an optional user direction without requiring one', () => {
        expect(buildIncrementalRepairUserInput('核对生命值归零后的即时后果')).toContain(
            '<user_incremental_repair_direction>'
        );
        expect(buildIncrementalRepairUserInput('核对生命值归零后的即时后果')).toContain(
            '核对生命值归零后的即时后果'
        );
        expect(buildIncrementalRepairUserInput()).toBe('遵循<must>指令');
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
});
