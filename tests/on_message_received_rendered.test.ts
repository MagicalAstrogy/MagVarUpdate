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

describe('onMessageReceived 自动解析与渲染后写回', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupEnvironment();
    });

    test('自动解析在 MESSAGE_RECEIVED 启动但不阻塞返回，且不提前写回', async () => {
        const { promise, resolve } = Promise.withResolvers<string | null>();
        mockInvoke.mockReturnValue(promise);

        await onMessageReceived(2);

        // 解析已开始，但事件处理已返回（正文渲染不被拖住），且尚未写回。
        expect(mockInvoke).toHaveBeenCalledTimes(1);
        expect(set_chat_messages).not.toHaveBeenCalled();

        resolve(UPDATE_RESULT);
        await flushMicrotasks();
        // 写回只在渲染事件中进行。
        expect(set_chat_messages).not.toHaveBeenCalled();
    });

    test('渲染事件等待在途解析完成并写回结果与变量', async () => {
        const { promise, resolve } = Promise.withResolvers<string | null>();
        mockInvoke.mockReturnValue(promise);

        await onMessageReceived(2);

        let rendered_settled = false;
        const rendered = onCharacterMessageRendered(2).then(() => {
            rendered_settled = true;
        });
        await flushMicrotasks();
        // 解析未完成，渲染事件仍在等待。
        expect(rendered_settled).toBe(false);

        resolve(UPDATE_RESULT);
        await rendered;

        expect(rendered_settled).toBe(true);
        expect(set_chat_messages).toHaveBeenCalledWith(
            [{ message_id: 2, message: `${MESSAGE_TEXT}\n\n${UPDATE_RESULT}` }],
            { refresh: 'none' }
        );
        expect(mockHandleVariables).toHaveBeenCalledWith(2);
    });

    test('写回触发的重入渲染事件不会死锁', async () => {
        // 变量更新会以 refresh:'affected' 再次触发渲染事件；此处模拟该重入。
        mockHandleVariables.mockImplementation(async message_id => {
            await onCharacterMessageRendered(message_id);
        });

        await onMessageReceived(2);

        // 若写回未先摘除在途记录，这里会等待自身而永久挂起。
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
        await onCharacterMessageRendered(2);

        expect(set_chat_messages).not.toHaveBeenCalled();
        expect(mockHandleVariables).not.toHaveBeenCalled();
    });

    test('手动重试等待在途解析，且不重复解析同一楼层', async () => {
        const { promise, resolve } = Promise.withResolvers<string | null>();
        mockInvoke.mockReturnValue(promise);

        await onMessageReceived(2);
        expect(mockInvoke).toHaveBeenCalledTimes(1);

        let retry_settled = false;
        const retry = onMessageReceived(2, { force: true }).then(() => {
            retry_settled = true;
        });
        await flushMicrotasks();
        // 手动重试需等待在途解析，避免并发调用被全局互斥挡下而误报失败。
        expect(retry_settled).toBe(false);

        resolve(UPDATE_RESULT);
        await retry;

        // 该解析已处理本楼层，手动重试不应再发一次请求（避免非幂等命令执行两次）。
        expect(mockInvoke).toHaveBeenCalledTimes(1);
        expect(set_chat_messages).toHaveBeenCalledTimes(1);
    });

    test('解析失败时提示错误且不写回，但仍处理变量', async () => {
        mockInvoke.mockResolvedValue(null);
        const toast_error = jest.fn();
        (globalThis as Record<string, unknown>).toastr = { error: toast_error };

        await onMessageReceived(2);
        await onCharacterMessageRendered(2);

        expect(set_chat_messages).not.toHaveBeenCalled();
        expect(toast_error).toHaveBeenCalled();
        expect(mockHandleVariables).toHaveBeenCalledWith(2);
    });

    test('同楼层重新生成时，旧解析的结果不再写回', async () => {
        const first = Promise.withResolvers<string | null>();
        const second = Promise.withResolvers<string | null>();
        mockInvoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

        await onMessageReceived(2);
        // 重新生成：同一楼层再次触发，取代旧解析。
        await onMessageReceived(2);

        first.resolve('<UpdateVariable>_.set("health", 1);//旧</UpdateVariable>');
        await flushMicrotasks();

        second.resolve(UPDATE_RESULT);
        await onCharacterMessageRendered(2);

        // 只有最新一次解析的结果被写回。
        expect(set_chat_messages).toHaveBeenCalledTimes(1);
        expect(set_chat_messages).toHaveBeenCalledWith(
            [{ message_id: 2, message: `${MESSAGE_TEXT}\n\n${UPDATE_RESULT}` }],
            { refresh: 'none' }
        );
    });
});
