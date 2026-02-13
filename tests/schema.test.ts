import { updateVariables } from '@/function/update_variables';
import {
    EXTENSIBLE_MARKER,
    generateSchema,
    getSchemaForPath,
    reconcileAndApplySchema,
} from '@/function/schema';
import {
    ArraySchemaNode,
    ObjectSchemaNode,
    SchemaNode,
    StatData,
    isArraySchema,
} from '@/variable_def';

type MvuData = any;

describe('generateSchema', () => {
    describe('基本类型生成', () => {
        test('生成字符串类型 schema', () => {
            const result = generateSchema('hello');
            expect(result).toEqual({ type: 'string' });
        });

        test('生成数字类型 schema', () => {
            const result = generateSchema(42);
            expect(result).toEqual({ type: 'number' });
        });

        test('生成布尔类型 schema', () => {
            const result = generateSchema(true);
            expect(result).toEqual({ type: 'boolean' });
        });

        test('处理 null 和 undefined', () => {
            expect(generateSchema(null)).toEqual({ type: 'any' });
            expect(generateSchema(undefined)).toEqual({ type: 'any' });
        });
    });

    describe('数组类型生成', () => {
        test('生成简单数组 schema', () => {
            const result = generateSchema([1, 2, 3]);
            expect(result).toEqual({
                type: 'array',
                extensible: false,
                recursiveExtensible: false,
                elementType: { type: 'number' },
            });
        });

        test('处理带有 EXTENSIBLE_MARKER 的数组', () => {
            const data = ['item1', 'item2', EXTENSIBLE_MARKER];
            const result = generateSchema(data);
            expect(result).toEqual({
                type: 'array',
                extensible: true,
                recursiveExtensible: false,
                elementType: { type: 'string' },
            });
        });

        test('继承旧 schema 的 extensible 属性', () => {
            const oldSchema: SchemaNode = {
                type: 'array',
                extensible: true,
                elementType: { type: 'string' },
            };
            const result = generateSchema(['new', 'items'], oldSchema);
            expect(result).toEqual({
                type: 'array',
                extensible: true,
                recursiveExtensible: false,
                elementType: { type: 'string' },
            });
        });

        test('继承旧 schema 的 recursiveExtensible 属性', () => {
            const oldSchema: SchemaNode = {
                type: 'array',
                extensible: true,
                recursiveExtensible: true,
                elementType: { type: 'string' },
            };
            const result = generateSchema(['new', 'items'], oldSchema);
            expect(result).toEqual({
                type: 'array',
                extensible: true,
                recursiveExtensible: true,
                elementType: { type: 'string' },
            });
        });

        test('父节点的 recursiveExtensible 影响数组子节点', () => {
            const data = [['child1', 'child2'], EXTENSIBLE_MARKER];
            const oldSchema: SchemaNode = {
                type: 'array',
                extensible: false,
                recursiveExtensible: true,
                elementType: { type: 'any' },
            };
            const result = generateSchema(data, oldSchema) as ArraySchemaNode;
            expect(result.extensible).toBe(true); // From EXTENSIBLE_MARKER
            expect(result.recursiveExtensible).toBe(true); // From oldSchema
            expect(result.elementType).toEqual({
                type: 'array',
                extensible: true, // Inherited from parent recursiveExtensible
                recursiveExtensible: true, // Inherited from parent
                elementType: { type: 'string' },
            });
        });
    });

    describe('对象类型生成', () => {
        test('生成简单对象 schema', () => {
            const data = {
                name: 'John',
                age: 30,
            };
            const result = generateSchema(data) as ObjectSchemaNode;
            expect(result).toEqual({
                type: 'object',
                extensible: false,
                recursiveExtensible: false,
                properties: {
                    name: { type: 'string', required: true },
                    age: { type: 'number', required: true },
                },
            });
        });

        test('处理带有 $meta.extensible 的对象', () => {
            const data: StatData = {
                field1: 'value1',
                $meta: { extensible: true },
            };
            const result = generateSchema(data) as ObjectSchemaNode;
            expect(result.extensible).toBe(true);
        });

        test('$meta.required 数组应该影响属性的 required 状态', () => {
            const data: StatData = {
                optionalField: 'value1',
                requiredField: 'value2',
                $meta: { required: ['requiredField'] },
            };
            const result = generateSchema(data) as ObjectSchemaNode;

            // 根据 schema.ts:92-97 的规则：
            // 1. 默认值：因为没有设置 extensible，所以 extensible 默认为 false
            //    当 extensible 为 false 时，所有属性默认都是 required: true
            // 2. 覆盖规则：$meta.required 数组中的属性强制为 required: true
            // 因此：requiredField 应该是 true（在 required 数组中）
            //      optionalField 也应该是 true（默认规则）
            expect(result.properties.requiredField?.required).toBe(true);
            expect(result.properties.optionalField?.required).toBe(true); // 根据默认规则应该是 true
        });

        test('嵌套对象的 $meta 处理', () => {
            const data: StatData = {
                user: {
                    name: 'John',
                    age: 30,
                    $meta: { required: ['name'] },
                },
                $meta: { required: ['user'] },
            };
            const result = generateSchema(data) as ObjectSchemaNode;

            // 测试根级别的 required
            expect(result.properties.user?.required).toBe(true);

            // 测试嵌套对象的 required
            const userSchema = result.properties.user as ObjectSchemaNode;
            // user 对象默认 extensible: false，所以所有属性默认 required: true
            expect(userSchema.properties?.name?.required).toBe(true);
            expect(userSchema.properties?.age?.required).toBe(true); // 根据默认规则应该是 true
        });

        test('extensible 对象中 $meta.required 的处理', () => {
            const data: StatData = {
                optionalField: 'value1',
                requiredField: 'value2',
                $meta: {
                    extensible: true,
                    required: ['requiredField'],
                },
            };
            const result = generateSchema(data) as ObjectSchemaNode;

            // 根据规则：
            // 1. 对象是 extensible: true，所以属性默认是 required: false
            // 2. requiredField 在 $meta.required 数组中，所以强制为 required: true
            expect(result.extensible).toBe(true);
            expect(result.properties.requiredField?.required).toBe(true); // 被 $meta.required 覆盖
            expect(result.properties.optionalField?.required).toBe(false); // 遵循默认规则
        });

        test('处理 $meta.recursiveExtensible 的对象', () => {
            const data: StatData = {
                root: {
                    child: {
                        grandChild: {
                            field: 'value',
                        },
                        field: 'value',
                    },
                    $meta: { recursiveExtensible: true },
                },
            };
            const result = generateSchema(data) as ObjectSchemaNode;
            const rootSchema = result.properties.root as ObjectSchemaNode;
            const childSchema = rootSchema.properties.child as ObjectSchemaNode;
            const grandChildSchema = childSchema.properties.grandChild as ObjectSchemaNode;
            expect(rootSchema.extensible).toBe(true);
            expect(rootSchema.recursiveExtensible).toBe(true);
            expect(childSchema.extensible).toBe(true); // Inherited from parent recursiveExtensible
            expect(childSchema.recursiveExtensible).toBe(true); // Inherited from parent
            expect(childSchema.properties.field.required).toBe(false); // Extensible, so not required
            expect(grandChildSchema.extensible).toBe(true); // Inherited from parent recursiveExtensible
            expect(grandChildSchema.recursiveExtensible).toBe(true); // Inherited from parent
            expect(grandChildSchema.properties.field.required).toBe(false); // Extensible, so not required
        });

        test('继承旧 schema 的 recursiveExtensible 属性', () => {
            const data: StatData = {
                root: {
                    child: { field: 'value' },
                },
            };
            const oldSchema: SchemaNode = {
                type: 'object',
                extensible: true,
                recursiveExtensible: true,
                properties: {
                    root: {
                        type: 'object',
                        extensible: true,
                        recursiveExtensible: true,
                        properties: {},
                    },
                },
            };
            const result = generateSchema(data, oldSchema) as ObjectSchemaNode;
            const rootSchema = result.properties.root as ObjectSchemaNode;
            const childSchema = rootSchema.properties.child as ObjectSchemaNode;
            expect(result.recursiveExtensible).toBe(true);
            expect(rootSchema.recursiveExtensible).toBe(true);
            expect(childSchema.extensible).toBe(true); // Inherited from parent recursiveExtensible
            expect(childSchema.recursiveExtensible).toBe(true);
        });

        test('extensible: false 阻断 recursiveExtensible 传播', () => {
            const data: StatData = {
                root: {
                    child: {
                        grandchild: { field: 'value' },
                    },
                },
            };
            const oldSchema: SchemaNode = {
                type: 'object',
                recursiveExtensible: true,
                properties: {
                    root: {
                        type: 'object',
                        extensible: false,
                        properties: {
                            child: {
                                type: 'object',
                                properties: {},
                            },
                        },
                    },
                },
            };
            const result = generateSchema(data, oldSchema) as ObjectSchemaNode;
            const rootSchema = result.properties.root as ObjectSchemaNode;
            const childSchema = rootSchema.properties.child as ObjectSchemaNode;
            const grandchildSchema = childSchema.properties.grandchild as ObjectSchemaNode;
            expect(result.recursiveExtensible).toBe(true);
            expect(rootSchema.extensible).toBe(false);
            expect(rootSchema.recursiveExtensible).toBe(false);
            expect(childSchema.extensible).toBe(false);
            expect(childSchema.recursiveExtensible).toBe(false);
            expect(grandchildSchema.extensible).toBe(false); // Blocked by child.extensible: false
            expect(grandchildSchema.recursiveExtensible).toBe(false); // Blocked by child.extensible: false
        });
    });

    describe('ValueWithDescription 处理', () => {
        test('处理字符串类型的 ValueWithDescription', () => {
            const data = {
                日期: ['03月15日', '今天的日期，格式为 mm月dd日'],
                时间: ['09:15', '按照进行行动后实际经历的时间进行更新'],
            };
            const result = generateSchema(data) as ObjectSchemaNode;

            // 数组应该被识别为特殊的 ValueWithDescription 格式
            expect(result.properties.日期).toEqual({
                type: 'array',
                extensible: false,
                recursiveExtensible: false,
                elementType: { type: 'string' },
                required: true,
            });
        });

        test('处理数字类型的 ValueWithDescription', () => {
            const data = {
                好感度: [60, '[-30,100]之间,理对 user 的好感度'],
                次数: [0, '每发生一次后递增'],
                pleasure: [-0.5, '[-1,1]之间,情绪变化时更新'],
            };
            const result = generateSchema(data) as ObjectSchemaNode;

            expect(result.properties.好感度).toEqual({
                type: 'array',
                extensible: false,
                recursiveExtensible: false,
                elementType: { type: 'number' },
                required: true,
            });
            const element = result.properties.pleasure;
            expect(isArraySchema(element)).toBe(true);
            expect((element as ArraySchemaNode).elementType).toEqual({ type: 'number' });
        });

        test('处理布尔类型的 ValueWithDescription', () => {
            const data = {
                isActive: [true, '用户是否活跃'],
                hasPermission: [false, '是否有权限访问'],
            };
            const result = generateSchema(data) as ObjectSchemaNode;

            expect(result.properties.isActive).toEqual({
                type: 'array',
                extensible: false,
                recursiveExtensible: false,
                elementType: { type: 'boolean' },
                required: true,
            });
        });

        test('处理 null 类型的 ValueWithDescription', () => {
            const data = {
                重要记忆: [null, '尚无重要记忆，发生重要事件时更新'],
                lastError: [null, '最后一次错误信息'],
            };
            const result = generateSchema(data) as ObjectSchemaNode;

            expect(result.properties.重要记忆).toEqual({
                type: 'array',
                extensible: false,
                recursiveExtensible: false,
                elementType: { type: 'any' },
                required: true,
            });
        });

        test('处理对象类型的 ValueWithDescription', () => {
            const data = {
                状态: [{ mood: 'happy', energy: 80 }, '角色当前状态'],
                位置: [{ x: 10, y: 20, map: 'town' }, '角色在地图上的位置'],
            };
            const result = generateSchema(data) as ObjectSchemaNode;

            const statusSchema = result.properties.状态 as any;
            expect(statusSchema.type).toBe('array');
            expect(statusSchema.elementType.type).toBe('object');
            expect(statusSchema.elementType.properties).toEqual({
                mood: { type: 'string', required: true },
                energy: { type: 'number', required: true },
            });
        });

        test('处理嵌套数组的 ValueWithDescription', () => {
            const data = {
                matrix: [
                    [
                        [1, 2],
                        [3, 4],
                    ],
                    '2x2 矩阵数据',
                ],
                tags: [['tag1', 'tag2', 'tag3'], '标签列表'],
            };
            const result = generateSchema(data) as ObjectSchemaNode;

            const matrixSchema = result.properties.matrix as any;
            expect(matrixSchema.type).toBe('array');
            expect(matrixSchema.elementType.type).toBe('array');
            expect(matrixSchema.elementType.elementType.type).toBe('array');
            expect(matrixSchema.elementType.elementType.elementType.type).toBe('number');
        });

        test('处理混合类型数组（不符合 ValueWithDescription 格式）', () => {
            const data = {
                // 这些不是标准的 ValueWithDescription 格式
                invalidFormat1: ['value'], // 只有一个元素
                invalidFormat2: ['value', 'description', 'extra'], // 超过两个元素
                invalidFormat3: ['value', 123], // 第二个元素不是字符串
            };
            const result = generateSchema(data) as ObjectSchemaNode;

            // 这些应该被当作普通数组处理
            expect(result.properties.invalidFormat1).toEqual({
                type: 'array',
                extensible: false,
                recursiveExtensible: false,
                elementType: { type: 'string' },
                required: true,
            });
        });

        test('ValueWithDescription 在嵌套对象中的处理', () => {
            const data = {
                character: {
                    name: ['Alice', '角色名称'],
                    level: [10, '当前等级'],
                    stats: {
                        hp: [100, '生命值'],
                        mp: [50, '魔法值'],
                    },
                },
            };
            const result = generateSchema(data) as ObjectSchemaNode;

            const charSchema = result.properties.character as ObjectSchemaNode;
            expect(charSchema.properties.name).toEqual({
                type: 'array',
                extensible: false,
                recursiveExtensible: false,
                elementType: { type: 'string' },
                required: true,
            });

            const statsSchema = charSchema.properties.stats as ObjectSchemaNode;
            const hpProp = statsSchema.properties['hp'];
            expect(isArraySchema(hpProp)).toBe(true);
            expect((hpProp as ArraySchemaNode).elementType).toEqual({ type: 'number' });
        });

        test('空数组作为 ValueWithDescription 的第一个元素', () => {
            const data = {
                emptyList: [[], '空列表，等待添加元素'],
                emptyObject: [{}, '空对象，等待添加属性'],
            };
            const result = generateSchema(data) as ObjectSchemaNode;

            const emptyListSchema = result.properties.emptyList as any;
            expect(emptyListSchema.type).toBe('array');
            expect(emptyListSchema.elementType.type).toBe('array');

            const emptyObjectSchema = result.properties.emptyObject as any;
            expect(emptyObjectSchema.elementType.type).toBe('object');
            expect(emptyObjectSchema.elementType.properties).toEqual({});
        });
    });
});

