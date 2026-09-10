import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { isFunctionCallingSupported } from '@/function/is_function_calling_supported';
import {
    isExtraModelAnalysisInProgress,
    invokeExtraModelWithStrategy,
} from '@/function/update/invoke_extra_model';
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
    isExtraModelAnalysisInProgress: jest.fn(),
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
const mockAnalysisInProgress = isExtraModelAnalysisInProgress as unknown as jest.Mock<boolean>;
const mockHandleVariables = handleVariablesInMessage as jest.MockedFunction<
    typeof handleVariablesInMessage
>;

const UPDATE_RESULT = '<UpdateVariable>_.set("health", 80);//受击</UpdateVariable>';

/** 让自动触发的 onMessageReceived 能通过前置校验的最小环境。 */
function setupAutoTriggerEnvironment(message_text: string) {
    mockIsExtraModelSupported.mockResolvedValue(true);
    mockIsFunctionCallingSupported.mockResolvedValue(true);
    mockHandleVariables.mockResolvedValue(undefined);
    mockAnalysisInProgress.mockReturnValue(false);
    mockInvoke.mockResolvedValue(UPDATE_RESULT);
    (globalThis as any).setChatMessages = jest.fn().mockResolvedValue(undefined);
    (globalThis as any).getChatMessages = jest.fn().mockReturnValue([
        { name: 'Assistant', message: message_text },
    ]);
    (globalThis as any).SillyTavern = {
        ...(globalThis as any).SillyTavern,
        name2: 'Assistant',
        chat: [{}, {}, {}],
    };

    const store = useDataStore();
    store.settings.更新方式 = '额外模型解析';
    store.settings.额外模型解析配置.启用自动请求 = true;
    store.settings.额外模型解析配置.自动解析延时 = 0;
    store.settings.额外模型解析配置.应答格式 = '聊天消息';
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

        // 关键语义：await onMessageReceived 时，额外解析尚未开始（不阻塞事件链）。
        const received_promise = onMessageReceived(2);
        await Promise.resolve();
        expect(mockInvoke).not.toHaveBeenCalled();

        await received_promise;
        // 即使 onMessageReceived 已 resolve，解析仍未执行 —— 被延后到计时器之后。
        expect(mockInvoke).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(0);

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

        // 3 秒前不执行
        await jest.advanceTimersByTimeAsync(2999);
        expect(mockInvoke).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1);
        expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    test('若已有解析在进行（如手动触发），自动延后任务会跳过避免重复', async () => {
        setupAutoTriggerEnvironment('回复正文内容');
        mockAnalysisInProgress.mockReturnValue(true);

        const received_promise = onMessageReceived(2);
        await received_promise;
        await jest.advanceTimersByTimeAsync(0);

        expect(mockInvoke).not.toHaveBeenCalled();
        expect(mockHandleVariables).not.toHaveBeenCalled();
    });

    test('手动 force 触发保持同步：解析完成前 onMessageReceived 不 resolve', async () => {
        setupAutoTriggerEnvironment('回复正文内容');

        // 模拟解析需要一段时间才返回。
        const { promise: gate_promise, resolve: gate_resolve } = Promise.withResolvers<void>();
        mockInvoke.mockImplementation(async () => {
            await gate_promise;
            return UPDATE_RESULT;
        });

        const received_promise = onMessageReceived(2, { force: true });
        let resolved = false;
        void received_promise.then(() => {
            resolved = true;
        });

        // 解析挂起时，手动路径确实在等待（阻塞语义保留）。
        await Promise.resolve();
        expect(resolved).toBe(false);

        gate_resolve();
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

    test('解析结果为空时提示错误而非回写', async () => {
        setupAutoTriggerEnvironment('回复正文内容');
        mockInvoke.mockResolvedValue(null);
        (globalThis as any).toastr = {
            ...(globalThis as any).toastr,
            error: jest.fn(),
        };

        const received_promise = onMessageReceived(2);
        await received_promise;
        await jest.advanceTimersByTimeAsync(0);

        expect((globalThis as any).setChatMessages).not.toHaveBeenCalled();
        expect((globalThis as any).toastr.error).toHaveBeenCalled();
    });

    test('自动解析延时默认 1 秒，并钳制到 0-10 秒范围', () => {
        // 清空可能残留的设置，验证全新初始默认值
        (globalThis as any).SillyTavern.extensionSettings = {};
        useDataStore()._reload_settings();
        // 默认值
        expect(useDataStore().settings.额外模型解析配置.自动解析延时).toBe(1);

        // 超上限钳到 10
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

        // 低于下限钳到 0
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
