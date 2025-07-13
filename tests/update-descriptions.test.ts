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
                    description: '这是初始描述'
                }
            };
            const msgData = {
                属性: {
                    value: 200,
                    description: '这是旧描述'
                }
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
                        description: '初始武器描述'
                    },
                    防具: {
                        name: '盾',
                        description: '初始防具描述'
                    }
                }
            };
            const msgData = {
                装备: {
                    武器: {
                        name: '大剑',
                        description: '旧武器描述',
                        damage: 100
                    },
                    防具: {
                        name: '重盾',
                        description: '旧防具描述',
                        defense: 50
                    }
                }
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
                    description: '初始描述'
                }
            };
            const msgData = {
                其他: {
                    value: 123
                }
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
                魔法值: [50, '初始魔法值描述']
            };
            const msgData = {
                生命值: [200, '旧生命值描述'],
                魔法值: [80, '旧魔法值描述']
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
                        description: '对象内的描述'
                    },
                    '外层描述'
                ]
            };
            const msgData = {
                复杂属性: [
                    {
                        value: 200,
                        description: '旧的对象内描述',
                        extra: 'new field'
                    },
                    '旧的外层描述'
                ]
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
                        攻击力: [10, '武器攻击力加成']
                    }
                }
            };
            const msgData = {
                装备: {
                    武器: ['枪', '旧武器'],
                    属性加成: {
                        攻击力: [20, '旧的攻击力加成'],
                        暴击率: [5, '新增的暴击率'] // msgData 中新增
                    }
                }
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
                        description: '普通攻击初始描述'
                    },
                    {
                        name: '防御',
                        defense: 30,
                        description: '防御技能初始描述'
                    }
                ]
            };
            const msgData = {
                技能: [
                    {
                        name: '攻击',
                        damage: 60,
                        description: '普通攻击旧描述',
                        cooldown: 5 // 新增属性
                    },
                    {
                        name: '防御',
                        defense: 40,
                        description: '防御技能旧描述'
                    },
                    {
                        name: '治疗',
                        heal: 30,
                        description: '治疗技能描述' // msgData 中新增的技能
                    }
                ]
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
                        description: '火系法术'
                    }
                ]
            };
            const msgData = {
                技能列表: [
                    {
                        name: '火球术',
                        damage: [80, '旧的伤害描述'],
                        description: '旧的火系法术描述',
                        mana: 20 // 新增
                    }
                ]
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
                        { value: 2, description: '第二个元素' }
                    ]
                ]
            };
            const msgData = {
                矩阵: [
                    [
                        { value: 10, description: '旧的第一个' },
                        { value: 20, description: '旧的第二个' }
                    ]
                ]
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
                    description: '这是初始描述'
                },
                生命值: [100, '初始生命值'],
                技能: [{
                    name: '攻击',
                    damage: [50, '基础伤害'],
                    description: '普通攻击'
                }],
                装备: {
                    武器: ['剑', '初始武器'],
                    属性加成: {
                        攻击力: [10, '武器攻击力加成']
                    }
                }
            };
            const msgData = {
                属性: {
                    value: 200,
                    description: '旧描述',
                    level: 5 // 新增
                },
                生命值: [150, '旧生命值'],
                技能: [{
                    name: '攻击',
                    damage: [70, '旧伤害'],
                    description: '旧攻击描述'
                }],
                装备: {
                    武器: ['枪', '旧武器'],
                    属性加成: {
                        攻击力: [15, '旧攻击力加成'],
                        防御力: [5, '新增防御力'] // 新增
                    },
                    饰品: { // 新增
                        name: '戒指',
                        description: '魔法戒指'
                    }
                }
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
                    description: '这个功能在新版本中被移除了'
                },
                技能: [
                    { name: '技能1', description: '初始技能1' },
                    { name: '技能2', description: '初始技能2' },
                    { name: '技能3', description: '初始技能3' }
                ]
            };
            const msgData = {
                技能: [
                    { name: '技能1', description: '旧技能1' },
                    { name: '技能2', description: '旧技能2' }
                    // 没有技能3
                ],
                新功能: {
                    description: '这是新增的功能'
                }
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
                    description: 123
                },
                正常属性: {
                    description: '正常的描述'
                }
            };
            const msgData = {
                空对象: { value: 1 },
                空数组: [1, 2, 3],
                只有一个元素的数组: ['something'],
                description不是字符串: {
                    description: 456
                },
                正常属性: {
                    description: '会被替换的描述',
                    value: 100
                }
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
                属性2: [200, '描述']
            };
            const msgData = {
                属性1: [150], // 只有一个元素
                属性2: [250, '旧描述', '额外元素'] // 有三个元素
            };
            const targetData = _.merge(_.cloneDeep(initData), msgData);

            updateDescriptions('', initData, msgData, targetData);

            // 长度不匹配时不更新
            expect(targetData.属性1).toEqual([150, '描述']); // 保持 merge 后的结果
            expect(targetData.属性2).toEqual([250, '旧描述', '额外元素']);
        });
    });
});