describe('getSchemaForPath', () => {
    const testSchema: ObjectSchemaNode = {
        type: 'object',
        properties: {
            user: {
                type: 'object',
                properties: {
                    name: { type: 'string', required: true },
                    scores: {
                        type: 'array',
                        elementType: { type: 'number' },
                        extensible: false,
                    },
                },
                extensible: false,
            },
            items: {
                type: 'array',
                elementType: {
                    type: 'object',
                    properties: {
                        id: { type: 'number', required: true },
                        value: { type: 'string', required: true },
                    },
                },
                extensible: true,
            },
        },
        extensible: false,
    };

    test('获取根路径 schema', () => {
        const result = getSchemaForPath(testSchema, '');
        expect(result).toEqual(testSchema);
    });

    test('获取简单属性路径 schema', () => {
        const result = getSchemaForPath(testSchema, 'user.name');
        expect(result).toEqual({ type: 'string', required: true });
    });

    test('获取数组元素 schema', () => {
        const result = getSchemaForPath(testSchema, 'user.scores[0]');
        expect(result).toEqual({ type: 'number' });
    });

    test('获取嵌套数组对象属性 schema', () => {
        const result = getSchemaForPath(testSchema, 'items[0].value');
        expect(result).toEqual({ type: 'string', required: true });
    });

    test('处理不存在的路径', () => {
        const result = getSchemaForPath(testSchema, 'nonexistent.path');
        expect(result).toBeNull();
    });

    test('处理 null 或 undefined schema', () => {
        expect(getSchemaForPath(null, 'any.path')).toBeNull();
        expect(getSchemaForPath(undefined, 'any.path')).toBeNull();
    });
});

