import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { isFunctionCallingSupported } from '@/function/is_function_calling_supported';
import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import { onMessageReceived } from '@/function/update/on_message_received';
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

/** 让自动触发的 onMessageReceived 能通过前置校验的最小环境。 */
function setupAutoTriggerEnvironment(message_text: string) {
    mockIsExtraModelSupported.mockResolvedValue(true);
    mockIsFunctionCallingSupported.mockResolvedValue(true);
    mockHandleVariables.mockResolvedValue(undefined);
    mockInvoke.mockResolvedValue(UPDATE_RESULT);
    (globalThis as any).setChatMessages = jest.fn().mockResolvedValue(undefined);
    (globalThis as any).getChatMessages = jest.fn().mockReturnValue([
        { name: 'Assistant', message: message_text },
    ]);
    (globalThis as any).SillyTavern = {
        ...(globalThis as any).SillyTavern,
        name2: 'Assistant',
        chat: [{}, {}, {}],
        getCurrentChatId: jest.fn().mockReturnValue('test-chat'),
    };

    const store = useDataStore();
    store.settings.更新方式 = '额外模型解析';
    store.settings.额外模型解析配置.启用自动请求 = true;
    store.settings.额外模型解析配置.自动解析延时 = 0;
    store.settings.额外模型解析配置.应答格式 = '聊天消息';
}

async function flushTimers(ms = 30): Promise<void> {
    await jest.advanceTimersByTimeAsync(ms);
}

