import YAML from 'yaml';
import { parseString } from '@/util';

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

    test('parses JSON5 input when YAML parser fails', () => {
        const original = (globalThis as any).YAML.parseDocument;
        (globalThis as any).YAML.parseDocument = () => {
            throw new Error('forced YAML failure');
        };
        try {
            const input = "{foo: 'bar', count: 2, items: [1, 2,],}";
            expect(parseString(input)).toEqual({ foo: 'bar', count: 2, items: [1, 2] });
        } finally {
            (globalThis as any).YAML.parseDocument = original;
        }
    });

    test('repairs malformed JSON input', () => {
        const original = (globalThis as any).YAML.parseDocument;
        (globalThis as any).YAML.parseDocument = () => {
            throw new Error('forced YAML failure');
        };
        try {
            const input = '{"foo":"bar","count":2';
            const repaired = parseString(input);
            expect(typeof repaired).toBe('object');
            expect(repaired).toEqual({ foo: 'bar', count: 2 });
        } finally {
            (globalThis as any).YAML.parseDocument = original;
        }
    });

    test('parses TOML input when YAML/JSON5/repair fail', () => {
        const original = (globalThis as any).YAML.parseDocument;
        (globalThis as any).YAML.parseDocument = () => {
            throw new Error('forced YAML failure');
        };
        try {
            const input = ['title = "TOML"', 'count = 2'].join('\n');
            expect(parseString(input)).toEqual({ title: 'TOML', count: 2 });
        } finally {
            (globalThis as any).YAML.parseDocument = original;
        }
    });
});