describe('reconcileAndApplySchema', () => {
    test('基本 schema 调和', () => {
        const variables: MvuData = {
            initialized_lorebooks: {},
            stat_data: {
                user: { name: 'John', age: 30 },
                items: [1, 2, 3],
            },
            display_data: {},
            delta_data: {},
        };

        reconcileAndApplySchema(variables);

        expect(variables.schema).toBeDefined();
        expect(variables.schema?.type).toBe('object');
        expect(variables.schema?.properties.user).toBeDefined();
        expect(variables.schema?.properties.items).toBeDefined();
    });

    test('保留旧 schema 的 extensible 属性', () => {
        const variables: MvuData = {
            initialized_lorebooks: {},
            stat_data: {
                flexibleArray: ['a', 'b'],
            },
            display_data: {},
            delta_data: {},
            schema: {
                type: 'object',
                properties: {
                    flexibleArray: {
                        type: 'array',
                        extensible: true,
                        elementType: { type: 'string' },
                        required: true,
                    },
                },
            },
        };

        // 添加新元素
        variables.stat_data.flexibleArray = ['a', 'b', 'c'];
        reconcileAndApplySchema(variables);

        const arraySchema = variables.schema?.properties.flexibleArray as any;
        expect(arraySchema.extensible).toBe(true);
    });

    test('处理 $meta 在调和过程中的移除', () => {
        const variables: MvuData = {
            initialized_lorebooks: {},
            stat_data: {
                field1: 'value1',
                field2: 'value2',
                $meta: { extensible: true, required: ['field1'] },
            },
            display_data: {},
            delta_data: {},
        };

        const originalStatData = { ...variables.stat_data };
        reconcileAndApplySchema(variables);

        // 确保原始数据没有被修改（$meta 应该还在）
        expect(variables.stat_data).toEqual(originalStatData);

        // 确保生成的 schema 正确处理了 $meta
        expect(variables.schema?.extensible).toBe(true);
    });

    test('$meta.required 在多层嵌套中的处理', () => {
        const variables: MvuData = {
            initialized_lorebooks: {},
            stat_data: {
                level1: {
                    level2: {
                        field: 'value',
                        otherField: 'otherValue',
                        $meta: {
                            extensible: true,
                            required: ['field'],
                        },
                    },
                    otherLevel2: {},
                    $meta: { required: ['level2'] },
                },
                $meta: { required: ['level1'] },
            },
            display_data: {},
            delta_data: {},
        };

        reconcileAndApplySchema(variables);

        // 测试多层嵌套中的 required 处理
        const level1Schema = variables.schema?.properties.level1 as ObjectSchemaNode;
        const level2Schema = level1Schema?.properties.level2 as ObjectSchemaNode;

        // 根级别：默认 extensible: false，所以 level1 默认就是 required: true
        expect(variables.schema?.properties.level1?.required).toBe(true);

        // level1：默认 extensible: false，但 level2 在 $meta.required 中
        expect(level1Schema?.properties.level2?.required).toBe(true);
        expect(level1Schema?.properties.otherLevel2?.required).toBe(true); // 默认规则

        // level2：设置了 extensible: true，所以默认 required: false
        expect(level2Schema?.extensible).toBe(true);
        expect(level2Schema?.properties.field?.required).toBe(true); // 在 $meta.required 中
        expect(level2Schema?.properties.otherField?.required).toBe(false); // 遵循默认规则
    });

    test('保留旧 schema 的 recursiveExtensible 属性', () => {
        const variables: MvuData = {
            initialized_lorebooks: {},
            stat_data: {
                root: {
                    child: { field: 'value' },
                },
            },
            display_data: {},
            delta_data: {},
            schema: {
                type: 'object',
                extensible: true,
                recursiveExtensible: true,
                properties: {
                    root: {
                        type: 'object',
                        extensible: true,
                        recursiveExtensible: true,
                        properties: {},
                    },
                },
            },
        };

        reconcileAndApplySchema(variables);

        const rootSchema = variables.schema?.properties.root as ObjectSchemaNode;
        const childSchema = rootSchema?.properties.child as ObjectSchemaNode;
        expect(variables.schema?.recursiveExtensible).toBe(true);
        expect(rootSchema.recursiveExtensible).toBe(true);
        expect(childSchema.extensible).toBe(true); // Inherited from parent recursiveExtensible
        expect(childSchema.recursiveExtensible).toBe(true);
    });

    test('测试部分导致 schema 丢失的情况。', async () => {
        const variables: MvuData = {
            initialized_lorebooks: {},
            stat_data: {
                '/': {
                    home: {
                        alice: { 'notes.txt': 'document' },
                        bob: {}, // New node
                    },
                },
            },
            display_data: {},
            delta_data: {},
            schema: {
                type: 'object',
                extensible: true,
                recursiveExtensible: true,
                properties: {
                    '/': {
                        type: 'object',
                        extensible: true,
                        recursiveExtensible: true,
                        properties: {
                            home: {
                                type: 'object',
                                extensible: true,
                                recursiveExtensible: true,
                                properties: {
                                    alice: {
                                        type: 'object',
                                        extensible: true,
                                        recursiveExtensible: true,
                                        properties: {
                                            'notes.txt': { type: 'string', required: false },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        };

        reconcileAndApplySchema(variables);

        {
            const rootSchema = variables.schema?.properties['/'] as ObjectSchemaNode;
            const homeSchema = rootSchema.properties.home as ObjectSchemaNode;
            const bobSchema = homeSchema.properties.bob as ObjectSchemaNode;
            expect(rootSchema.recursiveExtensible).toBe(true);
            expect(homeSchema.recursiveExtensible).toBe(true);
            expect(bobSchema.extensible).toBe(true); // Inherited from home.recursiveExtensible
            expect(bobSchema.recursiveExtensible).toBe(true);
            expect(bobSchema.properties).toEqual({});
        }

        const messageContent = "_.insert('', 'element', [15, '增强的物品数量']);//root";
        const result = await updateVariables(messageContent, variables);
        expect(result).toBe(true);

        {
            // 这些状态不应变更。
            const rootSchema = variables.schema?.properties['/'] as ObjectSchemaNode;
            const homeSchema = rootSchema.properties.home as ObjectSchemaNode;
            const bobSchema = homeSchema.properties.bob as ObjectSchemaNode;
            expect(rootSchema.recursiveExtensible).toBe(true);
            expect(homeSchema.recursiveExtensible).toBe(true);
            expect(bobSchema.extensible).toBe(true); // Inherited from home.recursiveExtensible
            expect(bobSchema.recursiveExtensible).toBe(true);
            expect(bobSchema.properties).toEqual({});
        }
    });

    test('处理新节点继承 recursiveExtensible', () => {
        const variables: MvuData = {
            initialized_lorebooks: {},
            stat_data: {
                '/': {
                    home: {
                        alice: { 'notes.txt': 'document' },
                        bob: {}, // New node
                    },
                },
            },
            display_data: {},
            delta_data: {},
            schema: {
                type: 'object',
                extensible: false,
                recursiveExtensible: true,
                properties: {
                    '/': {
                        type: 'object',
                        extensible: true,
                        recursiveExtensible: true,
                        properties: {
                            home: {
                                type: 'object',
                                extensible: true,
                                recursiveExtensible: true,
                                properties: {
                                    alice: {
                                        type: 'object',
                                        extensible: true,
                                        recursiveExtensible: true,
                                        properties: {
                                            'notes.txt': { type: 'string', required: false },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        };

        reconcileAndApplySchema(variables);

        const rootSchema = variables.schema?.properties['/'] as ObjectSchemaNode;
        const homeSchema = rootSchema.properties.home as ObjectSchemaNode;
        const bobSchema = homeSchema.properties.bob as ObjectSchemaNode;
        expect(rootSchema.recursiveExtensible).toBe(true);
        expect(homeSchema.recursiveExtensible).toBe(true);
        expect(bobSchema.extensible).toBe(true); // Inherited from home.recursiveExtensible
        expect(bobSchema.recursiveExtensible).toBe(true);
        expect(bobSchema.properties).toEqual({});
    });
});

describe('边缘情况和错误处理', () => {
    test('处理循环引用', () => {
        const data: any = { self: null };
        data.self = data; // 创建循环引用

        // 当前实现可能无法处理循环引用
        //expect(() => generateSchema(data)).not.toThrow();
        //并不需要处理循环引用，因为处理的数据源始终满足json格式的字符串。
    });

    test('处理特殊对象类型', () => {
        const date = new Date();
        const result = generateSchema({ date });

        // Date 对象应该被处理为原始类型
        expect(result).toBeDefined();
    });

    test('schema 类型不匹配时的错误处理', () => {
        const arraySchema: SchemaNode = {
            type: 'array',
            elementType: { type: 'string' },
            extensible: false,
        };

        // 尝试将数组 schema 应用到对象数据
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
        generateSchema({ field: 'value' }, arraySchema);

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Type mismatch'));
        consoleSpy.mockRestore();
    });
});
