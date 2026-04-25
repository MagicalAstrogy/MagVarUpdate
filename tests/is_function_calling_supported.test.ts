import {
    getFunctionCallingApiVersionUnsupportedMessage,
    isFunctionCallingSupported,
    MIN_FUNCTION_CALLING_TAVERN_HELPER_VERSION,
} from '@/function/is_function_calling_supported';
import { useDataStore } from '@/store';

describe('isFunctionCallingSupported', () => {
    beforeEach(() => {
        const store = useDataStore();
        store.versions.tavernhelper = MIN_FUNCTION_CALLING_TAVERN_HELPER_VERSION;
        (globalThis as any).SillyTavern.ToolManager.isToolCallingSupported.mockReturnValue(true);
    });

    test('requires TavernHelper 4.8.4 for slash-runner tool call result API', () => {
        const store = useDataStore();
        store.versions.tavernhelper = '4.8.3';

        expect(isFunctionCallingSupported()).toBe(false);
        expect(getFunctionCallingApiVersionUnsupportedMessage()).toContain('4.8.3');
        expect(getFunctionCallingApiVersionUnsupportedMessage()).toContain(
            MIN_FUNCTION_CALLING_TAVERN_HELPER_VERSION
        );
    });

    test('accepts supported TavernHelper version when API source supports tools', () => {
        expect(isFunctionCallingSupported()).toBe(true);
    });
});
