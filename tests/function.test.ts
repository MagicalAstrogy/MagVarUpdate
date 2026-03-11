import {
    handleVariablesInMessage,
    pathFix,
    updateVariables,
    trimQuotesAndBackslashes,
    parseParameters,
} from '@/function/update_variables';
import { getLastValidVariable } from '@/util';
import { useDataStore } from '@/store';
import { assertVWD, VariableData } from '@/variable_def';
import _ from 'lodash';
import { handleVariablesInCallback } from '@/function/exported_events';

type MvuData = any;

describe('parseParameters', () => {
    describe('基本参数解析', () => {
        test('解析简单双引号字符串参数', () => {
            const result = parseParameters('"path", "oldValue", "newValue"');
            expect(result).toEqual(['"path"', '"oldValue"', '"newValue"']);
        });

        test('解析单引号参数', () => {
            const result = parseParameters("'path', 'oldValue', 'newValue'");
            expect(result).toEqual(["'path'", "'oldValue'", "'newValue'"]);
        });

        test('解析混合引号参数', () => {
            const result = parseParameters('"path", \'oldValue\', "newValue"');
            expect(result).toEqual(['"path"', "'oldValue'", '"newValue"']);
        });

        test('处理无引号参数', () => {
            const result = parseParameters('path, 123, true');
            expect(result).toEqual(['path', '123', 'true']);
        });

        test('处理仅两个参数的情况', () => {
            const result = parseParameters('"path", "value"');
            expect(result).toEqual(['"path"', '"value"']);
        });
    });

    describe('复杂参数解析', () => {
        test('处理引号内包含逗号的参数', () => {
            const result = parseParameters('"path.to.item", "hello, world", "new value"');
            expect(result).toEqual(['"path.to.item"', '"hello, world"', '"new value"']);
        });

        test('处理转义引号', () => {
            const result = parseParameters('"path", "value with \\"quotes\\"", "newValue"');
            expect(result).toEqual(['"path"', '"value with \\"quotes\\""', '"newValue"']);
        });

        test('处理数组参数', () => {
            const result = parseParameters('"scores", [90, 85, 92], [95, 88, 94]');
            expect(result).toEqual(['"scores"', '[90, 85, 92]', '[95, 88, 94]']);
        });

        test('处理嵌套数组', () => {
            const result = parseParameters('"matrix", [[1, 2], [3, 4]], [[5, 6], [7, 8]]');
            expect(result).toEqual(['"matrix"', '[[1, 2], [3, 4]]', '[[5, 6], [7, 8]]']);
        });

        test('处理对象参数', () => {
            const result = parseParameters(
                '"user", {name: "John", age: 30}, {name: "Jane", age: 25}'
            );
            expect(result).toEqual([
                '"user"',
                '{name: "John", age: 30}',
                '{name: "Jane", age: 25}',
            ]);
        });

        test('处理嵌套对象', () => {
            const result = parseParameters(
                '"config", {db: {host: "localhost"}}, {db: {host: "server"}}'
            );
            expect(result).toEqual([
                '"config"',
                '{db: {host: "localhost"}}',
                '{db: {host: "server"}}',
            ]);
        });

        test('处理对象数组混合', () => {
            const result = parseParameters(
                '"data", [{id: 1, values: [1, 2]}, {id: 2, values: [3, 4]}], "newData"'
            );
            expect(result).toEqual([
                '"data"',
                '[{id: 1, values: [1, 2]}, {id: 2, values: [3, 4]}]',
                '"newData"',
            ]);
        });
    });

    describe('pathFix', () => {
        test('baseline: keep correct path unchanged', () => {
            const input = `测试员.物品&装备.武器栏[衔尾蛇OICW原型].弹药系统["7.62mm ETC弹匣"].载弹量`;
            const out = pathFix(input);
            expect(out).toEqual(input);
        });

        // ----------------------------------------------------------------------
        // 点分字段（.xxx）去掉外层引号
        // ----------------------------------------------------------------------
        test('dot segment: remove extra quotes on simple identifier', () => {
            expect(pathFix(`foo."bar".baz`)).toBe(`foo.bar.baz`);

            expect(pathFix(`foo.'bar'.baz`)).toBe(`foo.bar.baz`);
        });

        test('dot segment: quoted segment with whitespace becomes bracket string', () => {
            expect(pathFix(`foo."a b".c`)).toBe(`foo["a b"].c`);

            expect(pathFix(`root.'字段 名'.子`)).toBe(`root["字段 名"].子`);
        });

        // ----------------------------------------------------------------------
        // [] 数字索引
        // ----------------------------------------------------------------------
        test('bracket: numeric index - pure number without quotes', () => {
            expect(pathFix(`foo[0]`)).toBe(`foo[0]`);
            expect(pathFix(`foo[  12  ]`)).toBe(`foo[12]`);
            expect(pathFix(`foo[000]`)).toBe(`foo[000]`);
        });

        test('bracket: numeric string with quotes should NOT be treated as index', () => {
            expect(pathFix(`foo["0"]`)).toBe(`foo["0"]`); // 当前规则：内外引号剥掉 → 纯数字
            expect(pathFix(`foo['123']`)).toBe(`foo["123"]`);
        });

        // ----------------------------------------------------------------------
        // [] 字符串 key：无空白 → 使用裸形式
        // ----------------------------------------------------------------------
        test('bracket string: simple identifier without whitespace kept bare', () => {
            expect(pathFix(`武器栏[衔尾蛇]`)).toBe(`武器栏[衔尾蛇]`);
            expect(pathFix(`武器栏["衔尾蛇"]`)).toBe(`武器栏[衔尾蛇]`);
            expect(pathFix(`武器栏['衔尾蛇']`)).toBe(`武器栏[衔尾蛇]`);
        });

        // ----------------------------------------------------------------------
        // [] 字符串 key：含空白 → 强制 ["..."]
        // ----------------------------------------------------------------------
        test('bracket string: whitespace forces quoted form', () => {
            expect(pathFix(`foo[hello world]`)).toBe(`foo["hello world"]`);

            expect(pathFix(`foo["hello world"]`)).toBe(`foo["hello world"]`);

            expect(pathFix(`foo['hello world']`)).toBe(`foo["hello world"]`);
        });

        test('bracket string: internal whitespace with Chinese', () => {
            expect(pathFix(`弹药系统[7.62mm ETC弹匣]`)).toBe(`弹药系统["7.62mm ETC弹匣"]`);
        });

        // ----------------------------------------------------------------------
        // Escape 双引号
        // ----------------------------------------------------------------------
        test('bracket string: escape double quotes inside string', () => {
            const input = 'foo[a"b c]';
            const result = pathFix(input);

            // 实际字符串是：foo["a\"b c"]
            expect(result).toBe('foo["a\\"b c"]');
        });

        test('bracket string: backslash is kept as-is, only double quotes are escaped', () => {
            const input = 'foo[a\\b c]'; // 实际内容 a\b c
            const result = pathFix(input);

            // 输出应是 foo["a\b c"]，在 TS 字符串里写成：
            expect(result).toBe('foo["a\\b c"]');
        });

        test('bracket string: escape double quotes from unquoted input', () => {
            expect(pathFix(`foo[a"b c]`)).toBe(`foo["a\\"b c"]`);
        });

        // ----------------------------------------------------------------------
        // 空 bracket + trim
        // ----------------------------------------------------------------------
        test('empty or whitespace-only bracket', () => {
            expect(pathFix(`foo[]`)).toBe(`foo[]`);
            expect(pathFix(`foo[   ]`)).toBe(`foo[]`);
        });

        // ----------------------------------------------------------------------
        // 多层嵌套
        // ----------------------------------------------------------------------
        test('multiple brackets chain', () => {
            expect(pathFix(`root.a["x y"][0]['z z']`)).toBe(`root.a["x y"][0]["z z"]`);
        });

        // ----------------------------------------------------------------------
        // 前后空白
        // ----------------------------------------------------------------------
        test('trim inside brackets', () => {
            expect(pathFix(`foo[   abc   ]`)).toBe(`foo[abc]`);

            expect(pathFix(`foo[   a b   ]`)).toBe(`foo["a b"]`);
        });

        // ----------------------------------------------------------------------
        // 混合复杂场景
        // ----------------------------------------------------------------------
        test('complex: Chinese, digits, whitespace, quoted-dot segment', () => {
            const input = `测试员."物品&装备".武器栏[衔尾蛇OICW原型].弹药系统[ 7.62mm ETC弹匣 ].载弹量`;
            const result = pathFix(input);

            expect(result).toBe(
                `测试员.物品&装备.武器栏[衔尾蛇OICW原型].弹药系统["7.62mm ETC弹匣"].载弹量`
            );
        });

        // ----------------------------------------------------------------------
        // 特殊字符 escape，比如反斜杠、双引号交替出现
        // ----------------------------------------------------------------------

        test('escape: multiple internal quotes', () => {
            expect(pathFix(`foo[a"b"c d]`)).toBe(`foo["a\\"b\\"c d"]`);
        });
    });

    describe('边界情况', () => {
        test('处理空字符串', () => {
            const result = parseParameters('');
            expect(result).toEqual([]);
        });

        test('处理单个参数', () => {
            const result = parseParameters('"onlyOne"');
            expect(result).toEqual(['"onlyOne"']);
        });

        test('处理参数周围的空格', () => {
            const result = parseParameters('  "path"  ,  "oldValue"  ,  "newValue"  ');
            expect(result).toEqual(['"path"', '"oldValue"', '"newValue"']);
        });

        test('处理参数中的换行符', () => {
            const result = parseParameters('"path",\n"oldValue",\n"newValue"');
            expect(result).toEqual(['"path"', '"oldValue"', '"newValue"']);
        });

        test('处理混合数据类型', () => {
            const result = parseParameters('"path", 123, true, null, [1, 2, 3], {key: "value"}');
            expect(result).toEqual([
                '"path"',
                '123',
                'true',
                'null',
                '[1, 2, 3]',
                '{key: "value"}',
            ]);
        });

        test('处理仅逗号分隔', () => {
            const result = parseParameters(',,,');
            expect(result).toEqual(['', '', '']);
        });

        test('处理末尾逗号', () => {
            const result = parseParameters('"a", "b", "c",');
            expect(result).toEqual(['"a"', '"b"', '"c"']);
        });
    });

    describe('实际使用场景', () => {
        test('解析时间更新（两个参数）', () => {
            const result = parseParameters('\'时间\', "09:15"');
            expect(result).toEqual(["'时间'", '"09:15"']);
        });

        test('解析地点更新（两个参数）', () => {
            const result = parseParameters('\'地点\', "朝槿咖啡店"');
            expect(result).toEqual(["'地点'", '"朝槿咖啡店"']);
        });

        test('解析状态数据路径（三个参数）', () => {
            const result = parseParameters('"stat_data.health", 100, 85');
            expect(result).toEqual(['"stat_data.health"', '100', '85']);
        });

        test('处理带点号的复杂路径', () => {
            const result = parseParameters('"characters[0].stats.level", 5, 6');
            expect(result).toEqual(['"characters[0].stats.level"', '5', '6']);
        });

        test('处理中文字符', () => {
            const result = parseParameters('"角色.属性.等级", "初级", "中级"');
            expect(result).toEqual(['"角色.属性.等级"', '"初级"', '"中级"']);
        });

        test('处理JSON字符串作为值', () => {
            const result = parseParameters(
                '"config", "{\\"theme\\":\\"dark\\",\\"lang\\":\\"zh\\"}", "{\\"theme\\":\\"light\\",\\"lang\\":\\"en\\"}"'
            );
            expect(result).toEqual([
                '"config"',
                '"{\\"theme\\":\\"dark\\",\\"lang\\":\\"zh\\"}"',
                '"{\\"theme\\":\\"light\\",\\"lang\\":\\"en\\"}"',
            ]);
        });
        test('实际场景', () => {
            const input = `'悠纪.想对user说的事', ["与希雅 在一起时，会邀请希雅做一些事情，是 出去喝一杯咖啡，接下来设置变量\\"_.set('当前事件',null,'yuki_relation_level1');//邀请希雅\\"，然后断章。"], []`;
            const result = parseParameters(input);
            expect(result).toHaveLength(3);
        });
    });

    describe('特殊字符处理', () => {
        test('处理路径中的特殊字符', () => {
            const result = parseParameters(
                '"path/to/file", "value\\nwith\\nnewlines", "tab\\tcharacter"'
            );
            expect(result).toEqual([
                '"path/to/file"',
                '"value\\nwith\\nnewlines"',
                '"tab\\tcharacter"',
            ]);
        });

        test('处理Unicode字符', () => {
            const result = parseParameters('"emoji", "😀", "😎"');
            expect(result).toEqual(['"emoji"', '"😀"', '"😎"']);
        });

        test('处理反斜杠', () => {
            const result = parseParameters('"path", "C:\\\\Users\\\\file", "D:\\\\Data\\\\file"');
            expect(result).toEqual(['"path"', '"C:\\\\Users\\\\file"', '"D:\\\\Data\\\\file"']);
        });
    });
});

