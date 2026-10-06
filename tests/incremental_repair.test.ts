import {
    buildIncrementalRepairTask,
    buildIncrementalRepairPromptTail,
    collectIncrementalStateChanges,
    appendIncrementalRepairBlock,
    validateIncrementalRepairAgainstState,
} from '@/function/update/incremental_repair';
import { extractCommands, updateVariables } from '@/function/update_variables';
import { useDataStore } from '@/store';
import { type MvuData, variable_events } from '@/variable_def';
import { klona } from 'klona';

const createVariables = (stat_data: MvuData['stat_data']): MvuData => ({
    stat_data,
    initialized_lorebooks: {},
    schema: { type: 'object', properties: {}, extensible: true },
});

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

    test('appends a standalone repair after the complete original message', () => {
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
        const merged = appendIncrementalRepairBlock(message, repair);

        expect(merged.match(/<UpdateVariable>/g)).toHaveLength(1);
        expect(merged).toContain("_.set('hp', 100, 72);//受伤");
        expect(merged).toContain('"path":"/infection"');
        expect(merged.startsWith(message + '\n\n')).toBe(true);
        expect(
            merged.endsWith(
                '<JSONPatch>[{"op":"replace","path":"/infection","value":10}]</JSONPatch>'
            )
        ).toBe(true);
    });

    test('appends only the repair payload when the message has no update wrapper', () => {
        const merged = appendIncrementalRepairBlock(
            '剧情正文',
            '<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>'
        );
        expect(merged).toBe('剧情正文\n\n<JSONPatch>[]</JSONPatch>');
    });

    test('preserves the compatible original wrapper while appending a new patch', () => {
        const merged = appendIncrementalRepairBlock(
            '<VariableUpdate>\n<JSONPatch>[]</JSONPatch>\n</VariableUpdate>',
            '<UpdateVariable><JSONPatch>[{"op":"replace","path":"/hp","value":72}]</JSONPatch></UpdateVariable>'
        );
        expect(merged).not.toContain('<UpdateVariable>');
        expect(
            merged.startsWith('<VariableUpdate>\n<JSONPatch>[]</JSONPatch>\n</VariableUpdate>\n\n')
        ).toBe(true);
        expect(merged).toContain('"path":"/hp"');
    });

    test('accepts the normal update add alias and rejects a no-op', async () => {
        const patch = '<JSONPatch>[{"op":"add","path":"/item","value":"key"}]</JSONPatch>';
        expect(extractCommands(patch)).toEqual([
            expect.objectContaining({ type: 'insert', reason: 'json_patch' }),
        ]);
        await expect(
            validateIncrementalRepairAgainstState(patch, createVariables({}))
        ).resolves.toBeNull();
        await expect(
            validateIncrementalRepairAgainstState(patch, createVariables({ item: 'key' }))
        ).resolves.toContain('没有产生实际变化');
    });

    test('uses normal execution for inserts, indexed array edits and sequential overlapping paths', async () => {
        const cases: { patch: Record<string, unknown>[]; state: MvuData['stat_data'] }[] = [
            {
                patch: [
                    { op: 'insert', path: '/a', value: 1 },
                    { op: 'insert', path: '/b', value: 2 },
                ],
                state: {},
            },
            {
                patch: [{ op: 'replace', path: '/items/0', value: 'new' }],
                state: { items: ['a', 'b'] },
            },
            {
                patch: [
                    { op: 'replace', path: '/a', value: { b: 1 } },
                    { op: 'replace', path: '/a/b', value: 2 },
                ],
                state: { a: { b: 0 } },
            },
        ];
        for (const { patch, state } of cases) {
            const block = `<JSONPatch>${JSON.stringify(patch)}</JSONPatch>`;
            await expect(
                validateIncrementalRepairAgainstState(block, createVariables(state))
            ).resolves.toBeNull();
        }
    });
});

