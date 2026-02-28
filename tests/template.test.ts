import { beforeEach, describe, expect, it } from '@jest/globals';
import { applyTemplate, updateVariables } from '@/function/update_variables';
import {
    cleanUpMetadata,
    EXTENSIBLE_MARKER,
    generateSchema,
    reconcileAndApplySchema,
} from '@/function/schema';
import { StatData } from '@/variable_def';

type MvuData = any;

describe('Template Feature', () => {
    describe('applyTemplate function', () => {
        it('should return original value when template is undefined', () => {
            const value = { name: 'test' };
            const result = applyTemplate(value, undefined);
            expect(result).toEqual(value);
        });

        it('should merge object template with object value', () => {
            const template: StatData = { defaultName: 'default', age: 18 };
            const value = { name: 'test', age: 20 };
            const result = applyTemplate(value, template);
            expect(result).toEqual({
                defaultName: 'default',
                name: 'test',
                age: 20, // value overrides template
            });
        });

        it('should merge array template with array value', () => {
            const template: StatData[] = [{ type: 'default' }];
            const value = [{ name: 'item1' }];
            const result = applyTemplate(value, template);
            expect(result).toEqual([{ name: 'item1' }, { type: 'default' }]);
        });

        it('should return original value when types mismatch', () => {
            const template: StatData = { defaultName: 'default' };
            const value = ['array'];
            const result = applyTemplate(value, template);
            expect(result).toEqual(value);
        });

        it('should return original value for primitive types', () => {
            const template: StatData = { defaultName: 'default' };
            const value = 'string';
            const result = applyTemplate(value, template);
            expect(result).toBe(value);
        });
    });

    describe('Schema generation with templates', () => {
        it('should preserve template in object schema from $meta', () => {
            const data: StatData = {
                $meta: {
                    template: { defaultProp: 'default' },
                },
                existingProp: 'value',
            };
            const schema = generateSchema(data);
            expect(schema.type).toBe('object');
            if (schema.type === 'object') {
                expect(schema.template).toEqual({ defaultProp: 'default' });
            }
        });

        it('should preserve template in array schema from metadata element', () => {
            const data = [
                { name: 'item1' },
                { $meta: { template: { defaultType: 'default' } }, $arrayMeta: true },
            ];
            const schema = generateSchema(data);
            expect(data.length).toBe(1); // Removed meta element after
            expect(schema.type).toBe('array');
            if (schema.type === 'array') {
                expect(schema.template).toEqual({ defaultType: 'default' });
            }
        });

        it('should inherit template from old schema', () => {
            const oldSchema = {
                type: 'object' as const,
                properties: {},
                template: { inherited: true },
            };
            const data: StatData = {
                newProp: 'value',
            };
            const schema = generateSchema(data, oldSchema);
            expect(schema.type).toBe('object');
            if (schema.type === 'object') {
                expect(schema.template).toEqual({ inherited: true });
            }
        });
    });

    describe('Metadata cleanup', () => {
        it('should NOT remove $meta from templates stored in schema', () => {
            // 创建一个包含嵌套 $meta 的模板
            const templateWithMeta = {
                $meta: { extensible: false },
                defaultName: 'test',
                nestedObj: {
                    $meta: { required: ['id'] },
                    id: null,
                },
            };

            // 创建数据，其中 template 是对上面对象的引用
            const data: StatData = {
                $meta: {
                    template: templateWithMeta,
                },
                existingProp: 'value',
            };

            // 生成 schema
            const schema = generateSchema(data);

            // 现在清理元数据
            cleanUpMetadata(data);

            // 验证 schema 中的 template 仍然包含 $meta
            expect(schema.type).toBe('object');
            if (schema.type === 'object' && schema.template && !Array.isArray(schema.template)) {
                expect(schema.template.$meta).toBeDefined();
                expect(schema.template.$meta).toEqual({ extensible: false });
                expect((schema.template as any).nestedObj.$meta).toBeDefined();
                expect((schema.template as any).nestedObj.$meta).toEqual({ required: ['id'] });
            }
        });
        it('should remove metadata element from arrays', () => {
            const data = [
                { name: 'item1' },
                { $meta: { template: { defaultType: 'default' } }, $arrayMeta: true },
                { name: 'item2' },
            ];
            cleanUpMetadata(data);
            expect(data).toEqual([{ name: 'item1' }, { name: 'item2' }]);
        });

        it('should remove $meta from objects', () => {
            const data: any = {
                $meta: { template: { default: true } },
                prop: 'value',
                nested: {
                    $meta: { extensible: true },
                    nestedProp: 'nestedValue',
                },
            };
            cleanUpMetadata(data);
            expect(data).toEqual({
                prop: 'value',
                nested: {
                    nestedProp: 'nestedValue',
                },
            });
        });
    });

    describe('Integration with assign/insert operations', () => {
        let variables: MvuData;

        beforeEach(() => {
            variables = {
                initialized_lorebooks: {},
                stat_data: {},
                display_data: {},
                delta_data: {},
            };
        });

        it('should apply template when assigning to array (2 args)', async () => {
            // 设置带模板的数组
            variables.stat_data = {
                items: [
                    { name: 'existing' },
                    {
                        $meta: {
                            template: { type: 'default', rarity: 'common' },
                            extensible: true,
                        },
                        $arrayMeta: true,
                    },
                ],
            };
            // 生成 schema
            reconcileAndApplySchema(variables);
            cleanUpMetadata(variables.stat_data);

            // 执行 assign 操作
            await updateVariables(`_.assign('items', {"name": "sword"});`, variables);

            // 验证模板是否被应用
            expect(variables.stat_data.items).toEqual([
                { name: 'existing' },
                { name: 'sword', type: 'default', rarity: 'common' },
            ]);
        });

        it('should apply template when assigning to array with index (3 args)', async () => {
            variables.stat_data = {
                items: [{ memori: 'nothing' }],
            };
            variables.schema = {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        elementType: { type: 'object', properties: {} },
                        extensible: true,
                        template: { type: 'weapon', damage: 10 },
                    },
                },
            };

            await updateVariables(`_.assign('items', 0, {"name": "dagger"});`, variables);

            expect(variables.stat_data.items).toEqual([
                { name: 'dagger', type: 'weapon', damage: 10 },
                { memori: 'nothing' },
            ]);
        });

        it('should apply template when assigning to object property (3 args)', async () => {
            variables.stat_data = {
                inventory: {},
            };
            variables.schema = {
                type: 'object',
                properties: {
                    inventory: {
                        type: 'object',
                        properties: {},
                        extensible: true,
                        template: { count: 1, stackable: true },
                    },
                },
            };

            await updateVariables(
                `_.assign('inventory', 'potion', {"name": "health potion"});`,
                variables
            );

            expect(variables.stat_data.inventory).toEqual({
                potion: { name: 'health potion', count: 1, stackable: true },
            });
        });

        it('should clean metadata for nested template insert and allow subsequent insert', async () => {
            variables.stat_data = {
                root: {
                    $meta: {
                        extensible: true,
                        template: {
                            $meta: {
                                extensible: true,
                            },
                        },
                    },
                },
            };

            reconcileAndApplySchema(variables);
            cleanUpMetadata(variables.stat_data);

            await updateVariables(`_.insert('root', 'new_node', {"owo": 123});`, variables);

            const rootData = variables.stat_data.root as any;
            expect(rootData.$meta).toBeUndefined();
            expect(rootData.new_node).toEqual({ owo: 123 });

            await updateVariables(`_.insert('root.new_node', 'tvt', "234");`, variables);

            expect((rootData.new_node as any).$meta).toBeUndefined();
            expect(rootData.new_node).toEqual({ owo: 123, tvt: '234' });
        });

        it('should clean metadata for nested template insert and allow subsequent insert', async () => {
            variables.stat_data = {
                root: {
                    $meta: {
                        extensible: true,
                        template: {
                            $meta: {
                                extensible: true,
                            },
                        },
                    },
                },
            };
            //因为两条指令放在一起执行，和分开执行是有区别的，因此需要额外一条同时运行的用例。

            reconcileAndApplySchema(variables);
            cleanUpMetadata(variables.stat_data);

            await updateVariables(
                `_.insert('root', 'new_node', {"owo": 123});
                                      _.insert('root.new_node', 'tvt', "234");`,
                variables
            );

            const rootData = variables.stat_data.root as any;
            expect(rootData.$meta).toBeUndefined();
            expect((variables.schema!.properties['root'] as any).extensible).toBe(true);
            expect((variables.schema as any).properties.root.properties.new_node.extensible).toBe(
                true
            );
            expect(rootData.new_node).toEqual({ owo: 123, tvt: '234' });
            expect((rootData.new_node as any).$meta).toBeUndefined();
        });

        it('should handle cascading inserts with nested templates after metadata cleanup', async () => {
            variables.stat_data = {
                root: {
                    $meta: {
                        extensible: true,
                        template: {
                            $meta: { extensible: true },
                            items: [
                                {
                                    $meta: {
                                        extensible: true,
                                        template: {
                                            $meta: { extensible: true },
                                            type: 'base',
                                            flag: false,
                                        },
                                    },
                                    $arrayMeta: true,
                                },
                            ],
                            config: {
                                $meta: {
                                    extensible: true,
                                    template: {
                                        level: 1,
                                        info: {
                                            $meta: { extensible: true },
                                            createdBy: 'system',
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            };

            reconcileAndApplySchema(variables);
            cleanUpMetadata(variables.stat_data);

            expect((variables.stat_data.root as any).$meta).toBeUndefined();

            await updateVariables(
                `_.insert('root', 'new_node', {"items": [], "config": {}});`,
                variables
            );

            const newNode = (variables.stat_data.root as any).new_node;
            expect(newNode.$meta).toBeUndefined();
            expect(newNode).toEqual({
                items: [],
                config: {},
            });

            await updateVariables(`_.insert('root.new_node.items', {"name": "first"});`, variables);

            expect(newNode).toEqual({
                items: [{ type: 'base', flag: false, name: 'first' }],
                config: {},
            });

            await updateVariables(
                `_.assign('root.new_node.items', 0, {"name": "priority"});`,
                variables
            );
            expect(newNode).toEqual({
                items: [
                    { type: 'base', flag: false, name: 'priority' },
                    { type: 'base', flag: false, name: 'first' },
                ],
                config: {},
            });

            await updateVariables(
                `_.insert('root.new_node.config', 'override', {"mode": "auto"});`,
                variables
            );
            expect(newNode).toEqual({
                items: [
                    { type: 'base', flag: false, name: 'priority' },
                    { type: 'base', flag: false, name: 'first' },
                ],
                config: {
                    override: {
                        level: 1,
                        info: {
                            createdBy: 'system',
                        },
                        mode: 'auto',
                    },
                },
            });
            expect(
                (variables.schema as any).properties.root.properties.new_node.properties.items
                    .extensible
            ).toBe(true);
            expect(
                (variables.schema as any).properties.root.properties.new_node.properties.config
                    .extensible
            ).toBe(true);

            const finalNode = (variables.stat_data.root as any).new_node;
            expect(JSON.stringify(finalNode)).not.toContain('$meta');
            expect(finalNode.items).toEqual([
                { name: 'priority', type: 'base', flag: false },
                { name: 'first', type: 'base', flag: false },
            ]);
            expect(finalNode.config).toEqual({
                override: {
                    mode: 'auto',
                    level: 1,
                    info: { createdBy: 'system' },
                },
            });
        });

        it('should handle cascading inserts with nested templates after metadata cleanup', async () => {
            //相似的，需要一个一起运行，而不是分步运行的版本。
            variables.stat_data = {
                root: {
                    $meta: {
                        extensible: true,
                        template: {
                            $meta: { extensible: true },
                            items: [
                                {
                                    $meta: {
                                        extensible: true,
                                        template: {
                                            $meta: { extensible: true },
                                            type: 'base',
                                            flag: false,
                                        },
                                    },
                                    $arrayMeta: true,
                                },
                            ],
                            config: {
                                $meta: {
                                    extensible: true,
                                    template: {
                                        level: 1,
                                        info: {
                                            $meta: { extensible: true },
                                            createdBy: 'system',
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            };

            reconcileAndApplySchema(variables);
            cleanUpMetadata(variables.stat_data);

            expect((variables.stat_data.root as any).$meta).toBeUndefined();

            await updateVariables(
                `_.insert('root', 'new_node', {"items": [], "config": {}});
                _.insert('root.new_node.items', {"name": "first"});
                _.assign('root.new_node.items', 0, {"name": "priority"});
                _.insert('root.new_node.config', 'override', {"mode": "auto"});`,
                variables
            );
            const newNode = (variables.stat_data.root as any).new_node;

            expect(
                (variables.schema as any).properties.root.properties.new_node.properties.items
                    .extensible
            ).toBe(true);
            expect(
                (variables.schema as any).properties.root.properties.new_node.properties.config
                    .extensible
            ).toBe(true);
            expect(newNode).toEqual({
                items: [
                    { type: 'base', flag: false, name: 'priority' },
                    { type: 'base', flag: false, name: 'first' },
                ],
                config: {
                    override: {
                        level: 1,
                        info: {
                            createdBy: 'system',
                        },
                        mode: 'auto',
                    },
                },
            });

            const finalNode = (variables.stat_data.root as any).new_node;
            expect(JSON.stringify(finalNode)).not.toContain('$meta');
            expect(finalNode.items).toEqual([
                { name: 'priority', type: 'base', flag: false },
                { name: 'first', type: 'base', flag: false },
            ]);
            expect(finalNode.config).toEqual({
                override: {
                    mode: 'auto',
                    level: 1,
                    info: { createdBy: 'system' },
                },
            });
        });

        it('should NOT apply template when merging objects (2 args)', async () => {
            variables.stat_data = {
                player: { level: 1 },
            };
            variables.schema = {
                type: 'object',
                properties: {
                    player: {
                        type: 'object',
                        properties: {},
                        extensible: true,
                        template: { defaultHP: 100 },
                    },
                },
            };

            await updateVariables(`_.assign('player', {"exp": 0});`, variables);

            // 不应该应用模板
            expect(variables.stat_data.player).toEqual({
                level: 1,
                exp: 0,
            });
        });

        it('should handle type mismatch between template and value', async () => {
            variables.stat_data = {
                items: [],
            };
            variables.schema = {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        elementType: { type: 'any' },
                        extensible: true,
                        template: { type: 'object template' }, // 对象模板
                    },
                },
            };

            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

            await updateVariables(
                `_.assign('items', ["array value"]);`, // 数组值
                variables
            );

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Template type mismatch')
            );
            expect(variables.stat_data.items).toEqual([['array value']]); // 未应用模板

            consoleSpy.mockRestore();
        });

        it('should apply template to multiple array elements', async () => {
            variables.stat_data = {
                items: [],
            };
            variables.schema = {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        elementType: { type: 'object', properties: {} },
                        extensible: true,
                        template: { category: 'item', sellable: true },
                    },
                },
            };

            await updateVariables(
                `_.assign('items', [{"name": "sword"}, {"name": "shield"}]);`,
                variables
            );

            expect(variables.stat_data.items).toEqual([[{ name: 'sword' }, { name: 'shield' }]]);
        });

        it('should not create object and apply template when target does not exist', async () => {
            variables.schema = {
                type: 'object',
                properties: {},
                extensible: true,
            };

            // 为不存在的路径设置模板
            variables.stat_data = {
                game: {
                    $meta: {
                        template: { initialized: true, version: '1.0' },
                    },
                },
            };
            reconcileAndApplySchema(variables);

            await updateVariables(
                `_.assign('game.settings', 'difficulty', {"level": "hard"});`,
                variables
            );

            expect(variables.stat_data).toEqual({
                game: {
                    $meta: {
                        template: { initialized: true, version: '1.0' },
                    },
                },
            });
        });
    });

    describe('Edge cases and special scenarios', () => {
        it('should handle nested $meta in template', () => {
            const data: StatData = {
                $meta: {
                    template: {
                        $meta: { extensible: true },
                        defaultProp: 'value',
                    },
                },
            };
            const schema = generateSchema(data);
            expect(schema.type).toBe('object');
            if (schema.type === 'object' && schema.template && !Array.isArray(schema.template)) {
                expect(schema.template.$meta).toEqual({ extensible: true });
                expect(schema.template.defaultProp).toBe('value');
            }
        });

        it('should NOT remove $meta from template when cleaning up metadata', () => {
            const data: StatData = {
                $meta: {
                    template: {
                        $meta: { extensible: false, required: ['name'] },
                        name: 'default',
                        value: 0,
                    },
                },
                existingData: 'test',
            };

            // Clone data to preserve original
            const clonedData = _.cloneDeep(data);

            // Generate schema (which internally calls cleanUpMetadata)
            const schema = generateSchema(clonedData);

            // Verify that template in schema still has $meta
            expect(schema.type).toBe('object');
            if (schema.type === 'object' && schema.template && !Array.isArray(schema.template)) {
                expect(schema.template.$meta).toBeDefined();
                expect(schema.template.$meta).toEqual({ extensible: false, required: ['name'] });
            }

            // Verify that $meta was removed from the data itself
            expect(clonedData.$meta).toBeUndefined();
            expect(clonedData.existingData).toBe('test');
        });

        it('should handle empty arrays and objects in templates', () => {
            const objectTemplate: StatData = {};
            const arrayTemplate: StatData[] = [];

            const result1 = applyTemplate({ name: 'test' }, objectTemplate);
            expect(result1).toEqual({ name: 'test' });

            const result2 = applyTemplate([1, 2], arrayTemplate);
            expect(result2).toEqual([1, 2]);
        });

        it('should handle any[] type template (like ValueWithDescription)', () => {
            // ValueWithDescription 风格的模板
            const template: any[] = ['default value', 'default description'];

            // 应用到类似的数组值
            const value = ['user value'];
            const result = applyTemplate(value, template);

            // 应该合并两个数组
            expect(result).toEqual(['user value', 'default value', 'default description']);
        });

        it('should apply any[] template in array assign operation', async () => {
            const variables: MvuData = {
                initialized_lorebooks: {},
                stat_data: {
                    attributes: [],
                },
                display_data: {},
                delta_data: {},
            };

            variables.schema = {
                type: 'object',
                properties: {
                    attributes: {
                        type: 'array',
                        elementType: { type: 'any' },
                        extensible: true,
                        template: ['default', 'This is a default attribute'], // ValueWithDescription 风格
                    },
                },
            };

            await updateVariables(`_.assign('attributes', ["strength"]);`, variables);

            expect(variables.stat_data.attributes).toEqual([
                ['strength', 'default', 'This is a default attribute'],
            ]);
        });

        it('should apply any[] template in array assign operation', async () => {
            const variables: MvuData = {
                initialized_lorebooks: {},
                stat_data: {
                    attributes: [],
                },
                display_data: {},
                delta_data: {},
            };

            variables.schema = {
                type: 'object',
                properties: {
                    attributes: {
                        type: 'array',
                        elementType: { type: 'any' },
                        extensible: true,
                        template: ['default', 'This is a default attribute'], // ValueWithDescription 风格
                    },
                },
            };

            await updateVariables(`_.assign('attributes', [["strength"]]);`, variables);

            expect(variables.stat_data.attributes).toEqual([
                [['strength'], 'default', 'This is a default attribute'],
            ]);
        });

        it('should handle complex any[] templates', () => {
            // 复杂的 any[] 模板，包含对象
            const template: any[] = [
                { type: 'default' },
                'description',
                { metadata: { version: 1 } },
            ];

            const value = [{ type: 'custom', value: 42 }];
            const result = applyTemplate(value, template);

            // 合并结果应该保留 value 的内容并补充 template 的其他元素
            expect(result).toEqual([
                { type: 'custom', value: 42 },
                { type: 'default' },
                'description',
                { metadata: { version: 1 } },
            ]);
        });

        it('should prepend literal value to array template', () => {
            // 当值是字面量，模板是数组时，将字面量插入到数组开头
            const template: any[] = ['description', { metadata: true }];

            // 数字字面量
            const result1 = applyTemplate(42, template);
            expect(result1).toEqual([42, 'description', { metadata: true }]);

            // 字符串字面量
            const result2 = applyTemplate('value', template);
            expect(result2).toEqual(['value', 'description', { metadata: true }]);

            // 布尔字面量
            const result3 = applyTemplate(true, template);
            expect(result3).toEqual([true, 'description', { metadata: true }]);
        });

        it('should apply literal-to-array-template in assign operation', async () => {
            const variables: MvuData = {
                initialized_lorebooks: {},
                stat_data: {
                    skills: [],
                },
                display_data: {},
                delta_data: {},
            };

            variables.schema = {
                type: 'object',
                properties: {
                    skills: {
                        type: 'array',
                        elementType: { type: 'any' },
                        extensible: true,
                        template: ['skill description', { level: 1, maxLevel: 10 }],
                    },
                },
            };

            // 插入字符串字面量
            await updateVariables(`_.assign('skills', "剑术");`, variables);

            expect(variables.stat_data.skills).toEqual([
                ['剑术', 'skill description', { level: 1, maxLevel: 10 }],
            ]);

            // 插入数字字面量
            await updateVariables(`_.assign('skills', 0, 100);`, variables);

            expect(variables.stat_data.skills).toEqual([
                [100, 'skill description', { level: 1, maxLevel: 10 }],
                ['剑术', 'skill description', { level: 1, maxLevel: 10 }],
            ]);
        });

        it('should not apply template for literal with non-array template', () => {
            // 当模板不是数组时，字面量值不应用模板
            const objectTemplate: StatData = { default: true };

            const result1 = applyTemplate(42, objectTemplate);
            expect(result1).toBe(42);

            const result2 = applyTemplate('text', objectTemplate);
            expect(result2).toBe('text');
        });
    });

    describe('Missing test cases from issue #22', () => {
        let variables: MvuData;

        beforeEach(() => {
            variables = {
                initialized_lorebooks: {},
                stat_data: {},
                display_data: {},
                delta_data: {},
            };
        });

        it('should NOT apply template when assigning to existing array element', async () => {
            // 根据 issue #22："当你操作一个已经存在的数组的已存在元素时，不会自动应用模板"
            variables.stat_data = {
                items: [
                    { name: 'sword', damage: 5 },
                    { name: 'shield', defense: 10 },
                ],
            };
            variables.schema = {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        elementType: {
                            type: 'object',
                            extensible: true,
                            properties: {},
                            template: { rarity: 'common', level: 1 },
                        },
                        extensible: true,
                        template: { rarity: 'common', level: 1 },
                    },
                },
            };

            // 使用 set 命令修改已存在的元素
            await updateVariables(`_.set('items[0].damage', 10);`, variables);

            // 不应该添加模板中的属性
            expect((variables.stat_data.items as any[])[0]).toEqual({
                name: 'sword',
                damage: 10,
                // 注意：没有 rarity 和 level
            });
        });

        it('should validate extensible property for arrays', async () => {
            // 测试数组的 extensible 属性限制
            variables.stat_data = {
                fixedArray: ['item1', 'item2'],
            };
            variables.schema = {
                type: 'object',
                properties: {
                    fixedArray: {
                        type: 'array',
                        elementType: { type: 'string' },
                        extensible: false, // 不可扩展
                    },
                },
            };

            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

            await updateVariables(`_.assign('fixedArray', 'item3');`, variables);

            // 应该有警告信息
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining(
                    'SCHEMA VIOLATION: Cannot assign elements into non-extensible array'
                )
            );

            // 数组不应该被修改
            expect(variables.stat_data.fixedArray).toEqual(['item1', 'item2']);

            consoleSpy.mockRestore();
        });

        it('should validate extensible property for objects', async () => {
            // 测试对象的 extensible 属性限制
            variables.stat_data = {
                config: {
                    version: '1.0',
                    name: 'test',
                },
            };
            variables.schema = {
                type: 'object',
                properties: {
                    config: {
                        type: 'object',
                        properties: {
                            version: { type: 'string' },
                            name: { type: 'string' },
                        },
                        extensible: false, // 不可扩展
                    },
                },
            };

            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

            await updateVariables(`_.assign('config', 'newKey', 'newValue');`, variables);

            // 应该有警告信息
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('SCHEMA VIOLATION: Cannot assign new key')
            );

            // 对象不应该被修改
            expect(variables.stat_data.config).toEqual({
                version: '1.0',
                name: 'test',
            });

            consoleSpy.mockRestore();
        });

        it('should not handle template inheritance across nested structures', async () => {
            // 测试嵌套结构中的模板继承
            variables.stat_data = {
                characters: {
                    $meta: {
                        template: { hp: 100, mp: 50 },
                    },
                    players: [EXTENSIBLE_MARKER],
                },
            }; //{$meta: {extensible: true}}
            reconcileAndApplySchema(variables);
            cleanUpMetadata(variables.stat_data);

            await updateVariables(`_.assign('characters.players', {"name": "hero"});`, variables);

            // 不应该应用父级的模板
            expect((variables.stat_data.characters as any).players).toEqual([{ name: 'hero' }]);
        });

        it('should handle template with primitive array correctly', async () => {
            // 测试原始类型数组作为模板
            variables.stat_data = {
                tags: [],
            };
            variables.schema = {
                type: 'object',
                properties: {
                    tags: {
                        type: 'array',
                        elementType: { type: 'any' },
                        extensible: true,
                        template: ['default-tag', 'metadata'], // 原始类型数组模板
                    },
                },
            };

            await updateVariables(`_.assign('tags', 'user-tag');`, variables);

            expect(variables.stat_data.tags).toEqual([['user-tag', 'default-tag', 'metadata']]);
        });

        it('should handle inserting null or undefined values', async () => {
            // 测试插入 null 或 undefined 值
            variables.stat_data = {
                items: [],
            };
            variables.schema = {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        elementType: { type: 'any' },
                        extensible: true,
                        template: { default: true },
                    },
                },
            };

            await updateVariables(`_.assign('items', null);`, variables);

            // null 值不应该应用模板
            expect(variables.stat_data.items).toEqual([null]);
        });

        it('should handle Date objects in templates', async () => {
            // 测试模板中的日期对象处理
            const now = new Date().toISOString();
            variables.stat_data = {
                events: [],
            };
            variables.schema = {
                type: 'object',
                properties: {
                    events: {
                        type: 'array',
                        elementType: { type: 'object', properties: {} },
                        extensible: true,
                        template: { createdAt: now, status: 'pending' },
                    },
                },
            };

            await updateVariables(`_.assign('events', {"name": "login"});`, variables);

            expect(variables.stat_data.events).toEqual([
                { name: 'login', createdAt: now, status: 'pending' },
            ]);
        });

        it('should handle complex nested template application', async () => {
            // 复杂嵌套场景
            variables.stat_data = {
                game: {
                    levels: [
                        {
                            name: 'Level 1',
                            rooms: [],
                        },
                    ],
                },
            };
            variables.schema = {
                type: 'object',
                properties: {
                    game: {
                        type: 'object',
                        properties: {
                            levels: {
                                type: 'array',
                                elementType: {
                                    type: 'object',
                                    properties: {
                                        name: { type: 'string' },
                                        rooms: {
                                            type: 'array',
                                            elementType: { type: 'object', properties: {} },
                                            extensible: true,
                                            template: { enemies: 0, treasure: false },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            };

            await updateVariables(
                `_.assign('game.levels[0].rooms', {"name": "entrance"});`,
                variables
            );

            expect((variables.stat_data.game as any).levels[0].rooms).toEqual([
                { name: 'entrance', enemies: 0, treasure: false },
            ]);
        });
    });

    describe('3-parameter array template scenarios', () => {
        let variables: MvuData;

        beforeEach(() => {
            variables = {
                initialized_lorebooks: {},
                stat_data: {
                    items: [],
                },
                display_data: {},
                delta_data: {},
            };
        });

        it('should handle type mismatch when assigning object to array with template (3 params)', async () => {
            // 数组模板 + 3参数 + 对象值 -> 类型不匹配错误
            variables.schema = {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        elementType: { type: 'any' },
                        extensible: true,
                        template: ['default-tag', 'description'], // any[] 模板
                    },
                },
            };

            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

            await updateVariables(
                `_.assign('items', 0, {"name": "object-value"});`, // 3参数，对象值
                variables
            );

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Template type mismatch')
            );
            expect(variables.stat_data.items).toEqual([{ name: 'object-value' }]); // 未应用模板

            consoleSpy.mockRestore();
        });

        it('should merge array template with array value (3 params)', async () => {
            // 数组模板 + 3参数 + 数组值 -> 合并模板与入参数组
            variables.schema = {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        elementType: { type: 'any' },
                        extensible: true,
                        template: ['default', 'template-description'],
                    },
                },
            };

            await updateVariables(
                `_.assign('items', 0, [["user-value", "user-description"]]);`, // 3参数，数组值
                variables
            );

            expect(variables.stat_data.items).toEqual([
                [['user-value', 'user-description'], 'default', 'template-description'],
            ]);
        });

        it('should merge array of literal value with array value (3 params)', async () => {
            // 数组模板 + 3参数 + 数组值 -> 合并模板与入参数组
            variables.schema = {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        elementType: { type: 'any' },
                        extensible: true,
                        template: ['default', 'template-description'],
                    },
                },
            };

            await updateVariables(
                `_.assign('items', 0, ["user-value", "user-description"]);`, // 3参数，数组值
                variables
            );

            expect(variables.stat_data.items).toEqual([
                ['user-value', 'user-description', 'default', 'template-description'],
            ]);
        });

        it('should create new array with literal value prepended to template (3 params)', async () => {
            // 数组模板 + 3参数 + 字面量值 -> 创建新数组[字面量, ...模板内容]
            variables.schema = {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        elementType: { type: 'any' },
                        extensible: true,
                        template: ['description', { metadata: true }],
                    },
                },
            };

            // 测试字符串字面量
            await updateVariables(
                `_.assign('items', 0, "string-literal");`, // 3参数，字符串字面量
                variables
            );

            expect(variables.stat_data.items).toEqual([
                ['string-literal', 'description', { metadata: true }],
            ]);

            // 测试数字字面量
            await updateVariables(
                `_.assign('items', 1, 42);`, // 3参数，数字字面量
                variables
            );

            expect(variables.stat_data.items).toEqual([
                ['string-literal', 'description', { metadata: true }],
                [42, 'description', { metadata: true }],
            ]);

            // 测试布尔字面量
            await updateVariables(
                `_.assign('items', 2, true);`, // 3参数，布尔字面量
                variables
            );

            expect(variables.stat_data.items).toEqual([
                ['string-literal', 'description', { metadata: true }],
                [42, 'description', { metadata: true }],
                [true, 'description', { metadata: true }],
            ]);
        });

        it('should handle 3-param assignment with object template correctly', async () => {
            // 对象模板的3参数场景（作为对比）
            variables.schema = {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        elementType: { type: 'object', properties: {} },
                        extensible: true,
                        template: { type: 'default', active: true }, // 对象模板
                    },
                },
            };

            await updateVariables(`_.assign('items', 0, {"name": "item1"});`, variables);

            expect(variables.stat_data.items).toEqual([
                { name: 'item1', type: 'default', active: true },
            ]);
        });
    });

    describe('Feature Switches - Non-default Combinations', () => {
        describe('strictTemplate=true, concatTemplateArray=true', () => {
            it('should prevent primitive to array conversion with concat behavior', async () => {
                const variables: MvuData = {
                    initialized_lorebooks: {},
                    stat_data: {
                        items: [],
                    },
                    display_data: {},
                    delta_data: {},
                    schema: {
                        type: 'object',
                        strictTemplate: true,
                        concatTemplateArray: true,
                        properties: {
                            items: {
                                type: 'array',
                                extensible: true,
                                elementType: { type: 'any' },
                                template: ['default1', 'default2'],
                            },
                        },
                    },
                };

                await updateVariables(`_.assign('items', 'primitive-value');`, variables);

                // strictTemplate=true prevents primitive->array conversion
                expect(variables.stat_data.items).toEqual(['primitive-value']);

                // Array assignment with concat behavior
                await updateVariables(`_.assign('items', ['user1', 'user2']);`, variables);

                expect(variables.stat_data.items).toEqual([
                    'primitive-value',
                    ['user1', 'user2', 'default1', 'default2'],
                ]);
            });

            it('should handle 3-param assignment with strict mode', async () => {
                const variables: MvuData = {
                    initialized_lorebooks: {},
                    stat_data: {
                        $meta: {
                            strictTemplate: true,
                            concatTemplateArray: true,
                        },
                        items: [],
                    },
                    display_data: {},
                    delta_data: {},
                    schema: {
                        type: 'object',
                        properties: {
                            items: {
                                type: 'array',
                                extensible: true,
                                elementType: { type: 'any' },
                                template: ['template-item'],
                            },
                        },
                    },
                };

                reconcileAndApplySchema(variables);
                cleanUpMetadata(variables.stat_data);

                await updateVariables(`_.assign('items', 0, 'primitive-value');`, variables);

                // No conversion happens in strict mode
                expect(variables.stat_data.items).toEqual(['primitive-value']);
            });
        });

        describe('strictTemplate=false, concatTemplateArray=false', () => {
            it('should allow primitive conversion with merge behavior', async () => {
                const variables: MvuData = {
                    initialized_lorebooks: {},
                    stat_data: { items: [] },
                    display_data: {},
                    delta_data: {},
                    schema: {
                        type: 'object',
                        strictTemplate: false,
                        concatTemplateArray: false,
                        properties: {
                            items: {
                                type: 'array',
                                extensible: true,
                                elementType: { type: 'any' },
                                template: ['default1', 'default2', 'default3'],
                            },
                        },
                    },
                };

                await updateVariables(`_.assign('items', 'primitive-value');`, variables);

                // Primitive converted to array and merged
                expect(variables.stat_data.items).toEqual([
                    ['primitive-value', 'default2', 'default3'],
                ]);
            });

            it('should merge arrays by position', async () => {
                const variables: MvuData = {
                    initialized_lorebooks: {},
                    stat_data: { data: [] },
                    display_data: {},
                    delta_data: {},
                    schema: {
                        type: 'object',
                        strictTemplate: false,
                        concatTemplateArray: false,
                        properties: {
                            data: {
                                type: 'array',
                                extensible: true,
                                elementType: { type: 'any' },
                                template: [
                                    { id: 1, value: 'default1' },
                                    { id: 2, value: 'default2' },
                                    { id: 3, value: 'default3' },
                                ],
                            },
                        },
                    },
                };

                await updateVariables(
                    `_.assign('data', [{ id: 1, value: 'user1' }, { id: 2, value: 'user2' }]);`,
                    variables
                );

                expect(variables.stat_data.data).toEqual([
                    [
                        { id: 1, value: 'user1' },
                        { id: 2, value: 'user2' },
                        { id: 3, value: 'default3' },
                    ],
                ]);
            });
        });

        describe('strictTemplate=true, concatTemplateArray=false', () => {
            it('should prevent conversion and use merge for arrays', async () => {
                const variables: MvuData = {
                    initialized_lorebooks: {},
                    stat_data: { items: [] },
                    display_data: {},
                    delta_data: {},
                    schema: {
                        type: 'object',
                        strictTemplate: true,
                        concatTemplateArray: false,
                        properties: {
                            items: {
                                type: 'array',
                                extensible: true,
                                elementType: { type: 'any' },
                                template: ['t1', 't2', 't3', 't4'],
                            },
                        },
                    },
                };

                // First try primitive assignment
                await updateVariables(`_.assign('items', 'no-conversion');`, variables);

                expect(variables.stat_data.items).toEqual(['no-conversion']);

                // Then array assignment with merge
                await updateVariables(`_.assign('items', ['a', 'b']);`, variables);

                expect(variables.stat_data.items).toEqual([
                    'no-conversion',
                    ['a', 'b', 't3', 't4'],
                ]);
            });

            it('should prevent conversion and use merge for arrays(from $meta)', async () => {
                const variables: MvuData = {
                    initialized_lorebooks: {},
                    stat_data: {
                        $meta: {
                            strictTemplate: true,
                            concatTemplateArray: false,
                        },
                        items: [
                            {
                                $meta: {
                                    extensible: true,
                                    template: ['t1', 't2', 't3', 't4'],
                                },
                                $arrayMeta: true,
                            },
                        ],
                    },
                    display_data: {},
                    delta_data: {},
                };
                reconcileAndApplySchema(variables);
                cleanUpMetadata(variables.stat_data);

                // First try primitive assignment
                await updateVariables(`_.assign('items', 'no-conversion');`, variables);

                expect(variables.stat_data.items).toEqual(['no-conversion']);

                // Then array assignment with merge
                await updateVariables(`_.assign('items', ['a', 'b']);`, variables);

                expect(variables.stat_data.items).toEqual([
                    'no-conversion',
                    ['a', 'b', 't3', 't4'],
                ]);
            });

            it('should handle nested operations with both switches', async () => {
                const variables: MvuData = {
                    initialized_lorebooks: {},
                    stat_data: {
                        $meta: {
                            strictTemplate: true,
                            concatTemplateArray: false,
                        },
                        container: { list: [] },
                    },
                    display_data: {},
                    delta_data: {},
                    schema: {
                        type: 'object',
                        properties: {
                            container: {
                                type: 'object',
                                properties: {
                                    list: {
                                        type: 'array',
                                        extensible: true,
                                        elementType: { type: 'any' },
                                        template: ['x', 'y', 'z'],
                                    },
                                },
                            },
                        },
                    },
                };

                reconcileAndApplySchema(variables);
                cleanUpMetadata(variables.stat_data);

                // 3-param with primitive
                await updateVariables(`_.assign('container.list', 0, 'item');`, variables);

                expect((variables.stat_data.container as any).list).toEqual(['item']);

                // Reset and test array merge
                (variables.stat_data.container as any).list = [];

                await updateVariables(`_.assign('container.list', 0, ['nested']);`, variables);

                expect((variables.stat_data.container as any).list).toEqual([['nested', 'y', 'z']]);
            });
        });
    });
});
