import {handleVariablesInCallback, parseParameters, trimQuotesAndBackslashes, getLastValidVariable, updateVariables, handleVariablesInMessage} from '@/function';
import {VariableData} from "@/variable_def";
import {variable_events} from '@/variable_def';
import _ from 'lodash';

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
            const result = parseParameters('"user", {name: "John", age: 30}, {name: "Jane", age: 25}');
            expect(result).toEqual(['"user"', '{name: "John", age: 30}', '{name: "Jane", age: 25}']);
        });

        test('处理嵌套对象', () => {
            const result = parseParameters('"config", {db: {host: "localhost"}}, {db: {host: "server"}}');
            expect(result).toEqual(['"config"', '{db: {host: "localhost"}}', '{db: {host: "server"}}']);
        });

        test('处理对象数组混合', () => {
            const result = parseParameters('"data", [{id: 1, values: [1, 2]}, {id: 2, values: [3, 4]}], "newData"');
            expect(result).toEqual(['"data"', '[{id: 1, values: [1, 2]}, {id: 2, values: [3, 4]}]', '"newData"']);
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
            expect(result).toEqual(['"path"', '123', 'true', 'null', '[1, 2, 3]', '{key: "value"}']);
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
            const result = parseParameters("'时间', \"09:15\"");
            expect(result).toEqual(["'时间'", '"09:15"']);
        });

        test('解析地点更新（两个参数）', () => {
            const result = parseParameters("'地点', \"朝槿咖啡店\"");
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
            const result = parseParameters('"config", "{\\"theme\\":\\"dark\\",\\"lang\\":\\"zh\\"}", "{\\"theme\\":\\"light\\",\\"lang\\":\\"en\\"}"');
            expect(result).toEqual(['"config"', '"{\\"theme\\":\\"dark\\",\\"lang\\":\\"zh\\"}"', '"{\\"theme\\":\\"light\\",\\"lang\\":\\"en\\"}"']);
        });
        test('实际场景', () => {
            const input = `'悠纪.想对user说的事', ["与希雅 在一起时，会邀请希雅做一些事情，是 出去喝一杯咖啡，接下来设置变量\\"_.set('当前事件',null,'yuki_relation_level1');//邀请希雅\\"，然后断章。"], []`;
            const result = parseParameters(input);
            expect(result).toHaveLength(3);
        });
    });

    describe('特殊字符处理', () => {
        test('处理路径中的特殊字符', () => {
            const result = parseParameters('"path/to/file", "value\\nwith\\nnewlines", "tab\\tcharacter"');
            expect(result).toEqual(['"path/to/file"', '"value\\nwith\\nnewlines"', '"tab\\tcharacter"']);
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

describe('getLastValidVariable', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (globalThis as any)._ = _;
    });

    test('应该返回最后一个有效的变量（包含stat_data）', async () => {
        const mockChat = [
            {
                swipe_id: 0,
                variables: [{
                    stat_data: { health: 100 },
                    display_data: {},
                    delta_data: {}
                }]
            },
            {
                swipe_id: 0,
                variables: [{
                    display_data: {},
                    delta_data: {}
                }]
            },
            {
                swipe_id: 0,
                variables: [{
                    stat_data: { health: 80 },
                    display_data: {},
                    delta_data: {}
                }]
            }
        ];

        (globalThis as any).SillyTavern = { chat: mockChat };
        (globalThis as any).getVariables = jest.fn();

        const result = await getLastValidVariable(2);

        expect(result).toEqual({
            stat_data: { health: 80 },
            display_data: {},
            delta_data: {}
        });
    });

    test('对于带有swipe_id的消息，需要检查对应的swipe并酌情跳过', async () => {
        const mockChat = [
            {
                swipe_id: 0,
                variables: [{
                    stat_data: { health: 100 },
                    display_data: {}
                }]
            },
            {// 第一个 swipe 没有数据
                swipe_id: 1,
                variables: [
                    { stat_data: { mana: 50 }, display_data: {} },
                    { display_data: {} }
                ]
            }
        ];

        (globalThis as any).SillyTavern = { chat: mockChat };
        (globalThis as any).getVariables = jest.fn();

        const result = await getLastValidVariable(1);

        expect(result).toEqual({
            stat_data: { health: 100 },
            display_data: {}
        });
    });

    test('对于带有swipe_id的消息，需要用到正确swipe 的数据', async () => {
        const mockChat = [
            {
                swipe_id: 0,
                variables: [{
                    stat_data: { health: 100 },
                    display_data: {}
                }]
            },
            {// 第一个 swipe 没有数据
                swipe_id: 1,
                variables: [
                    { display_data: {} },
                    { stat_data: { mana: 50 }, display_data: {} }
                ]
            }
        ];

        (globalThis as any).SillyTavern = { chat: mockChat };
        (globalThis as any).getVariables = jest.fn();

        const result = await getLastValidVariable(1);

        expect(result).toEqual({
            stat_data: { mana: 50 },
            display_data: {}
        });
    });

    test('当没有找到有效变量时应该调用getVariables', async () => {
        const mockChat = [
            {
                swipe_id: 0,
                variables: [{
                    display_data: {},
                    delta_data: {}
                }]
            },
            {
                swipe_id: 0,
                variables: [{
                    display_data: {}
                }]
            }
        ];

        const mockGetVariables = {
            stat_data: { default: true },
            display_data: {},
            delta_data: {}
        };

        (globalThis as any).SillyTavern = { chat: mockChat };
        (globalThis as any).getVariables = jest.fn().mockReturnValue(mockGetVariables);

        const result = await getLastValidVariable(1);

        expect(result).toEqual(mockGetVariables);
        expect((globalThis as any).getVariables).toHaveBeenCalled();
    });

    test('应该正确处理message_id边界', async () => {
        const mockChat = [
            {
                swipe_id: 0,
                variables: [{
                    stat_data: { level: 1 },
                    display_data: {}
                }]
            },
            {
                swipe_id: 0,
                variables: [{
                    stat_data: { level: 2 },
                    display_data: {}
                }]
            },
            {
                swipe_id: 0,
                variables: [{
                    stat_data: { level: 3 },
                    display_data: {}
                }]
            }
        ];

        (globalThis as any).SillyTavern = { chat: mockChat };
        (globalThis as any).getVariables = jest.fn();

        // 测试 message_id = 1，应该只检查前两个消息
        const result = await getLastValidVariable(1);

        expect(result).toEqual({
            stat_data: { level: 2 },
            display_data: {}
        });
    });

    test('应该处理空聊天记录', async () => {
        const mockGetVariables = {
            stat_data: { initialized: true },
            display_data: {},
            delta_data: {}
        };

        (globalThis as any).SillyTavern = { chat: [] };
        (globalThis as any).getVariables = jest.fn().mockReturnValue(mockGetVariables);

        const result = await getLastValidVariable(0);

        expect(result).toEqual(mockGetVariables);
        expect((globalThis as any).getVariables).toHaveBeenCalled();
    });

    test('应该正确处理undefined和null的variables', async () => {
        const mockChat = [
            {
                swipe_id: 0,
                variables: [{
                    stat_data: { valid: true },
                    display_data: {}
                }]
            },
            {
                swipe_id: 0,
                variables: undefined
            },
            {
                swipe_id: 0,
                variables: null
            }
        ];

        (globalThis as any).SillyTavern = { chat: mockChat };
        (globalThis as any).getVariables = jest.fn();

        const result = await getLastValidVariable(2);

        expect(result).toEqual({
            stat_data: { valid: true },
            display_data: {}
        });
    });

    test('应该使用structuredClone深拷贝结果', async () => {
        const originalVariable = {
            stat_data: { health: 100, items: ['sword', 'shield'] },
            display_data: {},
            delta_data: {}
        };

        const mockChat = [
            {
                swipe_id: 0,
                variables: [originalVariable]
            }
        ];

        (globalThis as any).SillyTavern = { chat: mockChat };
        (globalThis as any).getVariables = jest.fn();

        const result = await getLastValidVariable(0);

        // 验证是深拷贝
        expect(result).toEqual(originalVariable);
        expect(result).not.toBe(originalVariable);
        expect(result.stat_data).not.toBe(originalVariable.stat_data);
        expect(result.stat_data.items).not.toBe(originalVariable.stat_data.items);
    });
});

describe('invokeVariableTest', () => {
    test('should update variable value', async () => {
        const inputData : VariableData = {
            old_variables: {
                initialized_lorebooks: [],
                stat_data: {"喵呜": 20},
                display_data: {},
                delta_data: {}
            }
        };
        await handleVariablesInCallback("_.set('喵呜', 114);//测试", inputData);
        expect(inputData.new_variables).not.toBeUndefined();
        expect(inputData.new_variables!.stat_data.喵呜).toBe(114);
        expect(inputData.old_variables.stat_data.喵呜).toBe(20);
    });
    test('expect not updated', async () => {
        const inputData : VariableData = {
            old_variables: {
                initialized_lorebooks: [],
                stat_data: {"喵呜": 20},
                display_data: {},
                delta_data: {}
            }
        };
        await handleVariablesInCallback("这是一个没有更新的文本。明天见是最好的预言。", inputData);
        expect(inputData.new_variables).toBeUndefined();
    });
});
