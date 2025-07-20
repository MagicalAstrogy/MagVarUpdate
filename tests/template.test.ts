import { describe, it, expect, beforeEach } from '@jest/globals';
import { applyTemplate, updateVariables } from '../src/function';
import { generateSchema, cleanUpMetadata, reconcileAndApplySchema } from '../src/schema';
import { StatData, GameData } from '../src/variable_def';

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
                age: 20 // value overrides template
            });
        });

        it('should merge array template with array value', () => {
            const template: StatData[] = [{ type: 'default' }];
            const value = [{ name: 'item1' }];
            const result = applyTemplate(value, template);
            expect(result).toEqual([{ type: 'default', name: 'item1' }]);
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
                    template: { defaultProp: 'default' }
                },
                existingProp: 'value'
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
                { $meta: { template: { defaultType: 'default' } } }
            ];
            const schema = generateSchema(data);
            expect(data.length).toBe(1);// Removed meta element after
            expect(schema.type).toBe('array');
            if (schema.type === 'array') {
                expect(schema.template).toEqual({ defaultType: 'default' });
            }
        });

        it('should inherit template from old schema', () => {
            const oldSchema = {
                type: 'object' as const,
                properties: {},
                template: { inherited: true }
            };
            const data: StatData = {
                newProp: 'value'
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
                    id: null
                }
            };
            
            // 创建数据，其中 template 是对上面对象的引用
            const data: StatData = {
                $meta: {
                    template: templateWithMeta
                },
                existingProp: 'value'
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
                { $meta: { template: { defaultType: 'default' } } },
                { name: 'item2' }
            ];
            cleanUpMetadata(data);
            expect(data).toEqual([
                { name: 'item1' },
                { name: 'item2' }
            ]);
        });

        it('should remove $meta from objects', () => {
            const data: any = {
                $meta: { template: { default: true } },
                prop: 'value',
                nested: {
                    $meta: { extensible: true },
                    nestedProp: 'nestedValue'
                }
            };
            cleanUpMetadata(data);
            expect(data).toEqual({
                prop: 'value',
                nested: {
                    nestedProp: 'nestedValue'
                }
            });
        });
    });

    describe('Integration with assign/insert operations', () => {
        let variables: GameData;

        beforeEach(() => {
            variables = {
                initialized_lorebooks: {},
                stat_data: {},
                display_data: {},
                delta_data: {}
            };
        });

        it('should apply template when assigning to array (2 args)', async () => {
            // 设置带模板的数组
            variables.stat_data = {
                items: [
                    { name: 'existing' },
                    { $meta: { template: { type: 'default', rarity: 'common' } } }
                ]
            };
            // 生成 schema
            reconcileAndApplySchema(variables);

            // 执行 assign 操作
            await updateVariables(
                `_.assign('items', {"name": "sword"});`,
                variables
            );

            // 验证模板是否被应用
            expect(variables.stat_data.items).toEqual([
                { name: 'existing' },
                { name: 'sword', type: 'default', rarity: 'common' }
            ]);
        });

        it('should apply template when assigning to array with index (3 args)', async () => {
            variables.stat_data = {
                items: []
            };
            variables.schema = {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        elementType: { type: 'object', properties: {} },
                        extensible: true,
                        template: { type: 'weapon', damage: 10 }
                    }
                }
            };

            await updateVariables(
                `_.assign('items', 0, {"name": "dagger"});`,
                variables
            );

            expect(variables.stat_data.items).toEqual([
                { name: 'dagger', type: 'weapon', damage: 10 }
            ]);
        });

        it('should apply template when assigning to object property (3 args)', async () => {
            variables.stat_data = {
                inventory: {}
            };
            variables.schema = {
                type: 'object',
                properties: {
                    inventory: {
                        type: 'object',
                        properties: {},
                        extensible: true,
                        template: { count: 1, stackable: true }
                    }
                }
            };

            await updateVariables(
                `_.assign('inventory', 'potion', {"name": "health potion"});`,
                variables
            );

            expect(variables.stat_data.inventory).toEqual({
                potion: { name: 'health potion', count: 1, stackable: true }
            });
        });

        it('should NOT apply template when merging objects (2 args)', async () => {
            variables.stat_data = {
                player: { level: 1 }
            };
            variables.schema = {
                type: 'object',
                properties: {
                    player: {
                        type: 'object',
                        properties: {},
                        extensible: true,
                        template: { defaultHP: 100 }
                    }
                }
            };

            await updateVariables(
                `_.assign('player', {"exp": 0});`,
                variables
            );

            // 不应该应用模板
            expect(variables.stat_data.player).toEqual({
                level: 1,
                exp: 0
            });
        });

        it('should handle type mismatch between template and value', async () => {
            variables.stat_data = {
                items: []
            };
            variables.schema = {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        elementType: { type: 'any' },
                        extensible: true,
                        template: { type: 'object template' } // 对象模板
                    }
                }
            };

            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

            await updateVariables(
                `_.assign('items', ["array value"]);`, // 数组值
                variables
            );

            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Template type mismatch'));
            expect(variables.stat_data.items).toEqual([['array value']]); // 未应用模板

            consoleSpy.mockRestore();
        });

        it('should apply template to multiple array elements', async () => {
            variables.stat_data = {
                items: []
            };
            variables.schema = {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        elementType: { type: 'object', properties: {} },
                        extensible: true,
                        template: { category: 'item', sellable: true }
                    }
                }
            };

            await updateVariables(
                `_.assign('items', [{"name": "sword"}, {"name": "shield"}]);`,
                variables
            );

            expect(variables.stat_data.items).toEqual([
                { name: 'sword', category: 'item', sellable: true },
                { name: 'shield', category: 'item', sellable: true }
            ]);
        });

        it('should create object and apply template when target does not exist', async () => {
            variables.schema = {
                type: 'object',
                properties: {},
                extensible: true
            };

            // 为不存在的路径设置模板
            variables.stat_data = {
                game: {
                    $meta: {
                        template: { initialized: true, version: '1.0' }
                    }
                }
            };
            reconcileAndApplySchema(variables);

            await updateVariables(
                `_.assign('game.settings', 'difficulty', {"level": "hard"});`,
                variables
            );

            expect((variables.stat_data.game as any).settings).toEqual({
                difficulty: { level: 'hard', initialized: true, version: '1.0' }
            });
        });
    });

    describe('Edge cases and special scenarios', () => {
        it('should handle nested $meta in template', () => {
            const data: StatData = {
                $meta: {
                    template: {
                        $meta: { extensible: true },
                        defaultProp: 'value'
                    }
                }
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
                        value: 0
                    }
                },
                existingData: 'test'
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

        it('should reject array template for array type in $meta and show toastr error', () => {
            const data = [
                { name: 'item1' },
                { $meta: { template: ['invalid', 'array', 'template'] } }
            ];

            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
            // Mock toastr
            const toastrSpy = jest.fn();
            // @ts-ignore
            global.toastr = { error: toastrSpy };

            const schema = generateSchema(data);

            // 验证 console.error 被调用
            expect(consoleSpy).toHaveBeenCalledWith(
                'Invalid template type for array: template cannot be an array type (StatData[] or any[])'
            );

            // 验证 toastr.error 被调用
            expect(toastrSpy).toHaveBeenCalledWith(
                'Invalid template type for array: template cannot be an array type (StatData[] or any[])',
                'Template Error',
                { timeOut: 5000 }
            );

            // 模板不应该被设置
            expect(schema.type).toBe('array');
            if (schema.type === 'array') {
                expect(schema.template).toBeUndefined();
            }

            consoleSpy.mockRestore();
            // @ts-ignore
            delete global.toastr;
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
            expect(result).toEqual(['user value', 'default description']);
        });

        it('should apply any[] template in array assign operation', async () => {
            const variables: GameData = {
                initialized_lorebooks: {},
                stat_data: {
                    attributes: []
                },
                display_data: {},
                delta_data: {}
            };

            variables.schema = {
                type: 'object',
                properties: {
                    attributes: {
                        type: 'array',
                        elementType: { type: 'any' },
                        extensible: true,
                        template: ['default', 'This is a default attribute'] // ValueWithDescription 风格
                    }
                }
            };

            await updateVariables(
                `_.assign('attributes', ["strength"]);`,
                variables
            );

            expect(variables.stat_data.attributes).toEqual([
                ['strength', 'This is a default attribute']
            ]);
        });

        it('should handle complex any[] templates', () => {
            // 复杂的 any[] 模板，包含对象
            const template: any[] = [
                { type: 'default' },
                'description',
                { metadata: { version: 1 } }
            ];

            const value = [{ type: 'custom', value: 42 }];
            const result = applyTemplate(value, template);

            // 合并结果应该保留 value 的内容并补充 template 的其他元素
            expect(result).toEqual([
                { type: 'custom', value: 42 },
                'description',
                { metadata: { version: 1 } }
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
            const variables: GameData = {
                initialized_lorebooks: {},
                stat_data: {
                    skills: []
                },
                display_data: {},
                delta_data: {}
            };

            variables.schema = {
                type: 'object',
                properties: {
                    skills: {
                        type: 'array',
                        elementType: { type: 'any' },
                        extensible: true,
                        template: ['skill description', { level: 1, maxLevel: 10 }]
                    }
                }
            };

            // 插入字符串字面量
            await updateVariables(
                `_.assign('skills', "剑术");`,
                variables
            );

            expect(variables.stat_data.skills).toEqual([
                ['剑术', 'skill description', { level: 1, maxLevel: 10 }]
            ]);

            // 插入数字字面量
            await updateVariables(
                `_.assign('skills', 0, 100);`,
                variables
            );

            expect(variables.stat_data.skills).toEqual([
                [100, 'skill description', { level: 1, maxLevel: 10 }],
                ['剑术', 'skill description', { level: 1, maxLevel: 10 }]
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
        let variables: GameData;

        beforeEach(() => {
            variables = {
                initialized_lorebooks: {},
                stat_data: {},
                display_data: {},
                delta_data: {}
            };
        });

        it('should NOT apply template when assigning to existing array element', async () => {
            // 根据 issue #22："当你操作一个已经存在的数组的已存在元素时，不会自动应用模板"
            variables.stat_data = {
                items: [
                    { name: 'sword', damage: 5 },
                    { name: 'shield', defense: 10 }
                ]
            };
            variables.schema = {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        elementType: { type: 'object', properties: {} },
                        extensible: true,
                        template: { rarity: 'common', level: 1 }
                    }
                }
            };

            // 使用 set 命令修改已存在的元素
            await updateVariables(
                `_.set('items[0].damage', 10);`,
                variables
            );

            // 不应该添加模板中的属性
            expect((variables.stat_data.items as any[])[0]).toEqual({
                name: 'sword',
                damage: 10
                // 注意：没有 rarity 和 level
            });
        });

        it('should validate extensible property for arrays', async () => {
            // 测试数组的 extensible 属性限制
            variables.stat_data = {
                fixedArray: ['item1', 'item2']
            };
            variables.schema = {
                type: 'object',
                properties: {
                    fixedArray: {
                        type: 'array',
                        elementType: { type: 'string' },
                        extensible: false // 不可扩展
                    }
                }
            };

            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

            await updateVariables(
                `_.assign('fixedArray', 'item3');`,
                variables
            );

            // 应该有警告信息
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('SCHEMA VIOLATION: Cannot assign elements into non-extensible array')
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
                    name: 'test'
                }
            };
            variables.schema = {
                type: 'object',
                properties: {
                    config: {
                        type: 'object',
                        properties: {
                            version: { type: 'string' },
                            name: { type: 'string' }
                        },
                        extensible: false // 不可扩展
                    }
                }
            };

            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

            await updateVariables(
                `_.assign('config', 'newKey', 'newValue');`,
                variables
            );

            // 应该有警告信息
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('SCHEMA VIOLATION: Cannot assign new key')
            );

            // 对象不应该被修改
            expect(variables.stat_data.config).toEqual({
                version: '1.0',
                name: 'test'
            });

            consoleSpy.mockRestore();
        });

        it('should handle template inheritance across nested structures', async () => {
            // 测试嵌套结构中的模板继承
            variables.stat_data = {
                characters: {
                    $meta: {
                        template: { hp: 100, mp: 50 }
                    },
                    players: []
                }
            };
            reconcileAndApplySchema(variables);

            await updateVariables(
                `_.assign('characters.players', {"name": "hero"});`,
                variables
            );

            // 应该应用父级的模板
            expect((variables.stat_data.characters as any).players).toEqual([
                { name: 'hero', hp: 100, mp: 50 }
            ]);
        });

        it('should handle template with primitive array correctly', async () => {
            // 测试原始类型数组作为模板
            variables.stat_data = {
                tags: []
            };
            variables.schema = {
                type: 'object',
                properties: {
                    tags: {
                        type: 'array',
                        elementType: { type: 'any' },
                        extensible: true,
                        template: ['default-tag', 'metadata'] // 原始类型数组模板
                    }
                }
            };

            await updateVariables(
                `_.assign('tags', 'user-tag');`,
                variables
            );

            expect(variables.stat_data.tags).toEqual([
                ['user-tag', 'default-tag', 'metadata']
            ]);
        });

        it('should handle inserting null or undefined values', async () => {
            // 测试插入 null 或 undefined 值
            variables.stat_data = {
                items: []
            };
            variables.schema = {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        elementType: { type: 'any' },
                        extensible: true,
                        template: { default: true }
                    }
                }
            };

            await updateVariables(
                `_.assign('items', null);`,
                variables
            );

            // null 值不应该应用模板
            expect(variables.stat_data.items).toEqual([null]);
        });

        it('should handle Date objects in templates', async () => {
            // 测试模板中的日期对象处理
            const now = new Date().toISOString();
            variables.stat_data = {
                events: []
            };
            variables.schema = {
                type: 'object',
                properties: {
                    events: {
                        type: 'array',
                        elementType: { type: 'object', properties: {} },
                        extensible: true,
                        template: { createdAt: now, status: 'pending' }
                    }
                }
            };

            await updateVariables(
                `_.assign('events', {"name": "login"});`,
                variables
            );

            expect(variables.stat_data.events).toEqual([
                { name: 'login', createdAt: now, status: 'pending' }
            ]);
        });

        it('should validate that array templates cannot be array types', () => {
            // 根据 issue #22：数组的模板不能是数组类型
            const data = [
                { item: 'test' },
                { $meta: { template: [{ invalid: 'template' }] } } // StatData[] 类型
            ];

            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
            const schema = generateSchema(data);

            expect(consoleSpy).toHaveBeenCalledWith(
                'Invalid template type for array: template cannot be an array type (StatData[] or any[])'
            );

            if (schema.type === 'array') {
                expect(schema.template).toBeUndefined();
            }

            consoleSpy.mockRestore();
        });

        it('should handle complex nested template application', async () => {
            // 复杂嵌套场景
            variables.stat_data = {
                game: {
                    levels: [
                        {
                            name: 'Level 1',
                            rooms: []
                        }
                    ]
                }
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
                                            template: { enemies: 0, treasure: false }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            };

            await updateVariables(
                `_.assign('game.levels[0].rooms', {"name": "entrance"});`,
                variables
            );

            expect((variables.stat_data.game as any).levels[0].rooms).toEqual([
                { name: 'entrance', enemies: 0, treasure: false }
            ]);
        });
    });
});
