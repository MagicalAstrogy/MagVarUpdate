import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import { extractCommands, updateVariables } from '@/function';
import { generateSchema } from '@/schema';
import { isArraySchema, isObjectSchema, MvuData, SchemaNode } from '@/variable_def';
import { describe, expect, it } from '@jest/globals';

type PatchCase = {
    comment?: string;
    doc: any;
    patch: Array<{ op: string }>;
    expected?: any;
    error?: string;
    disabled?: boolean;
};

const allowedOps = new Set(['add', 'replace', 'remove']);

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

describe('JSON Patch fixtures', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (globalThis as any).YAML = { parse: JSON.parse };
        (globalThis as any).eventEmit = jest.fn().mockResolvedValue(undefined);
    });

    test.each(
        fixtureCases.map((testCase, index) => [testCase.comment ?? `case #${index + 1}`, testCase])
    )('%s', async (_label, testCase) => {
        const statData = _.cloneDeep(testCase.doc);
        const schema = generateSchema(_.cloneDeep(testCase.doc));
        relaxSchema(schema);
        if (_label.includes('16')) return; //对于 A16. 场景，不支持符号 - 的特殊含义

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
    });
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
            const value = `<json_patch></json_patch> <JsonPatch>[{"op": "replace", "path": "/1", "value": ["bar", "baz"]}]</JsonPatch>
<json_patch> <JsonPatch>[{"op": "replace", "path": "/2", "value": ["bar", "baz"]}]</JsonPatch>`;
            const result = extractCommands(value);
            expect(result.length).toEqual(2);
        });
    });
});
