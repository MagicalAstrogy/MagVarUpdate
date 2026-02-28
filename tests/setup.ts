// Global test setup
import _ from 'lodash';
import { createPinia, setActivePinia } from 'pinia';
import { klona } from 'klona';

// Make lodash available globally as it's used in the source code
(globalThis as any)._ = _;
(globalThis as any).klona = klona;

// Provide a default SillyTavern mock so Pinia stores can read/write settings
(globalThis as any).SillyTavern = {
    extensionSettings: {},
    saveSettingsDebounced: jest.fn(),
    saveChat: jest.fn().mockResolvedValue(undefined),
    callGenericPopup: jest.fn().mockResolvedValue(undefined),
    ToolManager: {
        isToolCallingSupported: jest.fn().mockReturnValue(true),
        parseToolCalls: jest.fn((toolCalls: unknown, parsed: unknown) => ({ toolCalls, parsed })),
        registerFunctionTool: jest.fn(),
        unregisterFunctionTool: jest.fn(),
    },
    registerMacro: jest.fn(),
    unregisterMacro: jest.fn(),
    chatCompletionSettings: { function_calling: true },
    chat: [],
    extension_settings: {},
};

(globalThis as any).appendInexistentScriptButtons = jest.fn();
(globalThis as any).getButtonEvent = jest.fn((button_name: string) => button_name);
(globalThis as any).eventOnButton = jest.fn();

const __eventHandlers = new Map<string, Array<(...args: unknown[]) => unknown>>();

// Mock window object
(globalThis as any).window = globalThis;
(globalThis as any).atob =
    (globalThis as any).atob ??
    ((value: string) => Buffer.from(value, 'base64').toString('binary'));

// Mock TavernHelper
(globalThis as any).window.TavernHelper = {
    substitudeMacros: jest.fn(input => input),
};

// Mock tavern events
(globalThis as any).tavern_events = {
    GENERATION_ENDED: 'GENERATION_ENDED',
    MESSAGE_SENT: 'MESSAGE_SENT',
    GENERATION_STARTED: 'GENERATION_STARTED',
};

// Ensure each test runs with a fresh Pinia instance
beforeEach(() => {
    setActivePinia(createPinia());
    __eventHandlers.clear();
});

// Mock functions that are not available in test environment
(globalThis as any).eventOn = jest.fn((event: string, handler: (...args: unknown[]) => unknown) => {
    const bridged = (globalThis as any).eventOnButton;
    if (typeof bridged === 'function') {
        bridged(event, handler);
    }

    if (!__eventHandlers.has(event)) {
        __eventHandlers.set(event, []);
    }
    __eventHandlers.get(event)!.push(handler);
});
(globalThis as any).eventEmit = jest.fn(async (event: string, ...args: unknown[]) => {
    const handlers = __eventHandlers.get(event) ?? [];
    for (const handler of handlers) {
        const result = handler(...args);
        if (result && typeof (result as Promise<unknown>).then === 'function') {
            await result;
        }
    }
});
(globalThis as any).getChatMessages = jest.fn();
(globalThis as any).getVariables = jest.fn();
(globalThis as any).getLastMessageId = jest.fn();
(globalThis as any).replaceVariables = jest.fn();
(globalThis as any).setChatMessage = jest.fn();
(globalThis as any).setChatMessages = jest.fn();
(globalThis as any).getCurrentCharPrimaryLorebook = jest.fn();
(globalThis as any).getAvailableLorebooks = jest.fn();
(globalThis as any).substitudeMacros = jest.fn(input => input);
(globalThis as any).insertOrAssignVariables = jest.fn();
