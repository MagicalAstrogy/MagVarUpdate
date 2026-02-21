import { parseString } from '@util/common';
import JSON5 from 'json5';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import YAML from 'yaml';

const JSON5_TEST_ROOT = path.resolve(__dirname, 'json5-tests');

function toPosixPath(filepath: string): string {
    return filepath.split(path.sep).join('/');
}

function walkFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        if (entry.name === '.git') {
            return [];
        }

        const absolutePath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return walkFiles(absolutePath);
        }
        return [absolutePath];
    });
}

function listFixtureFiles(extensions: ReadonlyArray<string>): string[] {
    return walkFiles(JSON5_TEST_ROOT)
        .filter(file => extensions.some(ext => file.endsWith(ext)))
        .map(file => toPosixPath(path.relative(JSON5_TEST_ROOT, file)))
        .sort();
}

function parseWithError(fn: () => unknown): { ok: true; value: unknown } | { ok: false } {
    try {
        return { ok: true, value: fn() };
    } catch {
        return { ok: false };
    }
}

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

    test('accepts identifier keys and single trailing commas in objects and arrays', () => {
        const input = "{default: 1, $_id: 'abc', list: [1, 2,],}";
        expect(parseString(input)).toEqual({
            default: 1,
            $_id: 'abc',
            list: [1, 2],
        });
    });

    test('accepts single-line and multi-line comments in JSON-like input', () => {
        const input = [
            '{',
            '  before: 1,',
            '  // single-line comment',
            '  /* multi-line',
            '     comment */',
            '  after: 2,',
            '}',
        ].join('\n');
        expect(parseString(input)).toEqual({
            before: 1,
            after: 2,
        });
    });

    test('accepts single-quoted strings and character escapes', () => {
        const input = "{text: 'line1\\nline2', unicode: '\\u0041'}";
        expect(parseString(input)).toEqual({
            text: 'line1\nline2',
            unicode: 'A',
        });
    });

    test('accepts non-breaking-space as additional whitespace', () => {
        const input = '{\u00A0foo:\u00A01,\u00A0bar:\u00A02\u00A0}';
        expect(parseString(input)).toEqual({
            foo: 1,
            bar: 2,
        });
    });

    test('parses JSON5 numeric literals in top-level scalar form', () => {
        expect(parseString('+1')).toBe(1);
        expect(parseString('.5')).toBe(0.5);
        expect(parseString('5.')).toBe(5);
        expect(parseString('0x10')).toBe(16);
    });

    test('normalizes non-JSON numeric literals when parsing JSON-like objects', () => {
        const input = '{hex:0x10, trailing:5., nan:NaN, inf:Infinity, ninf:-Infinity}';
        expect(parseString(input)).toEqual({
            hex: 16,
            trailing: 5,
            nan: NaN,
            inf: Infinity,
            ninf: -Infinity,
        });
    });

    test('matches JSON5 parser on official valid fixtures except known divergences', () => {
        expect(existsSync(JSON5_TEST_ROOT)).toBe(true);

        const validFixtureFiles = listFixtureFiles(['.json', '.json5']);
        const mismatches: string[] = [];

        for (const relPath of validFixtureFiles) {
            const input = readFileSync(path.join(JSON5_TEST_ROOT, relPath), 'utf8');
            const parsedByParseString = parseWithError(() => parseString(input));
            const parsedByJSON5 = parseWithError(() => JSON5.parse(input));

            if (!parsedByParseString.ok || !parsedByJSON5.ok) {
                mismatches.push(`${relPath} (threw)`);
                continue;
            }

            if (!isDeepStrictEqual(parsedByParseString.value, parsedByJSON5.value)) {
                mismatches.push(relPath);
            }
        }

        //下面是与 json5 中不符的，可以具体看一下。
        expect(mismatches).toEqual([
            'comments/block-comment-following-top-level-value.json5',
            'comments/block-comment-preceding-top-level-value.json5',
            'comments/inline-comment-following-top-level-value.json5',
            'comments/inline-comment-preceding-top-level-value.json5',
            'numbers/hexadecimal-uppercase-x.json5',
            'numbers/infinity.json5',
            'numbers/nan.json5',
            'numbers/negative-hexadecimal.json5',
            'numbers/negative-infinity.json5',
            'numbers/negative-zero-hexadecimal.json5',
            'numbers/positive-hexadecimal.json5',
            'numbers/positive-infinity.json5',
            'numbers/positive-zero-hexadecimal.json5',
            'strings/escaped-single-quoted-string.json5',
            'strings/multi-line-string.json5',
        ]);
    });

    test('currently diverges from JSON5 parser on official invalid fixtures', () => {
        expect(existsSync(JSON5_TEST_ROOT)).toBe(true);

        const invalidFixtureFiles = listFixtureFiles(['.js', '.txt']);
        const divergenceFiles: string[] = [];

        for (const relPath of invalidFixtureFiles) {
            const input = readFileSync(path.join(JSON5_TEST_ROOT, relPath), 'utf8');
            const parsedByParseString = parseWithError(() => parseString(input));
            const parsedByJSON5 = parseWithError(() => JSON5.parse(input));
            const parseStringThrows = !parsedByParseString.ok;
            const json5Throws = !parsedByJSON5.ok;

            if (parseStringThrows !== json5Throws) {
                divergenceFiles.push(relPath);
            }
        }

        // json5-tests marks .js/.txt files as invalid for JSON5;
        // parseString currently repairs or falls back and accepts them.
        expect(divergenceFiles).toEqual(invalidFixtureFiles);
    });
});