describe('onMessageReceived 自动触发的延后解析', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('自动触发不等待解析完成即返回，解析在延时结束后才执行并回写', async () => {
        setupAutoTriggerEnvironment('回复正文内容');

        const received_promise = onMessageReceived(2);
        await Promise.resolve();
        expect(mockInvoke).not.toHaveBeenCalled();

        await received_promise;
        expect(mockInvoke).not.toHaveBeenCalled();

        await flushTimers();
        expect(mockInvoke).toHaveBeenCalledTimes(1);
        expect((globalThis as any).setChatMessages).toHaveBeenCalledWith(
            [
                {
                    message_id: 2,
                    message: '回复正文内容\n\n' + UPDATE_RESULT,
                },
            ],
            { refresh: 'none' }
        );
        expect(mockHandleVariables).toHaveBeenCalledWith(2);
    });

    test('自动解析延时可配置：按设置秒数等待后执行', async () => {
        setupAutoTriggerEnvironment('回复正文内容');
        useDataStore().settings.额外模型解析配置.自动解析延时 = 3;

        const received_promise = onMessageReceived(2);
        await received_promise;

        await jest.advanceTimersByTimeAsync(2999);
        expect(mockInvoke).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1);
        expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    test('不同消息的解析排队执行，后续消息不被丢弃', async () => {
        setupAutoTriggerEnvironment('回复正文内容');

        // 模拟第一个解析长时间运行，期间第二条消息到来。
        const gate = Promise.withResolvers<void>();
        mockInvoke.mockImplementationOnce(async () => {
            await gate.promise;
            return UPDATE_RESULT;
        });

        const first = onMessageReceived(2);
        await first;
        await flushTimers();

        // 第一条解析在执行中。
        expect(mockInvoke).toHaveBeenCalledTimes(1);

        // 第二条消息到来，调度其解析。
        const second = onMessageReceived(3);
        await second;
        await flushTimers();
        // 第二条排队中，尚未开始（避免并发踩全局状态）。
        expect(mockInvoke).toHaveBeenCalledTimes(1);

        // 释放第一条，第二条随即执行。
        gate.resolve();
        await flushTimers();
        expect(mockInvoke).toHaveBeenCalledTimes(2);
    });

    test('同一消息延后任务去重：重复调度不会执行两次', async () => {
        setupAutoTriggerEnvironment('回复正文内容');

        // 同一条消息连续触发两次自动调度。
        const first = onMessageReceived(2);
        await first;
        const second = onMessageReceived(2);
        await second;
        await flushTimers();

        // 只执行一次。
        expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    test('切换聊天后延后任务放弃解析与回写', async () => {
        setupAutoTriggerEnvironment('回复正文内容');

        const received_promise = onMessageReceived(2);
        await received_promise;

        // 延时期间用户切换到别的聊天。
        (globalThis as any).SillyTavern.getCurrentChatId.mockReturnValue('other-chat');
        await flushTimers();

        // 不调用解析，也不回写。
        expect(mockInvoke).not.toHaveBeenCalled();
        expect((globalThis as any).setChatMessages).not.toHaveBeenCalled();
    });

    test('手动 force 触发保持同步：解析完成前 onMessageReceived 不 resolve', async () => {
        setupAutoTriggerEnvironment('回复正文内容');

        const gate = Promise.withResolvers<void>();
        mockInvoke.mockImplementation(async () => {
            await gate.promise;
            return UPDATE_RESULT;
        });

        const received_promise = onMessageReceived(2, { force: true });
        let resolved = false;
        void received_promise.then(() => {
            resolved = true;
        });

        await Promise.resolve();
        expect(resolved).toBe(false);

        gate.resolve();
        await received_promise;
        expect(resolved).toBe(true);
        expect((globalThis as any).setChatMessages).toHaveBeenCalledWith(
            [
                {
                    message_id: 2,
                    message: '回复正文内容\n\n' + UPDATE_RESULT,
                },
            ],
            { refresh: 'none' }
        );
    });

    test('手动重试后，同消息待执行的自动延后任务不再执行（避免非幂等命令重复）', async () => {
        setupAutoTriggerEnvironment('回复正文内容');
        useDataStore().settings.额外模型解析配置.自动解析延时 = 5;

        // 先调度自动延后任务（尚未到延时）。
        const auto_promise = onMessageReceived(2);
        await auto_promise;
        expect(mockInvoke).not.toHaveBeenCalled();

        // 延时内用户手动重试（force 同步执行）。
        mockInvoke.mockResolvedValueOnce(UPDATE_RESULT);
        const retry_promise = onMessageReceived(2, { force: true });
        await retry_promise;
        expect(mockInvoke).toHaveBeenCalledTimes(1);

        // 时间推进到自动延后触发：因同消息已处理，不再重复执行。
        await jest.advanceTimersByTimeAsync(5000);
        expect(mockInvoke).toHaveBeenCalledTimes(1);

        // 结果只回写一次。
        expect((globalThis as any).setChatMessages).toHaveBeenCalledTimes(1);
    });

    test('解析结果为空时提示错误而非回写', async () => {
        setupAutoTriggerEnvironment('回复正文内容');
        mockInvoke.mockResolvedValue(null);
        (globalThis as any).toastr = {
            ...(globalThis as any).toastr,
            error: jest.fn(),
        };

        const received_promise = onMessageReceived(2);
        await received_promise;
        await flushTimers();

        expect((globalThis as any).setChatMessages).not.toHaveBeenCalled();
        expect((globalThis as any).toastr.error).toHaveBeenCalled();
    });

    test('自动解析延时默认 1 秒，并钳制到 0-10 秒范围', () => {
        // 清空可能残留的设置，验证全新初始默认值。
        (globalThis as any).SillyTavern.extensionSettings = {};
        useDataStore()._reload_settings();
        expect(useDataStore().settings.额外模型解析配置.自动解析延时).toBe(1);

        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                额外模型解析配置: {
                    自动解析延时: 99,
                },
            },
        };
        let store = useDataStore();
        store._reload_settings();
        expect(store.settings.额外模型解析配置.自动解析延时).toBe(10);

        (globalThis as any).SillyTavern.extensionSettings = {
            mvu_settings: {
                额外模型解析配置: {
                    自动解析延时: -5,
                },
            },
        };
        store = useDataStore();
        store._reload_settings();
        expect(store.settings.额外模型解析配置.自动解析延时).toBe(0);
    });
});