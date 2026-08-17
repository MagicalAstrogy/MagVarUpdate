import { updateVariables, extractCommands } from '@/function/update_variables';
import { generateSchema } from '@/function/schema';
import { isArraySchema, isObjectSchema, SchemaNode } from '@/variable_def';
import { loadLatestMvuZod } from './helpers/load_remote_mvu_zod';
import type { RegisterMvuSchema } from './helpers/load_remote_mvu_zod';
import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import _ from 'lodash';
import path from 'path';
import * as zod from 'zod';

type PatchCase = {
    comment?: string;
    doc: any;
    patch: Array<{ op: string }>;
    expected?: any;
    error?: string;
    disabled?: boolean;
};

type MvuData = any;

const allowedOps = new Set(['add', 'replace', 'remove']);

let registerMvuSchema: RegisterMvuSchema;

beforeAll(async () => {
    registerMvuSchema = await loadLatestMvuZod();
}, 30_000);

beforeEach(() => {
    registerMvuSchema(zod.z.any());
});

function loadCases(fileName: string): PatchCase[] {
    const filePath = path.resolve(__dirname, 'json-patch-tests', fileName);
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PatchCase[];
}

function shouldRunCase(testCase: PatchCase): boolean {
    if (!Array.isArray(testCase.patch)) return false;
    if (testCase.disabled) return false;
    if (testCase.error !== undefined) return false;
    if (typeof testCase.expected === 'undefined') return false;

    return testCase.patch.every(op => allowedOps.has(op.op));
}

function relaxSchema(schema: SchemaNode | null | undefined) {
    if (!schema) return;

    if (isObjectSchema(schema)) {
        schema.extensible = true;
        Object.keys(schema.properties).forEach(key => {
            schema.properties[key].required = false;
            relaxSchema(schema.properties[key] as SchemaNode);
        });
    } else if (isArraySchema(schema)) {
        schema.extensible = true;
        relaxSchema(schema.elementType);
    }
}
// , ...loadCases('tests.json') 这个集合还不能全部通过
const fixtureCases = [...loadCases('spec_tests.json')].filter(shouldRunCase);

async function runPatchCase(testCase: PatchCase) {
    const statData = _.cloneDeep(testCase.doc);
    const schema = generateSchema(_.cloneDeep(testCase.doc));
    relaxSchema(schema);

    const variables: MvuData = {
        stat_data: statData,
        display_data: {},
        delta_data: {},
        schema: schema as any,
    };
    console.log(JSON.stringify(testCase, null, 2));

    const message = `<JsonPatch>${JSON.stringify(testCase.patch)}</JsonPatch>`;
    await updateVariables(message, variables);

    expect(variables.stat_data).toEqual(testCase.expected);
}

describe('JSON Patch fixtures', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (globalThis as any).YAML = { parse: JSON.parse };
    });

    test.each(
        fixtureCases.map((testCase, index) => [testCase.comment ?? `case #${index + 1}`, testCase])
    )('%s', async (_label, testCase) => runPatchCase(testCase));
});

describe('JsonPatchMiscTest', () => {
    describe('含有多个标签的场合', () => {
        it('思考链测试', () => {
            const value = `<JsonPatch> <JsonPatch>[{"op": "replace", "path": "/1", "value": ["bar", "baz"]}]</JsonPatch>
<JsonPatch> <JsonPatch>[{"op": "replace", "path": "/2", "value": ["bar", "baz"]}]</JsonPatch>`;
            const result = extractCommands(value);
            expect(result.length).toEqual(2);
        });
    });
    describe('含有多个标签的场合_别名', () => {
        it('思考链测试', () => {
            const value = `<json_patch> <JsonPatch>[{"op": "replace", "path": "/1", "value": ["bar", "baz"]}]</JsonPatch>
<json_patch> <JsonPatch>[{"op": "replace", "path": "/2", "value": ["bar", "baz"]}]</JsonPatch>`;
            const result = extractCommands(value);
            expect(result.length).toEqual(2);
        });
    });
    describe('含有多个标签的场合_空内容', () => {
        it('思考链测试', () => {
            const value = `<json_patch></json_patch>456 <JsonPatch>[{"op": "replace", "path": "/1", "value": ["bar", "baz"]}]</JsonPatch>fg
<json_patch> df<JsonPatch>[{"op": "replace", "path": "/2", "value": ["bar", "baz"]}]</JsonPatch>123`;
            const result = extractCommands(value);
            expect(result.length).toEqual(2);
        });
    });
    describe('含有多个标签的场合_使用不对称标记', () => {
        it('思考链测试', () => {
            const value = `<JsonPatch>345456 <json_patch>[{"op": "replace", "path": "/1", "value": ["bar", "baz"]}]</json_patch>2345
<JsonPatch>46 <json_patch>[{"op": "replace", "path": "/2", "value": ["bar", "baz"]}]</json_patch>123`;
            const result = extractCommands(value);
            expect(result.length).toEqual(2);
        });
    });
});

