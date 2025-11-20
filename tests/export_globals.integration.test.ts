import { exportGlobals, MVU } from '@/export_globals';
import type { CommandInfo } from '@/export_globals';
import { MvuData, variable_events } from '@/variable_def';
import _ from 'lodash';

// Mock the function module to provide real implementation
jest.mock('@/function', () => {
    const actual = jest.requireActual('@/function');
    return actual;
});

describe('export_globals integration test - Variable Update with display_data and delta_data', () => {
    let originalWindow: any;
    let mockEventEmit: jest.Mock;
    let mvu: any;

    beforeEach(() => {
        originalWindow = global.window;
        //@ts-ignore
        global.window = {
            parent: {} as any,
            Mvu: undefined as MVU | undefined,
        } as any;

        global._ = _;

        mockEventEmit = jest.fn().mockResolvedValue(undefined);
        (global as any).eventEmit = mockEventEmit;

        // Export globals to create Mvu object
        exportGlobals();
        //@ts-ignore
        mvu = global.window.Mvu;

        jest.clearAllMocks();
    });

    afterEach(() => {
        //@ts-ignore
        global.window = originalWindow;
        jest.restoreAllMocks();
    });

    test('should update stat_data, display_data and delta_data correctly for complex game state using Mvu.parseMessage', async () => {
        // 初始状态
        const initialState: MvuData = {
            initialized_lorebooks: {},
            stat_data: {
                剩余时间: 10,
                慕心: {
                    好感度: 0,
                    对悠纪好感度: 90,
                    认知度: 0,
                    摸摸次数: 2,
                    与悠纪摸摸次数: 2,
                    被知晓的秘密: 0,
                    衣着: {
                        上身: ['慕心', '见到悠纪时更新'],
                        下身: ['慕心', '见到悠纪时更新'],
                        内衣: ['慕心', '见到悠纪时更新'],
                        内裤: ['慕心', '见到悠纪时更新'],
                    },
                    重要物品: '',
                    想对user说的事: ['', '对远野说出后清空'],
                    已经历好感事件: 0,
                    当前所想: ['', '慕心在想的事情'],
                },
                悠纪: {
                    好感度: 0,
                    对慕心好感度: 90,
                    认知度: 0,
                    与慕心摸摸次数: 2,
                    摸摸次数: 2,
                    被知晓的秘密: 0,
                    衣着: {
                        上身: ['未知', '见到悠纪时更新'],
                        下身: ['未知', '见到悠纪时更新'],
                        内衣: ['未知', '见到悠纪时更新'],
                        内裤: ['未知', '见到悠纪时更新'],
                    },
                    存活: 1,
                    重要物品: '',
                    想对user说的事: ['', '对远野说出后清空'],
                    已经历好感事件: 0,
                    当前所想: ['', '悠纪在想的事情'],
                },
                秘密: [],
                地点: '图书馆',
                场景人物: '未知',
                日期: '3月14日',
                当前事件: '',
                当前时间: '9:00',
                世界状态: '正常',
                共鸣度: '0',
                当前研究: 0,
                重要物品: '',
            },
            display_data: {},
            delta_data: {},
        };

        // 准备更新消息
        const updateMessage = `
<UpdateVariable>
<Analysis>
地点: Y
场景人物: Y
当前时间: Y
慕心.当前所想: Y
悠纪.当前所想: Y
慕心.想对user说的事: N
悠纪.想对user说的事: N
慕心.衣着.上身: N
慕心.衣着.下身: N
悠纪.衣着.上身: N
悠纪.衣着.下身: N
重要物品: N
日期: N
世界状态: N
慕心.好感度: N
悠纪.好感度: N
</Analysis>
_.set('地点', "图书馆", "悠纪的公寓");//仍处于原地
_.set('场景人物', "未知", "慕心&悠纪");//当前在场角色更新
_.set('当前时间', "9:00", "14:15");//休息十五分钟
_.set('慕心.当前所想[0]', "", "狐狸真的很适合他呢，既聪明又带点狡猾…也只有我能画得出来"); //基于她对远野的动作反馈
_.set('悠纪.当前所想[0]', "", "……狐狸？嗯…她的用词很精准。"); //回应慕心与远野亲昵举动后的思绪更新
</UpdateVariable>`;

        // 使用 Mvu.parseMessage 方法来处理更新
        const updatedState = await mvu.parseMessage(updateMessage, initialState);

        // 验证返回了新的状态
        expect(updatedState).toBeDefined();

        // 验证 stat_data 更新正确
        expect(updatedState.stat_data.地点).toBe('悠纪的公寓');
        expect(updatedState.stat_data.场景人物).toBe('慕心&悠纪');
        expect(updatedState.stat_data.当前时间).toBe('14:15');
        expect(updatedState.stat_data.慕心.当前所想[0]).toBe(
            '狐狸真的很适合他呢，既聪明又带点狡猾…也只有我能画得出来'
        );
        expect(updatedState.stat_data.悠纪.当前所想[0]).toBe('……狐狸？嗯…她的用词很精准。');

        // 验证 display_data 包含变化记录
        expect(updatedState.display_data.地点).toBe('图书馆->悠纪的公寓 (仍处于原地)');
        expect(updatedState.display_data.场景人物).toBe('未知->慕心&悠纪 (当前在场角色更新)');
        expect(updatedState.display_data.当前时间).toBe('9:00->14:15 (休息十五分钟)');
        expect(updatedState.display_data.慕心.当前所想[0]).toBe(
            '->狐狸真的很适合他呢，既聪明又带点狡猾…也只有我能画得出来 (基于她对远野的动作反馈)'
        );
        expect(updatedState.display_data.悠纪.当前所想[0]).toBe(
            '->……狐狸？嗯…她的用词很精准。 (回应慕心与远野亲昵举动后的思绪更新)'
        );

        // 验证 delta_data 只包含变化的部分
        expect(updatedState.delta_data.地点).toBe('图书馆->悠纪的公寓 (仍处于原地)');
        expect(updatedState.delta_data.场景人物).toBe('未知->慕心&悠纪 (当前在场角色更新)');
        expect(updatedState.delta_data.当前时间).toBe('9:00->14:15 (休息十五分钟)');
        expect(updatedState.delta_data.慕心?.当前所想?.[0]).toBe(
            '->狐狸真的很适合他呢，既聪明又带点狡猾…也只有我能画得出来 (基于她对远野的动作反馈)'
        );
        expect(updatedState.delta_data.悠纪?.当前所想?.[0]).toBe(
            '->……狐狸？嗯…她的用词很精准。 (回应慕心与远野亲昵举动后的思绪更新)'
        );

        // 验证 delta_data 不包含未更改的数据
        expect(updatedState.delta_data.剩余时间).toBeUndefined();
        expect(updatedState.delta_data.慕心?.好感度).toBeUndefined();
        expect(updatedState.delta_data.悠纪?.好感度).toBeUndefined();
    });

    test('should emit COMMAND_PARSED with parsed command payload during parseMessage', async () => {
        const initialState: MvuData = {
            initialized_lorebooks: {},
            stat_data: {
                player: {
                    health: 100,
                },
            },
            display_data: {},
            delta_data: {},
        };

        const updateMessage = "_.set('player.health', 100, 90);//Test reason";

        const updatedState = await mvu.parseMessage(updateMessage, initialState);
        expect(updatedState).toBeDefined();
        expect(updatedState?.stat_data.player.health).toBe(90);

        const commandParsedCalls = mockEventEmit.mock.calls.filter(
            ([eventName]) => eventName === variable_events.COMMAND_PARSED
        );
        expect(commandParsedCalls).toHaveLength(1);

        const [, , parsedCommands] = commandParsedCalls[0];
        const commands = parsedCommands as CommandInfo[];

        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatchObject({
            type: 'set',
            full_match: "_.set('player.health', 100, 90);//Test reason",
            args: ['player.health', '100', '90'], //在这个版本中变动的原因是，commands[] 数组是 by ref 的，在pathFixPass中进行了变动
            reason: 'Test reason',
        });
    });

    test('should use Mvu.setMvuVariable to update variables with display_data and delta_data', async () => {
        const testData = {
            initialized_lorebooks: {},
            stat_data: {
                $internal: {
                    display_data: {} as any,
                    delta_data: {} as any,
                },
                player: {
                    health: 100,
                    mana: 50,
                    level: 5,
                },
            },
            display_data: {
                player: {
                    health: 100,
                    mana: 50,
                    level: 5,
                },
            } as any,
            delta_data: {} as any,
        } satisfies MvuData;

        // 准备内部数据结构以支持 display_data 和 delta_data 更新
        testData.stat_data.$internal = {
            display_data: testData.display_data,
            delta_data: testData.delta_data,
        };

        // 使用 Mvu.setMvuVariable 更新变量
        const result1 = await mvu.setMvuVariable(testData, 'player.health', 80, {
            reason: '受到伤害',
        });
        const result2 = await mvu.setMvuVariable(testData, 'player.mana', 75, {
            reason: '恢复法力',
        });
        const result3 = await mvu.setMvuVariable(testData, 'player.level', 6, { reason: '升级' });

        // 验证更新成功
        expect(result1).toBe(true);
        expect(result2).toBe(true);
        expect(result3).toBe(true);

        // 验证 stat_data 更新正确
        expect(testData.stat_data.player.health).toBe(80);
        expect(testData.stat_data.player.mana).toBe(75);
        expect(testData.stat_data.player.level).toBe(6);

        // 验证 display_data 包含变化记录
        expect(testData.display_data.player.health).toBe('100->80 (受到伤害)');
        expect(testData.display_data.player.mana).toBe('50->75 (恢复法力)');
        expect(testData.display_data.player.level).toBe('5->6 (升级)');

        // 验证 delta_data 记录了所有变化
        expect(testData.delta_data.player.health).toBe('100->80 (受到伤害)');
        expect(testData.delta_data.player.mana).toBe('50->75 (恢复法力)');
        expect(testData.delta_data.player.level).toBe('5->6 (升级)');
    });

    test('should use Mvu.getMvuVariable to get values from different data categories', () => {
        const testData: MvuData = {
            initialized_lorebooks: {},
            stat_data: {
                player: {
                    health: [100, '当前生命值'],
                    position: '城镇',
                },
            },
            display_data: {
                player: {
                    health: '100->80 (受到伤害)',
                    position: '城镇->森林 (移动)',
                },
            },
            delta_data: {
                player: {
                    health: '100->80 (受到伤害)',
                },
            },
        };

        // 从 stat_data 获取值（默认）
        const healthValue = mvu.getMvuVariable(testData, 'player.health');
        expect(healthValue).toBe(100); // ValueWithDescription 返回第一个元素

        const positionValue = mvu.getMvuVariable(testData, 'player.position');
        expect(positionValue).toBe('城镇');

        // 从 display_data 获取值
        const healthDisplay = mvu.getMvuVariable(testData, 'player.health', {
            category: 'display',
        });
        expect(healthDisplay).toBe('100->80 (受到伤害)');

        const positionDisplay = mvu.getMvuVariable(testData, 'player.position', {
            category: 'display',
        });
        expect(positionDisplay).toBe('城镇->森林 (移动)');

        // 从 delta_data 获取值
        const healthDelta = mvu.getMvuVariable(testData, 'player.health', { category: 'delta' });
        expect(healthDelta).toBe('100->80 (受到伤害)');

        // 不存在的路径返回 undefined 或默认值
        const nonExistent = mvu.getMvuVariable(testData, 'player.position', { category: 'delta' });
        expect(nonExistent).toBeUndefined();

        const withDefault = mvu.getMvuVariable(testData, 'player.nonexistent', {
            default_value: 'default',
        });
        expect(withDefault).toBe('default');
    });

    test('should use Mvu.getRecordFromMvuData to extract different data categories', () => {
        const testData: MvuData = {
            initialized_lorebooks: {},
            stat_data: { a: 1, b: 2 },
            display_data: { a: '1->10', b: '2->20' },
            delta_data: { b: '2->20' },
        };

        // 获取 stat_data
        const statRecord = mvu.getRecordFromMvuData(testData, 'stat');
        expect(statRecord).toBe(testData.stat_data);
        expect(statRecord).toEqual({ a: 1, b: 2 });

        // 获取 display_data
        const displayRecord = mvu.getRecordFromMvuData(testData, 'display');
        expect(displayRecord).toBe(testData.display_data);
        expect(displayRecord).toEqual({ a: '1->10', b: '2->20' });

        // 获取 delta_data
        const deltaRecord = mvu.getRecordFromMvuData(testData, 'delta');
        expect(deltaRecord).toBe(testData.delta_data);
        expect(deltaRecord).toEqual({ b: '2->20' });
    });

    test('Mvu.parseMessage should handle ValueWithDescription arrays correctly', async () => {
        const testData: MvuData = {
            initialized_lorebooks: {},
            stat_data: {
                player: {
                    health: [100, '当前生命值'],
                    mana: [50, '当前法力值'],
                    position: ['城镇', '当前位置'],
                },
            },
            display_data: {},
            delta_data: {},
        };

        const updateMessage = `
_.set('player.health[0]', 100, 80);//受到伤害
_.set('player.mana[0]', 50, 75);//恢复法力
_.set('player.position[0]', "城镇", "森林");//移动到森林
`;

        const updatedState = await mvu.parseMessage(updateMessage, testData);

        // 验证 ValueWithDescription 数组正确更新
        expect(updatedState.stat_data.player.health).toEqual([80, '当前生命值']);
        expect(updatedState.stat_data.player.mana).toEqual([75, '当前法力值']);
        expect(updatedState.stat_data.player.position).toEqual(['森林', '当前位置']);

        // 验证 display_data 正确显示
        expect(updatedState.display_data.player.health[0]).toBe('100->80 (受到伤害)');
        expect(updatedState.display_data.player.mana[0]).toBe('50->75 (恢复法力)');
        expect(updatedState.display_data.player.position[0]).toBe('城镇->森林 (移动到森林)');

        // 验证 delta_data 正确记录
        expect(updatedState.delta_data.player.health[0]).toBe('100->80 (受到伤害)');
        expect(updatedState.delta_data.player.mana[0]).toBe('50->75 (恢复法力)');
        expect(updatedState.delta_data.player.position[0]).toBe('城镇->森林 (移动到森林)');
    });

    test('Mvu.parseMessage should handle number type conversions correctly', async () => {
        const testData: MvuData = {
            initialized_lorebooks: {},
            stat_data: {
                stats: {
                    level: 5,
                    experience: 1000,
                    gold: 500,
                },
            },
            display_data: {},
            delta_data: {},
        };

        const updateMessage = `
_.set('stats.level', 5, "6");//升级
_.set('stats.experience', 1000, "1250");//获得经验
_.set('stats.gold', 500, "750");//获得金币
`;

        const updatedState = await mvu.parseMessage(updateMessage, testData);

        // 验证数字类型正确转换
        expect(updatedState.stat_data.stats.level).toBe(6);
        expect(updatedState.stat_data.stats.experience).toBe(1250);
        expect(updatedState.stat_data.stats.gold).toBe(750);
        expect(typeof updatedState.stat_data.stats.level).toBe('number');
        expect(typeof updatedState.stat_data.stats.experience).toBe('number');
        expect(typeof updatedState.stat_data.stats.gold).toBe('number');

        // 验证显示格式
        expect(updatedState.display_data.stats.level).toBe('5->6 (升级)');
        expect(updatedState.display_data.stats.experience).toBe('1000->1250 (获得经验)');
        expect(updatedState.display_data.stats.gold).toBe('500->750 (获得金币)');
    });

    test('Mvu events property should expose correct event names', () => {
        // 验证 events 属性包含正确的事件名称
        expect(mvu.events).toBeDefined();
        expect(mvu.events.SINGLE_VARIABLE_UPDATED).toBe('mag_variable_updated');
        expect(mvu.events.VARIABLE_UPDATE_ENDED).toBe('mag_variable_update_ended');
        expect(mvu.events.VARIABLE_UPDATE_STARTED).toBe('mag_variable_update_started');
    });

    test('Mvu.setMvuVariable with is_recursive should trigger eventEmit', async () => {
        let testData = {
            initialized_lorebooks: {},
            stat_data: {
                player: {
                    health: 100,
                    mana: 50,
                    experience: 1000,
                    level: [10, '当前等级'],
                },
            },
            display_data: {
                player: {
                    health: 100,
                    mana: 50,
                    experience: 1000,
                    level: [10, '当前等级'],
                },
            },
            delta_data: {},
        } satisfies MvuData;

        // 准备内部数据结构
        (testData.stat_data as any).$internal = {
            display_data: testData.display_data,
            delta_data: testData.delta_data,
        };

        // 测试 is_recursive = false（默认）不触发事件
        mockEventEmit.mockClear();
        await mvu.setMvuVariable(testData, 'player.health', 80, {
            reason: '受到伤害',
            is_recursive: false,
        });

        // 不应该触发 SINGLE_VARIABLE_UPDATED 事件
        expect(mockEventEmit).not.toHaveBeenCalledWith(
            'mag_variable_updated',
            expect.anything(),
            expect.anything(),
            expect.anything(),
            expect.anything()
        );

        // 测试 is_recursive = true 触发事件
        mockEventEmit.mockClear();
        await mvu.setMvuVariable(testData, 'player.mana', 30, {
            reason: '施放法术',
            is_recursive: true,
        });

        // 应该触发 SINGLE_VARIABLE_UPDATED 事件
        expect(mockEventEmit).toHaveBeenCalledWith(
            'mag_variable_updated',
            testData.stat_data,
            'player.mana',
            50, // oldValue
            30 // newValue
        );

        mockEventEmit.mockClear();
        await mvu.setMvuVariable(testData, 'player.level[0]', 11, {
            reason: '升级',
            is_recursive: true,
        });

        // 应该触发事件，传递正确的新旧值
        expect(mockEventEmit).toHaveBeenCalledWith(
            'mag_variable_updated',
            testData.stat_data,
            'player.level[0]',
            10, // oldValue
            11 // newValue
        );

        // 清理内部数据
        delete (testData.stat_data as any).$internal;

        // 验证所有更新都正确应用
        expect(testData.stat_data.player.health).toBe(80);
        expect(testData.stat_data.player.mana).toBe(30);
        expect(testData.stat_data.player.level[0]).toBe(11);

        // 验证 display_data 更新
        expect(testData.display_data.player.health).toBe('100->80 (受到伤害)');
        expect(testData.display_data.player.mana).toBe('50->30 (施放法术)');
        expect(testData.display_data.player.level[0]).toBe('10->11 (升级)');
    });

    test('Mvu.setMvuVariable is_recursive behavior with nested paths', async () => {
        const testData = {
            initialized_lorebooks: {},
            stat_data: {
                game: {
                    settings: {
                        difficulty: 'normal',
                        volume: 80,
                    },
                },
            },
            display_data: {} as any,
            delta_data: {},
        } satisfies MvuData;

        (testData.stat_data as any).$internal = {
            display_data: testData.display_data,
            delta_data: testData.delta_data,
        };

        // 测试嵌套路径的 is_recursive
        mockEventEmit.mockClear();

        // 不递归更新
        await mvu.setMvuVariable(testData, 'game.settings.difficulty', 'hard', {
            reason: '增加难度',
            is_recursive: false,
        });

        expect(mockEventEmit).not.toHaveBeenCalled();

        // 递归更新
        await mvu.setMvuVariable(testData, 'game.settings.volume', 60, {
            reason: '降低音量',
            is_recursive: true,
        });

        expect(mockEventEmit).toHaveBeenCalledWith(
            'mag_variable_updated',
            testData.stat_data,
            'game.settings.volume',
            80, // oldValue
            60 // newValue
        );

        delete (testData.stat_data as any).$internal;

        // 验证更新结果
        expect(testData.stat_data.game.settings.difficulty).toBe('hard');
        expect(testData.stat_data.game.settings.volume).toBe(60);
        expect(testData.display_data.game.settings.difficulty).toBe('normal->hard (增加难度)');
        expect(testData.display_data.game.settings.volume).toBe('80->60 (降低音量)');
    });

    test('Mvu.parseMessage should return undefined when no changes are made', async () => {
        const testData: MvuData = {
            initialized_lorebooks: {},
            stat_data: {
                value: 100,
            },
            display_data: {},
            delta_data: {},
        };

        // 发送一个不包含有效更新的消息
        const updateMessage = `
<UpdateVariable>
// No actual updates
</UpdateVariable>`;

        const result = await mvu.parseMessage(updateMessage, testData);

        // 应该返回 undefined，因为没有实际的变更
        expect(result).toBeUndefined();
    });

    test('Complex integration test with all Mvu methods', async () => {
        // 1. 初始化数据
        const initialState: MvuData = {
            initialized_lorebooks: {},
            stat_data: {
                game: {
                    score: 0,
                    level: 1,
                    player: {
                        name: 'Hero',
                        health: [100, '最大生命值'],
                        position: 'start',
                    },
                },
            },
            display_data: {},
            delta_data: {},
        };

        // 2. 使用 parseMessage 进行批量更新
        const batchUpdate = `
_.set('game.score', 0, 1000);//获得分数
_.set('game.level', 1, 2);//升级
_.set('game.player.position', "start", "checkpoint1");//到达检查点
`;

        const afterBatch = await mvu.parseMessage(batchUpdate, initialState);
        expect(afterBatch).toBeDefined();
        expect(afterBatch.stat_data.game.score).toBe(1000);
        expect(afterBatch.stat_data.game.level).toBe(2);
        expect(afterBatch.stat_data.game.player.position).toBe('checkpoint1');

        // 3. 使用 setMvuVariable 进行单个更新
        afterBatch.stat_data.$internal = {
            stat_data: afterBatch.stat_data,
            display_data: afterBatch.display_data,
            delta_data: afterBatch.delta_data,
        };

        await mvu.setMvuVariable(afterBatch, 'game.player.health[0]', 75, { reason: '战斗受伤' });

        delete afterBatch.stat_data.$internal;

        // 4. 使用 getMvuVariable 验证更新
        const healthAfterBattle = mvu.getMvuVariable(afterBatch, 'game.player.health');
        expect(healthAfterBattle).toBe(75);

        const healthDisplay = mvu.getMvuVariable(afterBatch, 'game.player.health', {
            category: 'display',
        });
        expect(healthDisplay).toBe('100->75 (战斗受伤)');

        // 5. 使用 getRecordFromMvuData 获取完整记录
        const fullStatData = mvu.getRecordFromMvuData(afterBatch, 'stat');
        expect(fullStatData.game.score).toBe(1000);
        expect(fullStatData.game.player.health[0]).toBe(75);

        const fullDisplayData = mvu.getRecordFromMvuData(afterBatch, 'display');
        expect(fullDisplayData.game.score).toBe('0->1000 (获得分数)');

        //这里就算 VWD 的狼狈之处了
        expect(fullDisplayData.game.player.health[0]).toBe('100->75 (战斗受伤)');
    });
});