describe('trimQuotesAndBackslashes', () => {
    test('移除双引号', () => {
        expect(trimQuotesAndBackslashes('"hello"')).toBe('hello');
    });

    test('移除单引号', () => {
        expect(trimQuotesAndBackslashes("'hello'")).toBe('hello');
    });

    test('移除反斜杠和引号', () => {
        expect(trimQuotesAndBackslashes('\\"hello\\"')).toBe('hello');
    });

    test('处理无引号字符串', () => {
        expect(trimQuotesAndBackslashes('hello')).toBe('hello');
    });

    test('移除空格和引号', () => {
        expect(trimQuotesAndBackslashes(' "hello" ')).toBe('hello');
    });

    test('保留内部引号', () => {
        expect(trimQuotesAndBackslashes('"hello \\"world\\""')).toBe('hello \\"world');
    });

    test('处理空字符串', () => {
        expect(trimQuotesAndBackslashes('')).toBe('');
    });

    test('处理混合边界引号', () => {
        expect(trimQuotesAndBackslashes('"hello\'')).toBe('hello');
    });

    test('处理多重引号', () => {
        expect(trimQuotesAndBackslashes('""hello""')).toBe('hello');
    });

    test('处理仅空格', () => {
        expect(trimQuotesAndBackslashes('   ')).toBe('');
    });
});