describe('执行测试', () => {
    test('delta指令', async () => {
        const statData = { 测试: 10 };
        const schema = generateSchema(_.cloneDeep(statData));
        relaxSchema(schema);

        const variables: MvuData = {
            stat_data: statData,
            display_data: {},
            delta_data: {},
            schema: schema as any,
        };

        const message = `<JsonPatch>[{"op": "delta", "path": "/测试", "value": 10}]</JsonPatch>`;
        await updateVariables(message, variables);

        expect(variables.stat_data).toEqual({ 测试: 20 });
    });

    test('json patch insert with /- appends to array tail', async () => {
        const statData = {
            主角: {
                持有物品: [{ name: '木钥匙' }, { name: '银钥匙' }],
            },
        };
        const schema = generateSchema(_.cloneDeep(statData));
        relaxSchema(schema);

        const variables: MvuData = {
            stat_data: statData,
            display_data: {},
            delta_data: {},
            schema: schema as any,
        };

        const message =
            '<JsonPatch>[{"op":"insert","path":"/主角/持有物品/-","value":{"name":"铜钥匙","description":"古铜色小钥匙"}}]</JsonPatch>';

        await updateVariables(message, variables);

        expect(variables.stat_data.主角.持有物品).toEqual([
            { name: '木钥匙' },
            { name: '银钥匙' },
            { name: '铜钥匙', description: '古铜色小钥匙' },
        ]);
    });

    test('json patch insert tolerates missing leading root slash', async () => {
        const statData = {
            主角: {
                备忘录: {},
            },
        };
        const schema = generateSchema(_.cloneDeep(statData));
        relaxSchema(schema);

        const variables: MvuData = {
            stat_data: statData,
            display_data: {},
            delta_data: {},
            schema: schema as any,
        };

        const message = `<JSONPatch>
[
  { "op": "insert", "path": "主角/备忘录/楼道露出任务", "value": "Day1 22:00-23:30 在月光里公寓区消防楼梯间完成露出任务" }
]
</JSONPatch>`;

        await updateVariables(message, variables);

        expect(variables.stat_data).toEqual({
            主角: {
                备忘录: {
                    楼道露出任务: 'Day1 22:00-23:30 在月光里公寓区消防楼梯间完成露出任务',
                },
            },
        });
        expect(variables.stat_data).not.toHaveProperty('角');
    });

    test('json patch insert preserves dots in object keys', async () => {
        const itemName = 'Precision Accuracy International AXMC .338 LM 特战重型狙击系统';
        const statData = {
            主角: {
                背包: {},
            },
        };
        const schema = generateSchema(_.cloneDeep(statData));
        relaxSchema(schema);

        const variables: MvuData = {
            stat_data: statData,
            display_data: {},
            delta_data: {},
            schema: schema as any,
        };

        const message = `<JsonPatch>${JSON.stringify([
            {
                op: 'insert',
                path: `/主角/背包/${itemName}`,
                value: {},
            },
        ])}</JsonPatch>`;

        await updateVariables(message, variables);

        expect(variables.stat_data).toEqual({
            主角: {
                背包: {
                    [itemName]: {},
                },
            },
        });
    });

    test('json patch insert preserves control characters in object keys', async () => {
        const itemName = 'line\nbreak\tvalue';
        const statData = {
            outer: {},
        };
        const schema = generateSchema(_.cloneDeep(statData));
        relaxSchema(schema);

        const variables: MvuData = {
            stat_data: statData,
            display_data: {},
            delta_data: {},
            schema: schema as any,
        };

        const message = `<JsonPatch>${JSON.stringify([
            {
                op: 'insert',
                path: `/outer/${itemName}`,
                value: 'preserved',
            },
        ])}</JsonPatch>`;

        await updateVariables(message, variables);

        expect(variables.stat_data).toEqual({
            outer: {
                [itemName]: 'preserved',
            },
        });
    });

    test('mvu_zod removes an array item below an object key containing dots', async () => {
        const parentKey = 'inventory.v2';
        const statData = {
            [parentKey]: {
                items: ['first', 'second', 'third'],
            },
        };
        const schema = generateSchema(_.cloneDeep(statData));
        relaxSchema(schema);

        const variables: MvuData = {
            stat_data: statData,
            display_data: {},
            delta_data: {},
            schema: schema as any,
        };

        const message = `<JsonPatch>${JSON.stringify([
            {
                op: 'remove',
                path: `/${parentKey}/items/1`,
            },
        ])}</JsonPatch>`;

        await updateVariables(message, variables);

        expect(variables.stat_data).toEqual({
            [parentKey]: {
                items: ['first', 'third'],
            },
        });
    });
});
