import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { isFunctionCallingSupported } from '@/function/is_function_calling_supported';
import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import {
    onCharacterMessageRendered,
    onMessageReceived,
} from '@/function/update/on_message_received';
import { handleVariablesInMessage } from '@/function/update_variables';
import { useDataStore } from '@/store';

jest.mock('@/function/is_extra_model_supported', () => ({
    isExtraModelSupported: jest.fn(),
}));
jest.mock('@/function/is_function_calling_supported', () => ({
    isFunctionCallingSupported: jest.fn(),
}));
jest.mock('@/function/update/invoke_extra_model', () => ({
    invokeExtraModelWithStrategy: jest.fn(),
}));
jest.mock('@/function/update_variables', () => ({
    handleVariablesInMessage: jest.fn(),
}));

const mockIsExtraModelSupported = isExtraModelSupported as unknown as jest.Mock<Promise<boolean>>;
const mockIsFunctionCallingSupported = isFunctionCallingSupported as unknown as jest.Mock<
    Promise<boolean>
>;
const mockInvoke = invokeExtraModelWithStrategy as jest.MockedFunction<
    typeof invokeExtraModelWithStrategy
>;
const mockHandleVariables = handleVariablesInMessage as jest.MockedFunction<
    typeof handleVariablesInMessage
>;

const UPDATE_RESULT = '<UpdateVariable>_.set("health", 80);//受击</UpdateVariable>';
const MESSAGE_TEXT = '回复正文内容';
const CHAT_ID = 'chat-1';

let set_chat_messages: jest.Mock;
let get_current_chat_id: jest.Mock;

/** 让出微任务队列，使挂起的 await 链推进（不使用真实计时器）。 */
async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 20; i++) {
        await Promise.resolve();
    }
}

/** 自动触发路径能通过前置校验的最小环境。 */
function setupEnvironment() {
    mockIsExtraModelSupported.mockResolvedValue(true);
    mockIsFunctionCallingSupported.mockResolvedValue(true);
    mockInvoke.mockResolvedValue(UPDATE_RESULT);
    mockHandleVariables.mockResolvedValue(undefined);

    set_chat_messages = jest.fn().mockResolvedValue(undefined);
    get_current_chat_id = jest.fn().mockReturnValue(CHAT_ID);

    const globals = globalThis as Record<string, unknown>;
    globals.setChatMessages = set_chat_messages;
    globals.getChatMessages = jest
        .fn()
        .mockReturnValue([{ name: 'Assistant', message: MESSAGE_TEXT }]);
    globals.SillyTavern = {
        ...(globals.SillyTavern as Record<string, unknown>),
        name2: 'Assistant',
        chat: [{}, {}, {}],
        getCurrentChatId: get_current_chat_id,
    };

    const store = useDataStore();
    store.settings.更新方式 = '额外模型解析';
    store.settings.额外模型解析配置.启用自动请求 = true;
    store.settings.额外模型解析配置.应答格式 = '聊天消息';
}

/** 等待所有在途任务结束，避免模块级状态影响后续用例。 */
async function drainTasks(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        await Promise.resolve();
    }
}