const mockSchema = { type: 'object', properties: {} };
describe('getLastValidVariable', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (globalThis as any)._ = _;
    });

    test('应该返回最后一个有效的变量（包含stat_data）', async () => {
        const mockChat = [
            {
                swipe_id: 0,
                variables: [
                    {
                        stat_data: { health: 100 },
                        display_data: {},
                        delta_data: {},
                        schema: mockSchema,
                    },
                ],
            },
            {
                swipe_id: 0,
                variables: [
                    {
                        display_data: {},
                        delta_data: {},
                    },
                ],
            },
            {
                swipe_id: 0,
                variables: [
                    {
                        stat_data: { health: 80 },
                        display_data: {},
                        delta_data: {},
                        schema: mockSchema,
                    },
                ],
            },
        ];

        (globalThis as any).SillyTavern = { chat: mockChat };
        (globalThis as any).getVariables = jest.fn();

        const result = await getLastValidVariable(3);

        expect(result).toMatchObject({
            stat_data: { health: 80 },
            display_data: {},
            delta_data: {},
        });
    });

    test('对于带有swipe_id的消息，需要检查对应的swipe并酌情跳过', async () => {
        const mockChat = [
            {
                swipe_id: 0,
                variables: [
                    {
                        stat_data: { health: 100 },
                        display_data: {},
                        schema: mockSchema,
                    },
                ],
            },
            {
                // 第一个 swipe 没有数据
                swipe_id: 1,
                variables: [{ stat_data: { mana: 50 }, display_data: {} }, { display_data: {} }],
            },
        ];

        (globalThis as any).SillyTavern = { chat: mockChat };
        (globalThis as any).getVariables = jest.fn();

        const result = await getLastValidVariable(1);

        expect(result).toMatchObject({
            stat_data: { health: 100 },
            display_data: {},
        });
    });

    test('对于带有swipe_id的消息，需要用到正确swipe 的数据', async () => {
        const mockChat = [
            {
                swipe_id: 0,
                variables: [
                    {
                        stat_data: { health: 100 },
                        display_data: {},
                        schema: mockSchema,
                    },
                ],
            },
            {
                // 第一个 swipe 没有数据
                swipe_id: 1,
                variables: [
                    { display_data: {} },
                    { stat_data: { mana: 50 }, display_data: {}, schema: mockSchema },
                ],
            },
        ];

        (globalThis as any).SillyTavern = { chat: mockChat };
        (globalThis as any).getVariables = jest.fn();

        const result = await getLastValidVariable(2);

        expect(result).toMatchObject({
            stat_data: { mana: 50 },
            display_data: {},
        });
    });

    test('当没有找到有效变量时应该返回 undefined', async () => {
        const mockChat = [
            {
                swipe_id: 0,
                variables: [
                    {
                        display_data: {},
                        delta_data: {},
                    },
                ],
            },
            {
                swipe_id: 0,
                variables: [
                    {
                        display_data: {},
                    },
                ],
            },
        ];

        (globalThis as any).SillyTavern = { chat: mockChat };
        (globalThis as any).getVariables = jest.fn();

        const result = await getLastValidVariable(1);

        expect(result).toBeUndefined();
        expect((globalThis as any).getVariables).not.toHaveBeenCalled();
    });

    test('应该正确处理message_id边界', async () => {
        const mockChat = [
            {
                swipe_id: 0,
                variables: [
                    {
                        stat_data: { level: 1 },
                        display_data: {},
                        schema: mockSchema,
                    },
                ],
            },
            {
                swipe_id: 0,
                variables: [
                    {
                        stat_data: { level: 2 },
                        display_data: {},
                        schema: mockSchema,
                    },
                ],
            },
            {
                swipe_id: 0,
                variables: [
                    {
                        stat_data: { level: 3 },
                        display_data: {},
                        schema: mockSchema,
                    },
                ],
            },
        ];

        (globalThis as any).SillyTavern = { chat: mockChat };
        (globalThis as any).getVariables = jest.fn();

        // end_message_id=2 时，检查 [0, 2) 区间
        const result = await getLastValidVariable(2);

        expect(result).toMatchObject({
            stat_data: { level: 2 },
            display_data: {},
        });
    });

    test('应该处理空聊天记录并返回 undefined', async () => {
        (globalThis as any).SillyTavern = { chat: [] };
        (globalThis as any).getVariables = jest.fn();

        const result = await getLastValidVariable(0);

        expect(result).toBeUndefined();
        expect((globalThis as any).getVariables).not.toHaveBeenCalled();
    });

    test('应该正确处理undefined和null的variables', async () => {
        const mockChat = [
            {
                swipe_id: 0,
                variables: [
                    {
                        stat_data: { valid: true },
                        display_data: {},
                        schema: mockSchema,
                    },
                ],
            },
            {
                swipe_id: 0,
                variables: undefined,
            },
            {
                swipe_id: 0,
                variables: null,
            },
        ];

        (globalThis as any).SillyTavern = { chat: mockChat };
        (globalThis as any).getVariables = jest.fn();

        const result = await getLastValidVariable(2);

        expect(result).toMatchObject({
            stat_data: { valid: true },
            display_data: {},
        });
    });

    test('应该使用structuredClone深拷贝结果', async () => {
        const originalVariable = {
            stat_data: { health: 100, items: ['sword', 'shield'] },
            display_data: {},
            delta_data: {},
            schema: mockSchema,
        };

        const mockChat = [
            {
                swipe_id: 0,
                variables: [originalVariable],
            },
        ];

        (globalThis as any).SillyTavern = { chat: mockChat };
        (globalThis as any).getVariables = jest.fn();

        const result = await getLastValidVariable(1);

        // 验证是深拷贝
        expect(result).toEqual(originalVariable);
        expect(result).not.toBe(originalVariable);
        expect(result!.stat_data).not.toBe(originalVariable.stat_data);
        expect(result!.stat_data.items).not.toBe(originalVariable.stat_data.items);
    });
});