/** 使用真实更新器验证试执行结果与上下文隔离，覆盖原生和 MVU Zod 错误。 */
describe('incremental repair trial execution', () => {
    beforeEach(() => {
        (globalThis as any).toastr = { warning: jest.fn(), error: jest.fn() };
        useDataStore().settings.通知.变量更新出错 = true;
    });

    const patch = '<JSONPatch>[{"op":"replace","path":"/hp","value":80}]</JSONPatch>';

    test('keeps data, schema and callback mutations confined to the cloned context', async () => {
        const variables = createVariables({ hp: 72 });
        variables.display_data = { hp: 'old display' };
        variables.delta_data = { hp: 'old delta' };
        const original = klona(variables);
        let trial: MvuData | undefined;
        eventOn(variable_events.VARIABLE_UPDATE_STARTED, current => {
            trial = current as MvuData;
            current.initialized_lorebooks.book = ['trial-only'];
            current.schema.strictSet = true;
        });

        await expect(validateIncrementalRepairAgainstState(patch, variables)).resolves.toBeNull();

        expect(trial).not.toBe(variables);
        expect(trial?.stat_data.hp).toBe(80);
        expect(trial?.initialized_lorebooks.book).toEqual(['trial-only']);
        expect(variables).toEqual(original);
        expect(toastr.warning).not.toHaveBeenCalled();
    });

    test.each([
        "_.set('hp', 80);",
        '<JSONPatch>[{"op":"delta","path":"/hp","value":8}]</JSONPatch>',
        '<JSONPatch>[{"op":"unknown","path":"/hp"},{"op":"replace","path":"/hp","value":80}]</JSONPatch>',
        '<JSONPatch>not a patch</JSONPatch><JSONPatch>[{"op":"replace","path":"/hp","value":80}]</JSONPatch>',
        '<JSONPatch>[]</JSONPatch>' + "_.set('hp', 80);",
        '<UpdateVariable><JSONPatch>[{"op":"replace","path":"/hp","value":75}]</JSONPatch></UpdateVariable><UpdateVariable><JSONPatch>[{"op":"replace","path":"/hp","value":80}]</JSONPatch></UpdateVariable>',
    ])('uses executor parsing and persists the same accepted commands: %s', async result => {
        const variables = createVariables({ hp: 72 });
        await expect(validateIncrementalRepairAgainstState(result, variables)).resolves.toBeNull();
        expect(variables.stat_data.hp).toBe(72);
        const replayed = createVariables({ hp: 72 });
        const errors: string[] = [];
        await updateVariables(appendIncrementalRepairBlock('story', result), replayed, errors);
        expect(errors).toEqual([]);
        expect(replayed.stat_data.hp).toBe(80);
    });

    test('rejects partial success when the normal executor reports any errors', async () => {
        const variables = createVariables({ hp: 72 });
        const result = await validateIncrementalRepairAgainstState(
            '<JSONPatch>[{"op":"replace","path":"/missing","value":1},{"op":"replace","path":"/other","value":2},{"op":"replace","path":"/hp","value":80}]</JSONPatch>',
            variables
        );
        expect(result).toContain('missing');
        expect(result).toContain('other');
        expect(variables.stat_data).toEqual({ hp: 72 });
        expect(toastr.warning).not.toHaveBeenCalled();
    });

    test('rejects MVU Zod errors even when native commands change a variable', async () => {
        eventOn(
            variable_events.COMMAND_PARSED + '_for_zod',
            (_variables, _commands, _content, onError) => {
                onError('Zod validation failed');
            }
        );
        await expect(
            validateIncrementalRepairAgainstState(patch, createVariables({ hp: 72 }))
        ).resolves.toBe('Zod validation failed');
        expect(toastr.warning).not.toHaveBeenCalled();
    });

    test.each([
        '<JSONPatch>[]</JSONPatch>',
        '<JSONPatch>[{"op":"replace","path":"/hp","value":72}]</JSONPatch>',
    ])('rejects a result with no actual variable change: %s', async block => {
        await expect(
            validateIncrementalRepairAgainstState(block, createVariables({ hp: 72 }))
        ).resolves.toContain('没有产生实际变化');
    });

    test('lets the current schema reject inserts that the hand-written state check accepted', async () => {
        const variables = createVariables({ hp: 72 });
        variables.schema.extensible = false;
        const result = await validateIncrementalRepairAgainstState(
            '<JSONPatch>[{"op":"insert","path":"/newKey","value":1}]</JSONPatch>',
            variables
        );
        expect(result).toContain('newKey');
        expect(variables.stat_data).toEqual({ hp: 72 });
        expect(toastr.warning).not.toHaveBeenCalled();
    });

    test('awaits variable-context callbacks before deciding whether anything changed', async () => {
        eventOn(variable_events.VARIABLE_UPDATE_ENDED, async variables => {
            await Promise.resolve();
            variables.stat_data.hp = 72;
        });
        await expect(
            validateIncrementalRepairAgainstState(patch, createVariables({ hp: 72 }))
        ).resolves.toContain('没有产生实际变化');
    });
});
