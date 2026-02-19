import { parseString } from '@/util';
import YAML from 'yaml';

describe('parseString', () => {
    beforeAll(() => {
        (globalThis as any).YAML = YAML;
    });

    test('parses YAML input', () => {
        const input = ['foo: bar', 'count: 2', 'items:', '  - a', '  - b'].join('\n');
        expect(parseString(input)).toEqual({ foo: 'bar', count: 2, items: ['a', 'b'] });
    });

    test('parses JSON input', () => {
        const input = '{"foo":"bar","count":2,"items":["a","b"]}';
        expect(parseString(input)).toEqual({ foo: 'bar', count: 2, items: ['a', 'b'] });
    });

    test('repairs JSON5 input as JSON input', () => {
        const input = "{foo: 'bar', count: 2, items: [1, 2,],}";
        expect(parseString(input)).toEqual({ foo: 'bar', count: 2, items: [1, 2] });
    });

    test('repairs malformed JSON input', () => {
        const input = '{"foo":"bar","count":2';
        const repaired = parseString(input);
        expect(typeof repaired).toBe('object');
        expect(repaired).toEqual({ foo: 'bar', count: 2 });
    });

    test('repairs JSON patch missing outer array brackets', () => {
        const input = [
            '{ "op": "add", "path": "/items/0", "value": "first" }',
            '{ "op": "replace", "path": "/items/1", "value": "second" }',
        ].join('\n');
        expect(parseString(input)).toEqual([
            { op: 'add', path: '/items/0', value: 'first' },
            { op: 'replace', path: '/items/1', value: 'second' },
        ]);
    });
});
