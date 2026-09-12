/**
 * 测试场景：为 Jest 提供浏览器、酒馆、事件和变量 API 的共享模拟环境，并在每个用例前隔离设置及全局状态。
 * 补齐 Web Streams，支持 Pi 和 Google SDK 在 jsdom 中初始化。
 */
import $ from 'jquery';
import _ from 'lodash';
import { createPinia, setActivePinia } from 'pinia';
import { klona } from 'klona';
import { watch } from 'vue';
import { ReadableStream, TransformStream, WritableStream } from 'node:stream/web';

// 浏览器能力：补齐 jsdom 缺少的 Web Streams，满足 SDK 模块初始化要求。
Object.assign(globalThis, { ReadableStream, TransformStream, WritableStream });

// 全局工具：源码从全局访问 lodash 和 klona，测试中注入真实实现。
(globalThis as any)._ = _;
(globalThis as any).klona = klona;

// 酒馆环境：模拟设置、聊天和弹窗 API，供 Pinia 及界面逻辑读写。
(globalThis as any).SillyTavern = {
    extensionSettings: {},
    getCurrentLocale: jest.fn().mockReturnValue('zh-CN'),
    saveSettingsDebounced: jest.fn(),
    saveChat: jest.fn().mockResolvedValue(undefined),
    callGenericPopup: jest.fn().mockResolvedValue(undefined),
    POPUP_TYPE: {
        TEXT: 1,
        CONFIRM: 2,
    },
    POPUP_RESULT: {
        AFFIRMATIVE: 1,
        NEGATIVE: 0,
        CANCELLED: -1,
    },
    loadWorldInfo: jest.fn().mockResolvedValue({ entries: {} }),
    saveWorldInfo: jest.fn().mockResolvedValue(undefined),
    reloadWorldInfoEditor: jest.fn(),
    convertCharacterBook: jest.fn((book: any) => {
        const entry = book.entries[0];
        return {
            entries: {
                [entry.id]: {
                    uid: entry.id,
                    displayIndex: entry.extensions?.display_index ?? 0,
                    comment: entry.comment,
                    disable: !entry.enabled,
                    constant: entry.constant,
                    selective: entry.selective,
                    key: entry.keys,
                    keysecondary: entry.secondary_keys,
                    selectiveLogic: 0,
                    scanDepth: null,
                    vectorized: false,
                    position: 1,
                    role: 0,
                    depth: 4,
                    order: entry.insertion_order,
                    content: entry.content,
                    useProbability: true,
                    probability: 100,
                    excludeRecursion: false,
                    preventRecursion: false,
                    delayUntilRecursion: false,
                    sticky: null,
                    cooldown: null,
                    delay: null,
                },
            },
            originalData: book,
        };
    }),
    getCharacterCardFields: jest.fn().mockReturnValue({ name: 'Test Character' }),
    ToolManager: {
        isToolCallingSupported: jest.fn().mockReturnValue(true),
        registerFunctionTool: jest.fn(),
        unregisterFunctionTool: jest.fn(),
    },
    registerMacro: jest.fn(),
    unregisterMacro: jest.fn(),
    chatCompletionSettings: { function_calling: true },
    chat: [],
    extension_settings: {},
};
(globalThis as any).builtin = {
    saveSettings: jest.fn().mockResolvedValue(undefined),
};

(globalThis as any).appendInexistentScriptButtons = jest.fn();
(globalThis as any).getButtonEvent = jest.fn((button_name: string) => button_name);
(globalThis as any).eventOnButton = jest.fn();
const TEST_SCRIPT_ID = 'test-script-id';
(globalThis as any).getScriptId = jest.fn(() => TEST_SCRIPT_ID);
(globalThis as any).$ = $;
(globalThis as any).jQuery = $;
(globalThis as any).watch = watch;
(globalThis as any).structuredClone =
    (globalThis as any).structuredClone ?? ((value: unknown) => klona(value));

const __eventHandlers = new Map<string, Array<(...args: unknown[]) => unknown>>();

// 窗口环境：提供脚本依赖的浏览器窗口对象。
(globalThis as any).atob =
    (globalThis as any).atob ??
    ((value: string) => Buffer.from(value, 'base64').toString('binary'));

// 酒馆助手：提供测试需要的脚本接口入口。
(globalThis as any).window.TavernHelper = {
    substitudeMacros: jest.fn(input => input),
};

