/** 命令值求值的性能与隔离回归：统计工厂初始化次数，不使用易受机器负载影响的耗时断言。 */
jest.mock('mathjs', () => {
    const actual = jest.requireActual<typeof import('mathjs')>('mathjs');
    return { ...actual, create: jest.fn(actual.create) };
});

import { parseCommandValue, updateVariables } from '@/function/update_variables';
import type { MvuData } from '@/variable_def';
import * as math from 'mathjs';
import * as yaml from 'yaml';

beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(globalThis, { YAML: yaml });
});

test('parses quoted strings without constructing mathjs', () => {
    for (let index = 0; index < 100; index++) {
        expect(parseCommandValue(`'value ${index}'`)).toBe(`value ${index}`);
    }
    expect(parseCommandValue("'10 + 2'")).toBe('10 + 2');
    expect(parseCommandValue("'it''s a string'")).toBe("it's a string");
    expect(parseCommandValue(String.raw`'C:\Users\name'`)).toBe(String.raw`C:\Users\name`);
    expect(math.create).not.toHaveBeenCalled();
});

test('reuses at most one mathjs instance for a hundred arithmetic parameters', () => {
    for (let index = 0; index < 100; index++) {
        expect(parseCommandValue(`Math.floor(3.9) + math.pow(2, 3) + ${index}`)).toBe(11 + index);
    }
    expect(jest.mocked(math.create).mock.calls.length).toBeLessThanOrEqual(1);
});

test('reuses the evaluator across long variable-update batches', async () => {
    expect(parseCommandValue('sqrt(16)')).toBe(4);
    jest.mocked(math.create).mockClear();
    const variables: MvuData = {
        initialized_lorebooks: {},
        stat_data: { score: 0, label: '' },
        schema: {
            type: 'object',
            properties: { score: { type: 'number' }, label: { type: 'string' } },
        },
        display_data: {},
        delta_data: {},
    };
    const commands = Array.from(
        { length: 50 },
        (_, index) => `_.add('score', sqrt(16)); _.set('label', 'value ${index}');`
    ).join('\n');

    await updateVariables(commands, variables);
    await updateVariables(commands, variables);

    expect(variables.stat_data.score).toBe(400);
    expect(variables.stat_data.label).toBe('value 49');
    expect(math.create).not.toHaveBeenCalled();
});

const unitMutation =
    '[createUnit("deg", "2 rad", {override: true}), number(unit(180, "deg"), "rad")][2]';
test.each([
    ['direct', unitMutation],
    [
        'aliased',
        '[f = createUnit, f("deg", "2 rad", {override: true}), number(unit(180, "deg"), "rad")][3]',
    ],
    ['nested evaluate', `evaluate(${JSON.stringify(unitMutation)})`],
    ['parsed expression', `parse(${JSON.stringify(unitMutation)}).evaluate()`],
])('isolates %s unit mutations from later arguments', (_name, expression) => {
    const radians = 'number(unit(180, "deg"), "rad")';
    expect(parseCommandValue(radians)).toBeCloseTo(Math.PI);

    // 一次性实例仍允许原有表达式在自身求值期间修改单位，但不污染复用实例或全局库。
    expect(parseCommandValue(expression)).toBe(360);

    expect(parseCommandValue(radians)).toBeCloseTo(Math.PI);
    expect(math.evaluate(radians)).toBeCloseTo(Math.PI);
});

test('keeps numeric configuration and assigned symbols local to one argument', () => {
    expect(parseCommandValue('1 / 3')).toBeCloseTo(1 / 3, 10);

    parseCommandValue('config({number: "BigNumber", precision: 2})');
    expect(parseCommandValue('mvu_temporary = 7')).toBe(7);

    expect(parseCommandValue('1 / 3')).toBeCloseTo(1 / 3, 10);
    expect(parseCommandValue('mvu_temporary')).toBe('mvu_temporary');
});
