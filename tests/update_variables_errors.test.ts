import { updateVariables } from '@/function/update_variables';
import { useDataStore } from '@/store';
import { type MvuData, variable_events } from '@/variable_def';

describe('updateVariables error collection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (globalThis as any).toastr = { warning: jest.fn(), error: jest.fn() };
        useDataStore().settings.通知.变量更新出错 = true;
    });

    const createVariables = (): MvuData => ({
        stat_data: { hp: 72 },
        initialized_lorebooks: {},
        schema: { type: 'object', properties: {} },
    });

    test.each([true, false])('appends every native error with notifications %p', async enabled => {
        useDataStore().settings.通知.变量更新出错 = enabled;
        const errors = ['earlier error'];
        const variables = createVariables();
        const result = await updateVariables(
            "_.set('missing', 1); _.add('other', 2); _.set('hp', 80);",
            variables,
            errors
        );
        expect(result).toBe(true);
        expect(variables.stat_data.hp).toBe(80);
        expect(errors).toHaveLength(3);
        expect(errors[0]).toBe('earlier error');
        expect(errors[1]).toContain("_.set('missing', 1)");
        expect(errors[2]).toContain("_.add('other', 2)");
        expect(toastr.warning).not.toHaveBeenCalled();
    });

    test('keeps the old toast behavior when no collection array is provided', async () => {
        await expect(updateVariables("_.set('missing', 1);", createVariables())).resolves.toBe(
            false
        );
        expect(toastr.warning).toHaveBeenCalledTimes(1);
    });

    test('passes the reporter only as the fourth Zod event argument', async () => {
        const errors: string[] = [];
        const variables = createVariables();
        const message = "_.set('hp', 80);";
        eventOn(
            variable_events.COMMAND_PARSED + '_for_zod',
            (_variables, _commands, content, onError) => {
                expect(content).toBe(message);
                onError('first Zod error');
                onError('second Zod error');
            }
        );
        await updateVariables(message, variables, errors);
        expect(errors).toEqual(['first Zod error', 'second Zod error']);
        expect(eventEmit).toHaveBeenCalledWith(
            variable_events.COMMAND_PARSED + '_for_zod',
            variables,
            expect.any(Array),
            message,
            expect.any(Function)
        );
        expect(eventEmit).toHaveBeenCalledWith(
            variable_events.COMMAND_PARSED,
            variables,
            expect.any(Array),
            message
        );
        expect(toastr.warning).not.toHaveBeenCalled();
    });

    test('leaves the Zod reporter undefined in legacy notification mode', async () => {
        eventOn(
            variable_events.COMMAND_PARSED + '_for_zod',
            (_variables, _commands, _content, onError) => {
                expect(onError).toBeUndefined();
            }
        );
        await updateVariables('', createVariables());
    });

    test('does not add errors for a successful update', async () => {
        const errors: string[] = [];
        await updateVariables("_.set('hp', 80);", createVariables(), errors);
        expect(errors).toEqual([]);
        expect(toastr.warning).not.toHaveBeenCalled();
    });
});
