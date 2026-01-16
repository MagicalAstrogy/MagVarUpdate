import { updateDescriptions } from '@/update_descriptions';
import _ from 'lodash';

// Make lodash available globally for the function
(global as any)._ = _;

describe('updateDescriptions', () => {
    describe('条件 4(a): description 字段更新', () => {
        it('应该更新对象中的 description 字段', () => {
            const initData = {
                属性: {
                    value: 100,
                    description: '这是初始描述',
                },
            };
            const msgData = {
                属性: {
                    value: 200,
                    description: '这是旧描述',
                },
            };
            // targetData 是 initData 为基础，合并了 msgData
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            expect(targetData.属性.description).toBe('这是初始描述');
            expect(targetData.属性.value).toBe(200); // value 来自 msgData
        });

        it('应该处理嵌套对象中的 description 字段', () => {
            const initData = {
                装备: {
                    武器: {
                        name: '剑',
                        description: '初始武器描述',
                    },
                    防具: {
                        name: '盾',
                        description: '初始防具描述',
                    },
                },
            };
            const msgData = {
                装备: {
                    武器: {
                        name: '大剑',
                        description: '旧武器描述',
                        damage: 100,
                    },
                    防具: {
                        name: '重盾',
                        description: '旧防具描述',
                        defense: 50,
                    },
                },
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            expect(targetData.装备.武器.description).toBe('初始武器描述');
            expect(targetData.装备.防具.description).toBe('初始防具描述');
            expect(targetData.装备.武器.name).toBe('大剑'); // 其他值来自 msgData
            expect(targetData.装备.武器.damage).toBe(100); // msgData 中新增的属性
        });

        it('当 msgData 中不存在对应路径时不应该更新', () => {
            const initData = {
                属性: {
                    description: '初始描述',
                },
            };
            const msgData = {
                其他: {
                    value: 123,
                },
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            expect(targetData.属性.description).toBe('初始描述'); // 保持不变
            expect(targetData.其他.value).toBe(123); // msgData 的内容
        });
    });

    describe('条件 4(b): ValueWithDescription 类型更新', () => {
        it('应该更新简单的 ValueWithDescription 数组', () => {
            const initData = {
                生命值: [100, '初始生命值描述'],
                魔法值: [50, '初始魔法值描述'],
            };
            const msgData = {
                生命值: [200, '旧生命值描述'],
                魔法值: [80, '旧魔法值描述'],
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            expect(targetData.生命值).toEqual([200, '初始生命值描述']);
            expect(targetData.魔法值).toEqual([80, '初始魔法值描述']);
        });

        it('应该处理 ValueWithDescription 中包含对象的情况', () => {
            const initData = {
                复杂属性: [
                    {
                        value: 100,
                        description: '对象内的描述',
                    },
                    '外层描述',
                ],
            };
            const msgData = {
                复杂属性: [
                    {
                        value: 200,
                        description: '旧的对象内描述',
                        extra: 'new field',
                    },
                    '旧的外层描述',
                ],
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            expect(targetData.复杂属性[1]).toBe('外层描述');
            // @ts-ignore
            expect(targetData.复杂属性[0].description).toBe('对象内的描述');
            // @ts-ignore
            expect(targetData.复杂属性[0].value).toBe(200);
            // @ts-ignore
            expect(targetData.复杂属性[0].extra).toBe('new field'); // msgData 中新增的字段
        });

        it('应该处理嵌套的 ValueWithDescription', () => {
            const initData = {
                装备: {
                    武器: ['剑', '初始武器'],
                    属性加成: {
                        攻击力: [10, '武器攻击力加成'],
                    },
                },
            };
            const msgData = {
                装备: {
                    武器: ['枪', '旧武器'],
                    属性加成: {
                        攻击力: [20, '旧的攻击力加成'],
                        暴击率: [5, '新增的暴击率'], // msgData 中新增
                    },
                },
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            expect(targetData.装备.武器).toEqual(['枪', '初始武器']);
            expect(targetData.装备.属性加成.攻击力).toEqual([20, '武器攻击力加成']);
            expect(targetData.装备.属性加成.暴击率).toEqual([5, '新增的暴击率']); // 新增的保持不变
        });
    });

    describe('数组处理', () => {
        it('应该递归处理普通数组中的对象', () => {
            const initData = {
                技能: [
                    {
                        name: '攻击',
                        damage: 50,
                        description: '普通攻击初始描述',
                    },
                    {
                        name: '防御',
                        defense: 30,
                        description: '防御技能初始描述',
                    },
                ],
            };
            const msgData = {
                技能: [
                    {
                        name: '攻击',
                        damage: 60,
                        description: '普通攻击旧描述',
                        cooldown: 5, // 新增属性
                    },
                    {
                        name: '防御',
                        defense: 40,
                        description: '防御技能旧描述',
                    },
                    {
                        name: '治疗',
                        heal: 30,
                        description: '治疗技能描述', // msgData 中新增的技能
                    },
                ],
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            expect(targetData.技能[0].description).toBe('普通攻击初始描述');
            expect(targetData.技能[1].description).toBe('防御技能初始描述');
            expect(targetData.技能[0].damage).toBe(60);
            expect(targetData.技能[0].cooldown).toBe(5); // 新增属性保留
            expect(targetData.技能[2].description).toBe('治疗技能描述'); // 新增的技能保持不变
        });

        it('应该处理数组中包含 ValueWithDescription 的情况', () => {
            const initData = {
                技能列表: [
                    {
                        name: '火球术',
                        damage: [50, '基础火焰伤害'],
                        description: '火系法术',
                    },
                ],
            };
            const msgData = {
                技能列表: [
                    {
                        name: '火球术',
                        damage: [80, '旧的伤害描述'],
                        description: '旧的火系法术描述',
                        mana: 20, // 新增
                    },
                ],
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            expect(targetData.技能列表[0].damage).toEqual([80, '基础火焰伤害']);
            expect(targetData.技能列表[0].description).toBe('火系法术');
            expect(targetData.技能列表[0].mana).toBe(20);
        });

        it('应该处理嵌套数组', () => {
            const initData = {
                矩阵: [
                    [
                        { value: 1, description: '第一个元素' },
                        { value: 2, description: '第二个元素' },
                    ],
                ],
            };
            const msgData = {
                矩阵: [
                    [
                        { value: 10, description: '旧的第一个' },
                        { value: 20, description: '旧的第二个' },
                    ],
                ],
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            expect(targetData.矩阵[0][0].description).toBe('第一个元素');
            expect(targetData.矩阵[0][1].description).toBe('第二个元素');
            expect(targetData.矩阵[0][0].value).toBe(10);
            expect(targetData.矩阵[0][1].value).toBe(20);
        });
    });

    describe('复杂场景', () => {
        it('应该处理完整的复杂数据结构', () => {
            const initData = {
                属性: {
                    value: 100,
                    description: '这是初始描述',
                },
                生命值: [100, '初始生命值'],
                技能: [
                    {
                        name: '攻击',
                        damage: [50, '基础伤害'],
                        description: '普通攻击',
                    },
                ],
                装备: {
                    武器: ['剑', '初始武器'],
                    属性加成: {
                        攻击力: [10, '武器攻击力加成'],
                    },
                },
            };
            const msgData = {
                属性: {
                    value: 200,
                    description: '旧描述',
                    level: 5, // 新增
                },
                生命值: [150, '旧生命值'],
                技能: [
                    {
                        name: '攻击',
                        damage: [70, '旧伤害'],
                        description: '旧攻击描述',
                    },
                ],
                装备: {
                    武器: ['枪', '旧武器'],
                    属性加成: {
                        攻击力: [15, '旧攻击力加成'],
                        防御力: [5, '新增防御力'], // 新增
                    },
                    饰品: {
                        // 新增
                        name: '戒指',
                        description: '魔法戒指',
                    },
                },
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            // 验证所有描述都被更新为初始值
            expect(targetData.属性.description).toBe('这是初始描述');
            expect(targetData.生命值[1]).toBe('初始生命值');
            expect(targetData.技能[0].damage[1]).toBe('基础伤害');
            expect(targetData.技能[0].description).toBe('普通攻击');
            expect(targetData.装备.武器[1]).toBe('初始武器');
            expect(targetData.装备.属性加成.攻击力[1]).toBe('武器攻击力加成');

            // 验证其他值来自 msgData
            expect(targetData.属性.value).toBe(200);
            expect(targetData.属性.level).toBe(5);
            expect(targetData.生命值[0]).toBe(150);
            expect(targetData.技能[0].damage[0]).toBe(70);
            expect(targetData.装备.武器[0]).toBe('枪');
            expect(targetData.装备.属性加成.攻击力[0]).toBe(15);
            expect(targetData.装备.属性加成.防御力).toEqual([5, '新增防御力']);
            expect(targetData.装备.饰品.description).toBe('魔法戒指');
        });

        it('应该正确处理 initData 有但 msgData 没有的路径', () => {
            const initData = {
                旧功能: {
                    description: '这个功能在新版本中被移除了',
                },
                技能: [
                    { name: '技能1', description: '初始技能1' },
                    { name: '技能2', description: '初始技能2' },
                    { name: '技能3', description: '初始技能3' },
                ],
            };
            const msgData = {
                技能: [
                    { name: '技能1', description: '旧技能1' },
                    { name: '技能2', description: '旧技能2' },
                    // 没有技能3
                ],
                新功能: {
                    description: '这是新增的功能',
                },
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            // initData 有但 msgData 没有的保持不变
            expect(targetData.旧功能.description).toBe('这个功能在新版本中被移除了');
            expect(targetData.技能[2].description).toBe('初始技能3');

            // 两者都有的路径，description 更新为 initData 的值
            expect(targetData.技能[0].description).toBe('初始技能1');
            expect(targetData.技能[1].description).toBe('初始技能2');

            // msgData 新增的保持不变
            expect(targetData.新功能.description).toBe('这是新增的功能');
        });

        it('应该处理空值和边界情况', () => {
            const initData = {
                空对象: {},
                空数组: [],
                只有一个元素的数组: ['不是ValueWithDescription'],
                description不是字符串: {
                    description: 123,
                },
                正常属性: {
                    description: '正常的描述',
                },
            };
            const msgData = {
                空对象: { value: 1 },
                空数组: [1, 2, 3],
                只有一个元素的数组: ['something'],
                description不是字符串: {
                    description: 456,
                },
                正常属性: {
                    description: '会被替换的描述',
                    value: 100,
                },
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            // 特殊情况保持 merge 后的值
            expect(targetData.空对象).toEqual({ value: 1 });
            expect(targetData.空数组).toEqual([1, 2, 3]);
            expect(targetData.只有一个元素的数组).toEqual(['something']);
            expect(targetData.description不是字符串.description).toBe(456);

            // 正常情况 description 被更新
            expect(targetData.正常属性.description).toBe('正常的描述');
            expect(targetData.正常属性.value).toBe(100);
        });

        it('应该处理 ValueWithDescription 长度不匹配的情况', () => {
            const initData = {
                属性1: [100, '描述'], // 正常的 ValueWithDescription
                属性2: [200, '描述'],
            };
            const msgData = {
                属性1: [150], // 只有一个元素
                属性2: [250, '旧描述', '额外元素'], // 有三个元素
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            // 长度不匹配时不更新
            expect(targetData.属性1).toEqual([150, '描述']); // 保持 merge 后的结果
            expect(targetData.属性2).toEqual([250, '旧描述', '额外元素']);
        });
    });

    describe('PR #20 讨论中的 edge cases', () => {
        it('应该正确处理 array-based value-with-description 的复杂嵌套', () => {
            // 基于 PR #20 讨论的具体场景
            const initData = {
                复杂数据: [['数据1', '数据2'], '更改后的描述'],
            };
            const msgData = {
                复杂数据: [['数据3', '数据4'], '更改前的描述'],
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            // 验证数组内容来自 msgData，但描述来自 initData
            expect(targetData.复杂数据).toEqual([['数据3', '数据4'], '更改后的描述']);
        });

        it('应该处理对象形式的 ValueWithDescription', () => {
            const initData = {
                变量1: { value: 100, description: '初始含义/规则' },
                变量2: { value: [1, 2, 3], description: '初始数组描述' },
            };
            const msgData = {
                变量1: { value: 200, description: '更新后含义/规则' },
                变量2: { value: [4, 5, 6], description: '更新后数组描述' },
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            // value 来自 msgData，description 来自 initData
            expect(targetData['变量1']).toEqual({ value: 200, description: '初始含义/规则' });
            expect(targetData['变量2']).toEqual({ value: [4, 5, 6], description: '初始数组描述' });
        });

        it('应该处理混合的数组和对象 ValueWithDescription 格式', () => {
            const initData = {
                数组格式: [100, '数组形式的初始描述'],
                对象格式: { value: 200, description: '对象形式的初始描述' },
                嵌套混合: {
                    数组子项: [50, '嵌套数组描述'],
                    对象子项: { value: 75, description: '嵌套对象描述' },
                },
            };
            const msgData = {
                数组格式: [150, '数组形式的更新描述'],
                对象格式: { value: 250, description: '对象形式的更新描述' },
                嵌套混合: {
                    数组子项: [80, '嵌套数组更新描述'],
                    对象子项: { value: 90, description: '嵌套对象更新描述' },
                },
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            expect(targetData['数组格式']).toEqual([150, '数组形式的初始描述']);
            expect(targetData['对象格式']).toEqual({
                value: 250,
                description: '对象形式的初始描述',
            });
            expect(targetData['嵌套混合']['数组子项']).toEqual([80, '嵌套数组描述']);
            expect(targetData['嵌套混合']['对象子项']).toEqual({
                value: 90,
                description: '嵌套对象描述',
            });
        });

        it('应该处理 InitVar 更新合并逻辑', () => {
            // 模拟 latest_init_data 和 latest_msg_data 的比较场景
            const latest_init_data = {
                玩家属性: {
                    生命值: { value: 100, description: '玩家的生命值上限' },
                    魔法值: [50, '玩家的魔法值上限'],
                    等级: { value: 1, description: '玩家当前等级' },
                },
                游戏设置: {
                    难度: ['普通', '游戏难度设置'],
                    音效: { value: true, description: '音效开关' },
                },
            };
            const latest_msg_data = {
                玩家属性: {
                    生命值: { value: 120, description: '更新的生命值描述' },
                    魔法值: [60, '更新的魔法值描述'],
                    等级: { value: 2, description: '更新的等级描述' },
                },
                游戏设置: {
                    难度: ['困难', '更新的难度描述'],
                    音效: { value: false, description: '更新的音效描述' },
                },
            };
            const targetData = _.merge(_.cloneDeep(latest_init_data), latest_msg_data);

            updateDescriptions('', latest_init_data, latest_msg_data, targetData);

            // 验证合并结果：值来自 latest_msg_data，描述来自 latest_init_data
            expect(targetData.玩家属性.生命值).toEqual({
                value: 120,
                description: '玩家的生命值上限',
            });
            expect(targetData.玩家属性.魔法值).toEqual([60, '玩家的魔法值上限']);
            expect(targetData.玩家属性.等级).toEqual({ value: 2, description: '玩家当前等级' });
            expect(targetData.游戏设置.难度).toEqual(['困难', '游戏难度设置']);
            expect(targetData.游戏设置.音效).toEqual({ value: false, description: '音效开关' });
        });

        it('应该处理三层嵌套的复杂数组对象结构', () => {
            const initData = {
                装备库: [
                    {
                        分类: '武器',
                        物品列表: [
                            { 名称: '短剑', 属性: [10, '基础攻击力'], description: '普通的短剑' },
                            { 名称: '长剑', 属性: [20, '高攻击力'], description: '锋利的长剑' },
                        ],
                    },
                    {
                        分类: '防具',
                        物品列表: [
                            {
                                名称: '皮甲',
                                属性: { value: 5, description: '基础防御力' },
                                description: '简单的皮甲',
                            },
                        ],
                    },
                ],
            };
            const msgData = {
                装备库: [
                    {
                        分类: '武器',
                        物品列表: [
                            {
                                名称: '短剑',
                                属性: [15, '更新的攻击力描述'],
                                description: '更新的短剑描述',
                            },
                            {
                                名称: '长剑',
                                属性: [25, '更新的高攻击力描述'],
                                description: '更新的长剑描述',
                            },
                        ],
                    },
                    {
                        分类: '防具',
                        物品列表: [
                            {
                                名称: '皮甲',
                                属性: { value: 8, description: '更新的防御力描述' },
                                description: '更新的皮甲描述',
                            },
                        ],
                    },
                ],
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            // 验证三层嵌套结构中的描述更新
            expect(targetData.装备库[0].物品列表[0].属性).toEqual([15, '基础攻击力']);
            expect(targetData.装备库[0].物品列表[0].description).toBe('普通的短剑');
            expect(targetData.装备库[0].物品列表[1].属性).toEqual([25, '高攻击力']);
            expect(targetData.装备库[0].物品列表[1].description).toBe('锋利的长剑');
            expect(targetData.装备库[1].物品列表[0].属性).toEqual({
                value: 8,
                description: '基础防御力',
            });
            expect(targetData.装备库[1].物品列表[0].description).toBe('简单的皮甲');
        });
    });

    describe('不应该修改的情况', () => {
        it('不应该将普通数组中的元素误认为是描述', () => {
            const initData = {
                数值数组: [1, 2],
                坐标: [100, 200],
                混合数组: [1, 2, 3, 4, 5],
                文本数组: ['apple', 'banana', 'orange'],
            };
            const msgData = {
                数值数组: [3, 4],
                坐标: [150, 250],
                混合数组: [6, 7, 8, 9, 10],
                文本数组: ['pear', 'grape', 'mango'],
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            // 普通数组应该保持 merge 后的结果，不应该将第二个元素替换
            expect(targetData.数值数组).toEqual([3, 4]);
            expect(targetData.坐标).toEqual([150, 250]);
            expect(targetData.混合数组).toEqual([6, 7, 8, 9, 10]);
            expect(targetData.文本数组).toEqual(['pear', 'grape', 'mango']);
        });

        it('不应该修改长度不为2的数组', () => {
            const initData = {
                空数组: [],
                单元素数组: [100],
                三元素数组: [1, 2, 3],
                多元素数组: [10, 20, 30, 40, 50],
            };
            const msgData = {
                空数组: [1, 2],
                单元素数组: [200],
                三元素数组: [4, 5, 6],
                多元素数组: [60, 70, 80, 90, 100],
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            // 所有数组都应该保持 merge 后的结果
            expect(targetData.空数组).toEqual([1, 2]);
            expect(targetData.单元素数组).toEqual([200]);
            expect(targetData.三元素数组).toEqual([4, 5, 6]);
            expect(targetData.多元素数组).toEqual([60, 70, 80, 90, 100]);
        });

        it('不应该修改第二个元素不是字符串的数组', () => {
            const initData = {
                数字第二元素: [100, 200],
                布尔第二元素: ['value', true],
                对象第二元素: ['data', { key: 'value' }],
                数组第二元素: ['nested', [1, 2, 3]],
                null第二元素: ['something', null],
                undefined第二元素: ['something', undefined],
            };
            const msgData = {
                数字第二元素: [300, 400],
                布尔第二元素: ['newValue', false],
                对象第二元素: ['newData', { key: 'newValue' }],
                数组第二元素: ['newNested', [4, 5, 6]],
                null第二元素: ['newSomething', null],
                undefined第二元素: ['newSomething', undefined],
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            // 第二个元素不是字符串的数组不应该被处理为 ValueWithDescription
            expect(targetData.数字第二元素).toEqual([300, 400]);
            expect(targetData.布尔第二元素).toEqual(['newValue', false]);
            expect(targetData.对象第二元素).toEqual(['newData', { key: 'newValue' }]);
            expect(targetData.数组第二元素).toEqual(['newNested', [4, 5, 6]]);
            expect(targetData.null第二元素).toEqual(['newSomething', null]);
            expect(targetData.undefined第二元素).toEqual(['newSomething', undefined]);
        });

        it('不应该修改不包含 description 字段的对象', () => {
            const initData = {
                普通对象: {
                    name: '初始名称',
                    value: 100,
                    active: true,
                },
                嵌套对象: {
                    config: {
                        setting1: 'value1',
                        setting2: 123,
                    },
                },
            };
            const msgData = {
                普通对象: {
                    name: '更新名称',
                    value: 200,
                    active: false,
                },
                嵌套对象: {
                    config: {
                        setting1: 'value2',
                        setting2: 456,
                    },
                },
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            // 没有 description 字段的对象应该保持 merge 后的结果
            expect(targetData.普通对象).toEqual({
                name: '更新名称',
                value: 200,
                active: false,
            });
            expect(targetData.嵌套对象).toEqual({
                config: {
                    setting1: 'value2',
                    setting2: 456,
                },
            });
        });

        it('应该区分真正的 ValueWithDescription 和普通的两元素数组', () => {
            const initData = {
                真正的描述: [100, '这是一个描述'],
                坐标数组: [10, 20],
                范围数组: [0, 100],
                混合场景: {
                    属性值: [50, '属性的描述'],
                    位置: [30, 40],
                    配置: {
                        选项: [1, '选项说明'],
                        边界: [5, 15],
                    },
                },
            };
            const msgData = {
                真正的描述: [200, '更新的描述'],
                坐标数组: [50, 60],
                范围数组: [10, 90],
                混合场景: {
                    属性值: [75, '更新的属性描述'],
                    位置: [70, 80],
                    配置: {
                        选项: [2, '更新的选项说明'],
                        边界: [20, 25],
                    },
                },
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            // 真正的 ValueWithDescription（第二个元素是字符串）应该被更新
            expect(targetData.真正的描述).toEqual([200, '这是一个描述']);
            expect(targetData.混合场景.属性值).toEqual([75, '属性的描述']);
            expect(targetData.混合场景.配置.选项).toEqual([2, '选项说明']);

            // 普通的两元素数组不应该被修改
            expect(targetData.坐标数组).toEqual([50, 60]);
            expect(targetData.范围数组).toEqual([10, 90]);
            expect(targetData.混合场景.位置).toEqual([70, 80]);
            expect(targetData.混合场景.配置.边界).toEqual([20, 25]);
        });

        it('不应该修改原始类型的值', () => {
            const initData = {
                字符串: '初始文本',
                数字: 100,
                布尔值: true,
                空值: null,
                未定义: undefined,
            };
            const msgData = {
                字符串: '更新文本',
                数字: 200,
                布尔值: false,
                空值: null,
                未定义: undefined,
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            // 原始类型应该保持 merge 后的结果
            expect(targetData.字符串).toBe('更新文本');
            expect(targetData.数字).toBe(200);
            expect(targetData.布尔值).toBe(false);
            expect(targetData.空值).toBe(null);
            expect(targetData.未定义).toBe(undefined);
        });
    });
});