describe('updateVariables', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (globalThis as any)._ = _;
        (globalThis as any).YAML = { parse: JSON.parse };
        (globalThis as any).eventEmit = jest.fn().mockResolvedValue(undefined);
    });

    test('应该更新变量并保留原始变量结构', async () => {
        const variables: MvuData = {
            stat_data: {
                health: 100,
                mana: 50,
                level: 5,
            },
            display_data: {},
            delta_data: {},
            initialized_lorebooks: { book1: [], book2: [] },
        };

        const messageContent = "_.set('health', 100, 80);//受到伤害";

        const result = await updateVariables(messageContent, variables);

        expect(result).toBe(true);
        expect(variables.stat_data.health).toBe(80);
        expect(variables.stat_data.mana).toBe(50);
        expect(variables.stat_data.level).toBe(5);
        expect((variables.display_data as any)['health']).toBe('100->80 (受到伤害)');
        expect((variables.delta_data as any)['health']).toBe('100->80 (受到伤害)');
    });

    test('应该处理多个变量更新', async () => {
        const variables: MvuData = {
            stat_data: {
                health: 100,
                mana: 50,
            },
            display_data: {},
            delta_data: {},
            initialized_lorebooks: {},
        };

        const messageContent = `
            _.set('health', 100, 90);//战斗伤害
            _.set('mana', 50, 30);//施法消耗
        `;

        const result = await updateVariables(messageContent, variables);

        expect(result).toBe(true);
        expect(variables.stat_data.health).toBe(90);
        expect(variables.stat_data.mana).toBe(30);
    });
});