// 事件环境：固定测试使用的酒馆事件名。
(globalThis as any).tavern_events = {
    GENERATION_ENDED: 'GENERATION_ENDED',
    GENERATION_STOPPED: 'GENERATION_STOPPED',
    MESSAGE_SENT: 'MESSAGE_SENT',
    GENERATION_STARTED: 'GENERATION_STARTED',
    WORLDINFO_UPDATED: 'WORLDINFO_UPDATED',
    CHAT_CHANGED: 'CHAT_CHANGED',
    CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
    CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
    WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded',
    WORLDINFO_SCAN_DONE: 'worldinfo_scan_done',
};

// 用例隔离：每次重建 Pinia 和可变设置，避免前一用例污染后续场景。
beforeEach(() => {
    setActivePinia(createPinia());
    __eventHandlers.clear();
    const silly_tavern = (globalThis as any).SillyTavern;
    if (jest.isMockFunction(silly_tavern.getCurrentLocale)) {
        silly_tavern.getCurrentLocale.mockReturnValue('zh-CN');
    } else {
        silly_tavern.getCurrentLocale = jest.fn().mockReturnValue('zh-CN');
    }
    (globalThis as any).SillyTavern.chatCompletionSettings = { function_calling: true };
    (globalThis as any).builtin.saveSettings = jest.fn().mockResolvedValue(undefined);
    (globalThis as any).stopGenerationById = jest.fn().mockReturnValue(true);
});

// 宿主接口：为测试环境缺失的全局函数提供可观测的模拟实现。
(globalThis as any).eventOn = jest.fn((event: string, handler: (...args: unknown[]) => unknown) => {
    const bridged = (globalThis as any).eventOnButton;
    if (typeof bridged === 'function') {
        bridged(event, handler);
    }

    if (!__eventHandlers.has(event)) {
        __eventHandlers.set(event, []);
    }
    __eventHandlers.get(event)!.push(handler);

    // 首选脚本监听在测试中立即读取当前选择，模拟宿主订阅后的初始通知。
    if (event.startsWith('th_unique_check.')) {
        handler(TEST_SCRIPT_ID);
    }
});
(globalThis as any).eventMakeFirst = jest.fn(
    (event: string, handler: (...args: unknown[]) => unknown) => {
        const handlers = __eventHandlers.get(event) ?? [];
        const existing_index = handlers.indexOf(handler);
        if (existing_index !== -1) handlers.splice(existing_index, 1);
        handlers.unshift(handler);
        __eventHandlers.set(event, handlers);
        return { stop: () => (globalThis as any).eventRemoveListener(event, handler) };
    }
);
(globalThis as any).eventMakeLast = jest.fn(
    (event: string, handler: (...args: unknown[]) => unknown) => {
        if (!__eventHandlers.has(event)) {
            __eventHandlers.set(event, []);
        }

        const handlers = __eventHandlers.get(event)!;
        const existing_index = handlers.indexOf(handler);
        if (existing_index !== -1) {
            handlers.splice(existing_index, 1);
        }
        handlers.push(handler);

        return {
            stop: jest.fn(() => {
                (globalThis as any).eventRemoveListener(event, handler);
            }),
        };
    }
);
(globalThis as any).eventRemoveListener = jest.fn(
    (event: string, handler: (...args: unknown[]) => unknown) => {
        const handlers = __eventHandlers.get(event);
        if (!handlers) {
            return;
        }
        const index = handlers.indexOf(handler);
        if (index !== -1) {
            handlers.splice(index, 1);
        }
    }
);
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
(globalThis as any).stopGenerationById = jest.fn();
(globalThis as any).replaceVariables = jest.fn();
(globalThis as any).setChatMessage = jest.fn();
(globalThis as any).setChatMessages = jest.fn();
(globalThis as any).getCurrentCharPrimaryLorebook = jest.fn();
(globalThis as any).getCharWorldbookNames = jest.fn(() => ({ primary: null, additional: [] }));
(globalThis as any).updateWorldbookWith = jest.fn();
(globalThis as any).getAvailableLorebooks = jest.fn();
(globalThis as any).substitudeMacros = jest.fn(input => input);
(globalThis as any).insertOrAssignVariables = jest.fn();