describe('onMessageReceived 自动解析的生命周期', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupEnvironment();
    });

    afterEach(async () => {
        await drainTasks();
    });

    test('自动解析在 MESSAGE_RECEIVED 启动但不阻塞返回，且不提前写回', async () => {
        const { promise, resolve } = Promise.withResolvers<string | null>();
        mockInvoke.mockReturnValue(promise);

        await onMessageReceived(2);
        await flushMicrotasks();

        // 解析已开始、事件已返回（正文渲染不被拖住），且尚未写回。
        expect(mockInvoke).toHaveBeenCalledTimes(1);
        expect(set_chat_messages).not.toHaveBeenCalled();

        resolve(UPDATE_RESULT);
        await drainTasks();
    });

    test('渲染事件早于任务启动时（MESSAGE_RECEIVED 被节流推迟），结果仍会被应用', async () => {
        // 模拟节流：渲染事件先发生，此时还没有任务。
        await onCharacterMessageRendered(2);
        expect(set_chat_messages).not.toHaveBeenCalled();

        // 任务随后才启动，且不再有第二个渲染事件。
        await onMessageReceived(2);
        await flushMicrotasks();

        expect(set_chat_messages).toHaveBeenCalledTimes(1);
        expect(set_chat_messages).toHaveBeenCalledWith(
            [{ message_id: 2, message: `${MESSAGE_TEXT}\n\n${UPDATE_RESULT}` }],
            { refresh: 'none' }
        );
    });

    test('渲染事件等待在途解析完成后再返回', async () => {
        const { promise, resolve } = Promise.withResolvers<string | null>();
        mockInvoke.mockReturnValue(promise);

        await onMessageReceived(2);
        await flushMicrotasks();

        let rendered_settled = false;
        const rendered = onCharacterMessageRendered(2).then(() => {
            rendered_settled = true;
        });
        await flushMicrotasks();
        expect(rendered_settled).toBe(false);

        resolve(UPDATE_RESULT);
        await rendered;

        expect(rendered_settled).toBe(true);
        expect(set_chat_messages).toHaveBeenCalledTimes(1);
    });

    test('并发任务串行启动，不撞解析函数的全局互斥', async () => {
        const first = Promise.withResolvers<string | null>();
        mockInvoke.mockReturnValueOnce(first.promise).mockResolvedValue(UPDATE_RESULT);

        await onMessageReceived(2);
        await onMessageReceived(3);
        await flushMicrotasks();

        // 第一个解析未结束时，第二个任务不得调用解析（否则互斥会返回 null 而误报失败）。
        expect(mockInvoke).toHaveBeenCalledTimes(1);

        first.resolve(UPDATE_RESULT);
        await drainTasks();

        expect(mockInvoke).toHaveBeenCalledTimes(2);
    });

    test('手动重试识别同楼层在途任务，不发出第二次请求', async () => {
        const { promise, resolve } = Promise.withResolvers<string | null>();
        mockInvoke.mockReturnValue(promise);

        await onMessageReceived(2);
        await flushMicrotasks();
        expect(mockInvoke).toHaveBeenCalledTimes(1);

        // 渲染事件进入等待（此时解析仍未完成）。
        const rendered = onCharacterMessageRendered(2);
        await flushMicrotasks();

        // 在渲染事件等待期间手动重试：必须识别到在途任务，而不是另发请求。
        let retry_settled = false;
        const retry = onMessageReceived(2, { force: true }).then(() => {
            retry_settled = true;
        });
        await flushMicrotasks();

        expect(retry_settled).toBe(false);
        expect(mockInvoke).toHaveBeenCalledTimes(1);

        resolve(UPDATE_RESULT);
        await rendered;
        await retry;
        await drainTasks();

        expect(retry_settled).toBe(true);
        // 全部任务结束后仍只有一次请求：重试没有另起一次解析（否则非幂等命令会执行两次）。
        expect(mockInvoke).toHaveBeenCalledTimes(1);
        expect(set_chat_messages).toHaveBeenCalledTimes(1);
    });

    test('写回触发的重入渲染事件不会死锁', async () => {
        // 变量更新会以 refresh:'affected' 再次触发渲染事件；此处模拟该重入。
        mockHandleVariables.mockImplementation(async message_id => {
            await onCharacterMessageRendered(message_id);
        });

        await onMessageReceived(2);

        await expect(
            Promise.race([
                onCharacterMessageRendered(2),
                flushMicrotasks().then(() => {
                    throw new Error('DEADLOCK');
                }),
            ])
        ).resolves.toBeUndefined();

        expect(set_chat_messages).toHaveBeenCalledTimes(1);
        expect(mockHandleVariables).toHaveBeenCalledTimes(1);
    });

    test('解析期间切换聊天时不写回', async () => {
        const { promise, resolve } = Promise.withResolvers<string | null>();
        mockInvoke.mockReturnValue(promise);

        await onMessageReceived(2);
        get_current_chat_id.mockReturnValue('chat-2');

        resolve(UPDATE_RESULT);
        await drainTasks();

        expect(set_chat_messages).not.toHaveBeenCalled();
        expect(mockHandleVariables).not.toHaveBeenCalled();
    });

    test('同楼层重新生成时，旧解析的结果不再写回', async () => {
        const first = Promise.withResolvers<string | null>();
        const second = Promise.withResolvers<string | null>();
        mockInvoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

        await onMessageReceived(2);
        // 重新生成：同一楼层再次触发，取代旧任务。
        await onMessageReceived(2);

        first.resolve('<UpdateVariable>_.set("health", 1);//旧</UpdateVariable>');
        await drainTasks();
        expect(set_chat_messages).not.toHaveBeenCalled();

        second.resolve(UPDATE_RESULT);
        await drainTasks();

        // 只有最新一次解析的结果被写回。
        expect(set_chat_messages).toHaveBeenCalledTimes(1);
        expect(set_chat_messages).toHaveBeenCalledWith(
            [{ message_id: 2, message: `${MESSAGE_TEXT}\n\n${UPDATE_RESULT}` }],
            { refresh: 'none' }
        );
    });

    test('解析失败时提示错误且不写回，但仍处理变量', async () => {
        mockInvoke.mockResolvedValue(null);
        const toast_error = jest.fn();
        (globalThis as Record<string, unknown>).toastr = { error: toast_error };

        await onMessageReceived(2);
        await drainTasks();

        expect(set_chat_messages).not.toHaveBeenCalled();
        expect(toast_error).toHaveBeenCalled();
        expect(mockHandleVariables).toHaveBeenCalledWith(2);
    });
});