describe('handleVariablesInMessage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (globalThis as any)._ = _;
        (globalThis as any).YAML = { parse: JSON.parse };
        (globalThis as any).eventEmit = jest.fn().mockResolvedValue(undefined);
        (globalThis as any).replaceVariables = jest.fn().mockResolvedValue(undefined);
        (globalThis as any).insertOrAssignVariables = jest.fn().mockResolvedValue(undefined);
        (globalThis as any).updateVariablesWith = jest.fn().mockResolvedValue(undefined);
        (globalThis as any).setChatMessages = jest.fn().mockResolvedValue(undefined);
    });

    test('应该保留chat级别变量的其他属性，只更新必要的字段', async () => {
        //这个用例同时会测试更新到聊天变量的有效性，下面预期同时更新楼层和聊天变量。
        useDataStore().settings.兼容性.更新到聊天变量 = true;

        const mockChatVariables = {
            stat_data: { health: 100, mana: 50 },
            display_data: {},
            delta_data: {},
            initialized_lorebooks: ['book1'],
            custom_field: 'should_be_preserved',
            another_field: { nested: 'data' },
        };

        const mockMessageVariables = {
            stat_data: { health: 100, mana: 50 },
            display_data: { health: '100->80 (受到伤害)' },
            delta_data: { stat_data: { health: '100->80 (受到伤害)' } },
            initialized_lorebooks: ['book1', 'book2'],
            schema: mockSchema,
        };

        (globalThis as any).getChatMessages = jest.fn().mockReturnValue([
            {
                message: "_.set('health', 100, 80);//受到伤害",
                role: 'assistant',
            },
        ]);

        (globalThis as any).SillyTavern = {
            chat: [
                {
                    swipe_id: 0,
                    variables: [mockMessageVariables],
                },
            ],
        };

        (globalThis as any).getVariables = jest.fn().mockImplementation(options => {
            if (options?.type === 'chat') {
                return _.cloneDeep(mockChatVariables);
            }
            return _.cloneDeep(mockMessageVariables);
        });
        expect((globalThis as any).replaceVariables).toHaveBeenCalledTimes(0);

        await handleVariablesInMessage(0);

        expect((globalThis as any).replaceVariables).toHaveBeenCalledTimes(0);
        expect((globalThis as any).updateVariablesWith).toHaveBeenCalledTimes(2);

        // 验证 chat 级别的变量更新
        const chatUpdateCall = (globalThis as any).updateVariablesWith.mock.calls[0];
        const updater = chatUpdateCall[0];
        const updatedChatVariables = updater(structuredClone(mockChatVariables));
        const chatUpdateOptions = chatUpdateCall[1];

        expect(chatUpdateOptions).toEqual({ type: 'chat' });

        // 验证只更新了必要的字段
        expect(updatedChatVariables.stat_data).toEqual({ health: 80, mana: 50 });
        expect(updatedChatVariables.display_data).toEqual({
            health: '100->80 (受到伤害)',
            mana: 50,
        });
        expect(updatedChatVariables.delta_data).toEqual({ health: '100->80 (受到伤害)' });
        expect(updatedChatVariables.initialized_lorebooks).toEqual(['book1', 'book2']);

        // 验证保留了其他自定义字段
        expect(updatedChatVariables.custom_field).toBe('should_be_preserved');
        expect(updatedChatVariables.another_field).toEqual({ nested: 'data' });

        // 验证 message 级别的变量更新
        const messageUpdateCall = (globalThis as any).updateVariablesWith.mock.calls[1];
        const messageUpdateOptions = messageUpdateCall[1];
        expect(messageUpdateOptions).toEqual({ type: 'message', message_id: 0 });
    });

    test('覆盖消息级别变量', async () => {
        //这个用例同时会测试更新到聊天变量的有效性，下面预期只会更新楼层变量。也就是默认行为
        useDataStore().settings.兼容性.更新到聊天变量 = false;

        // 模拟消息已有的变量（之前的状态）
        const existingMessageVariables = {
            stat_data: {
                health: 100,
                mana: 50,
                stamina: 30, // 这个值应该被保留
                level: 5, // 这个值应该被保留
            },
            display_data: {
                stamina: '40->30 (之前的更新)', // 应该被保留
                level: '4->5 (升级)', // 应该被保留
            },
            delta_data: {
                stamina: '40->30 (之前的更新)', // 应该被保留
                level: '4->5 (升级)', // 应该被保留
            },
            initialized_lorebooks: ['book1'],
            custom_message_field: 'message_specific', // 消息特有的字段，应该被保留
            schema: mockSchema,
        };

        const mockChatVariables = {
            stat_data: { health: 100, mana: 50, stamina: 30, level: 5 },
            display_data: {},
            delta_data: {},
            initialized_lorebooks: ['book1'],
            custom_field: 'should_be_preserved',
        };

        (globalThis as any).getChatMessages = jest.fn().mockReturnValue([
            {
                message: "_.set('health', 100, 80);//受到伤害\n_.set('mana', 50, 30);//施法消耗",
                role: 'assistant',
            },
        ]);

        (globalThis as any).SillyTavern = {
            chat: [
                {
                    swipe_id: 0,
                    variables: [existingMessageVariables],
                },
            ],
        };

        (globalThis as any).getVariables = jest.fn().mockImplementation(options => {
            if (options?.type === 'chat') {
                return _.cloneDeep(mockChatVariables);
            }
            return _.cloneDeep(existingMessageVariables);
        });

        await handleVariablesInMessage(0);

        expect((globalThis as any).updateVariablesWith).toHaveBeenCalledTimes(1);

        const messageUpdateCall = (globalThis as any).updateVariablesWith.mock.calls[0];
        const updater = messageUpdateCall[0];
        const updatedMessageVariables = updater(existingMessageVariables);
        const messageUpdateOptions = messageUpdateCall[1];

        expect(messageUpdateOptions).toEqual({ type: 'message', message_id: 0 });

        // 验证新的更新被应用
        expect(updatedMessageVariables.stat_data.health).toBe(80); // 新更新
        expect(updatedMessageVariables.stat_data.mana).toBe(30); // 新更新

        // 验证原有的值被保留（这是合并的关键测试）
        expect(updatedMessageVariables.stat_data.stamina).toBe(30); // 保留原值
        expect(updatedMessageVariables.stat_data.level).toBe(5); // 保留原值

        // 验证 display_data 包含新更新
        expect(updatedMessageVariables.display_data.health).toBe('100->80 (受到伤害)'); // 新
        expect(updatedMessageVariables.display_data.mana).toBe('50->30 (施法消耗)'); // 新
        expect(updatedMessageVariables.display_data.stamina).toBe(30); // 保留
        expect(updatedMessageVariables.display_data.level).toBe(5); // 保留

        // 验证 delta_data 只包含本次更新
        expect(updatedMessageVariables.delta_data.health).toBe('100->80 (受到伤害)');
        expect(updatedMessageVariables.delta_data.mana).toBe('50->30 (施法消耗)');
        // delta_data 是本次更新的增量，不应包含之前的更新
        expect(updatedMessageVariables.delta_data.stamina).toBeUndefined();
        expect(updatedMessageVariables.delta_data.level).toBeUndefined();

        expect(updatedMessageVariables.initialized_lorebooks).toEqual(['book1']); // 更新后的值
    });

    test('当没有变量修改时不应该更新chat级别变量', async () => {
        (globalThis as any).getChatMessages = jest.fn().mockReturnValue([
            {
                message: '这是一段没有变量更新的文本',
                role: 'assistant',
            },
        ]);

        (globalThis as any).SillyTavern = {
            chat: [
                {
                    swipe_id: 0,
                    variables: [
                        {
                            stat_data: { health: 100 },
                            display_data: {},
                            delta_data: {},
                            schema: mockSchema,
                        },
                    ],
                },
            ],
        };

        (globalThis as any).getVariables = jest.fn().mockReturnValue({
            stat_data: { health: 100 },
            display_data: {},
            delta_data: {},
        });

        await handleVariablesInMessage(0);

        // 验证只调用了一次 insertOrAssignVariables (仅 message 级别)
        expect((globalThis as any).updateVariablesWith).toHaveBeenCalledTimes(1);

        const call = (globalThis as any).updateVariablesWith.mock.calls[0];
        expect(call[1]).toEqual({ type: 'message', message_id: 0 });

        // 验证没有调用 getVariables 获取 chat 级别变量
        expect((globalThis as any).getVariables).not.toHaveBeenCalledWith({ type: 'chat' });
    });
});

describe('invokeVariableTest', () => {
    test('should update variable value', async () => {
        const inputData: VariableData = {
            old_variables: {
                initialized_lorebooks: {},
                stat_data: { 喵呜: 20 },
                display_data: {},
                delta_data: {},
                schema: { type: 'object', properties: { 喵呜: { type: 'number' } } },
            },
        };
        await handleVariablesInCallback("_.set('喵呜', 114);//测试", inputData);
        expect(inputData.new_variables).not.toBeUndefined();
        expect(inputData.new_variables!.stat_data.喵呜).toBe(114);
        expect(inputData.old_variables.stat_data.喵呜).toBe(20);
    });
    test('expect not updated', async () => {
        const inputData: VariableData = {
            old_variables: {
                initialized_lorebooks: {},
                stat_data: { 喵呜: 20 },
                display_data: {},
                delta_data: {},
                schema: { type: 'object', properties: { 喵呜: { type: 'number' } } },
            },
        };
        await handleVariablesInCallback('这是一个没有更新的文本。明天见是最好的预言。', inputData);
        //现在会始终产生了。
        expect(inputData.new_variables).toBeDefined();
    });
});

describe('strictSet feature', () => {
    test('strictSet=false 应该处理 ValueWithDescription 类型（默认行为）', async () => {
        const variables: MvuData = {
            stat_data: {
                health: [100, '生命值'],
                mana: [50, '魔力值'],
            },
            display_data: {},
            delta_data: {},
            initialized_lorebooks: {},
            schema: {
                type: 'object',
                strictSet: false, // 显式设置为 false（默认值）
                properties: {},
            },
        };

        const messageContent = "_.set('health', 80);//受到伤害";
        const result = await updateVariables(messageContent, variables);

        expect(result).toBe(true);
        // strictSet=false 时，只更新数组的第一个元素
        expect(variables.stat_data.health).toEqual([80, '生命值']);
        expect((variables.display_data as any)['health']).toBe('100->80 (受到伤害)');
    });

    test('strictSet=true 应该直接替换整个值', async () => {
        const variables: MvuData = {
            stat_data: {
                health: [100, '生命值'],
                mana: [50, '魔力值'],
            },
            display_data: {},
            delta_data: {},
            initialized_lorebooks: {},
            schema: {
                type: 'object',
                strictSet: true, // 启用严格设置模式
                properties: {},
            },
        };

        const messageContent = "_.set('health', [140, '生命值喵']);//受到伤害";
        const result = await updateVariables(messageContent, variables);

        expect(result).toBe(true);
        // strictSet=true 时，直接替换整个值
        assertVWD(true, variables.stat_data.health);
        expect(variables.stat_data.health[0]).toBe(140);
        expect(variables.stat_data.health[1]).toBe('生命值喵');
    });

    test('strictSet=true 应该允许替换整个数组', async () => {
        const variables: MvuData = {
            stat_data: {
                items: [10, '物品数量'],
            },
            display_data: {},
            delta_data: {},
            initialized_lorebooks: {},
            schema: {
                type: 'object',
                strictSet: true,
                properties: {},
            },
        };

        const messageContent =
            "_.set('items', [10, '物品数量'], [15, '增强的物品数量']);//升级物品";
        const result = await updateVariables(messageContent, variables);

        expect(result).toBe(true);
        // strictSet=true 时，可以替换为新的数组
        expect(variables.stat_data.items).toEqual([15, '增强的物品数量']);
        expect((variables.display_data as any)['items']).toBe(
            '[10,"物品数量"]->[15,"增强的物品数量"] (升级物品)'
        );
    });

    test('strictSet 从 $meta 读取配置', async () => {
        const variables: MvuData = {
            stat_data: {
                $meta: {
                    strictSet: true,
                },
                level: [5, '等级描述'],
            },
            display_data: {},
            delta_data: {},
            initialized_lorebooks: {},
        };
        //因为从$schema 的移动是在 updateVariable 的结尾进行的，所以当次不会奏效
        //对应于实际场景，就是 initVar。
        {
            const messageContent = "_.set('level[0]', 6);//升级";
            const result = await updateVariables(messageContent, variables);
            expect(result).toBe(true);
        }

        {
            const messageContent = "_.set('level', [5, '等级描述'], 6);//升级";
            const result = await updateVariables(messageContent, variables);
            expect(result).toBe(true);
        }
        // 从 $meta 读取的 strictSet=true，直接替换
        expect(variables.stat_data.level).toEqual(6);
    });

    test('strictSet=false 保持数组描述不变', async () => {
        const variables: MvuData = {
            stat_data: {
                relationship: [75, '与角色的关系等级'],
            },
            display_data: {},
            delta_data: {},
            initialized_lorebooks: {},
            schema: {
                type: 'object',
                strictSet: false,
                properties: {},
            },
        };

        const messageContent = "_.set('relationship', [75, '与角色的关系等级'], 85);//关系改善";
        const result = await updateVariables(messageContent, variables);

        expect(result).toBe(true);
        // strictSet=false 时，保持描述不变，只更新值
        expect(variables.stat_data.relationship).toEqual([85, '与角色的关系等级']);
        expect((variables.display_data as any)['relationship']).toBe('75->85 (关系改善)');
    });
});
