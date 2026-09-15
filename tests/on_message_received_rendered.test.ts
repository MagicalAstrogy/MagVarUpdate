import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { isFunctionCallingSupported } from '@/function/is_function_calling_supported';
import { initResponse } from '@/function/update';
import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import { onMessageReceived } from '@/function/update/on_message_received';
import { handleVariablesInMessage } from '@/function/update_variables';
import { useDataStore } from '@/store';
import { nextTick } from 'vue';

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

const mockIsExtraModelSupported = jest.mocked(isExtraModelSupported);
const mockIsFunctionCallingSupported = jest.mocked(isFunctionCallingSupported);
const mockInvoke = jest.mocked(invokeExtraModelWithStrategy);
const mockHandleVariables = jest.mocked(handleVariablesInMessage);

const UPDATE_RESULT = '<UpdateVariable>_.set("health", 80);//受击</UpdateVariable>';
const MESSAGE_TEXT = '回复正文内容';

const emitRendered = (message_id = 2) =>
    eventEmit(tavern_events.CHARACTER_MESSAGE_RENDERED, message_id, 'normal');
const emitReceived = (message_id = 2) =>
    eventEmit(tavern_events.MESSAGE_RECEIVED, message_id, 'normal');

function createMessage(message = MESSAGE_TEXT): SillyTavern.ChatMessage {
    return { name: 'Assistant', mes: message, is_user: false, is_system: false, swipe_id: 0 };
}

describe('onMessageReceived 请求闭包中的临时渲染监听', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        mockIsExtraModelSupported.mockReset().mockResolvedValue(true);
        mockIsFunctionCallingSupported.mockReturnValue(true);
        mockInvoke.mockReset().mockResolvedValue(UPDATE_RESULT);
        mockHandleVariables.mockReset().mockResolvedValue(undefined);
        Object.assign(SillyTavern, {
            extensionSettings: {},
            name2: 'Assistant',
            chat: [createMessage(), createMessage(), createMessage()],
            getCurrentChatId: jest.fn().mockReturnValue('chat-1'),
        });
        jest.mocked(getChatMessages).mockImplementation((message_id: number | string) => {
            const message = SillyTavern.chat[Number(message_id)];
            return message ? [{ name: message.name, message: message.mes } as ChatMessage] : [];
        });
        jest.mocked(setChatMessages).mockImplementation(async messages => {
            for (const message of messages) {
                if ('message' in message && message.message !== undefined) {
                    SillyTavern.chat[message.message_id].mes = message.message;
                }
            }
        });
        (globalThis as any).toastr = { error: jest.fn() };

        const store = useDataStore();
        store.should_enable = true;
        await nextTick();
        store.settings.兼容性.额外模型解析非阻塞 = true;
        store.settings.更新方式 = '额外模型解析';
        store.settings.额外模型解析配置.启用自动请求 = true;
        store.settings.额外模型解析配置.模型来源 = '自定义';
        store.settings.额外模型解析配置.应答格式 = '聊天消息';
    });

    test.each(['聊天消息', '格式化输出', '格式化输出(v4兼容)'] as const)(
        '%s 在接收时立即解析，目标楼层渲染后等待结果并写回',
        async format => {
            useDataStore().settings.额外模型解析配置.应答格式 = format;
            const pending = Promise.withResolvers<string | null>();
            mockInvoke.mockReturnValueOnce(pending.promise);

            await onMessageReceived(2);
            expect(mockInvoke).toHaveBeenCalledTimes(1);
            expect(setChatMessages).not.toHaveBeenCalled();
            await emitRendered(1);
            expect(mockInvoke).toHaveBeenCalledTimes(1);
            expect(setChatMessages).not.toHaveBeenCalled();

            let finished = false;
            const rendered = emitRendered().then(() => {
                finished = true;
            });
            expect(mockInvoke).toHaveBeenCalledTimes(1);
            expect(setChatMessages).not.toHaveBeenCalled();
            expect(finished).toBe(false);

            pending.resolve(UPDATE_RESULT);
            await rendered;
            expect(setChatMessages).toHaveBeenCalledWith(
                [{ message_id: 2, message: MESSAGE_TEXT + '\n\n' + UPDATE_RESULT }],
                { refresh: 'none' }
            );
            expect(mockHandleVariables).toHaveBeenCalledWith(2);
            await emitRendered();
            expect(mockInvoke).toHaveBeenCalledTimes(1);
        }
    );

    test.each(['工具调用', '手动重试', '关闭开关'] as const)(
        '%s 直接等待，无需渲染事件',
        async mode => {
            if (mode === '工具调用') {
                useDataStore().settings.额外模型解析配置.应答格式 = '工具调用';
            }
            if (mode === '关闭开关') {
                useDataStore().settings.兼容性.额外模型解析非阻塞 = false;
            }
            const started = Promise.withResolvers<void>();
            const pending = Promise.withResolvers<string | null>();
            mockInvoke.mockImplementationOnce(() => {
                started.resolve();
                return pending.promise;
            });
            let finished = false;
            const received = onMessageReceived(2, { force: mode === '手动重试' }).then(() => {
                finished = true;
            });
            await started.promise;
            expect(finished).toBe(false);
            expect(
                jest
                    .mocked(eventOn)
                    .mock.calls.some(
                        ([event]) => event === tavern_events.CHARACTER_MESSAGE_RENDERED
                    )
            ).toBe(false);
            pending.resolve(UPDATE_RESULT);
            await received;
            expect(mockHandleVariables).toHaveBeenCalledWith(2);
        }
    );

    test('结果先于渲染返回时仍延后写回，途中关闭开关不改变本次请求', async () => {
        await onMessageReceived(2);
        expect(mockInvoke).toHaveBeenCalledTimes(1);
        expect(setChatMessages).not.toHaveBeenCalled();
        useDataStore().settings.兼容性.额外模型解析非阻塞 = false;
        await emitRendered(1);
        expect(setChatMessages).not.toHaveBeenCalled();
        await emitRendered();
        expect(setChatMessages).toHaveBeenCalledTimes(1);
    });

    test('请求早于渲染失败时不会产生未处理拒绝，渲染仍收到原异常', async () => {
        const error = new Error('early failure');
        mockInvoke.mockRejectedValueOnce(error);
        await onMessageReceived(2);
        // 跨过一次事件循环，让未处理的 Promise 拒绝有机会暴露。
        await new Promise(resolve => setTimeout(resolve, 0));
        await expect(emitRendered()).rejects.toBe(error);
        expect(setChatMessages).not.toHaveBeenCalled();
    });

    test('变量写回重入渲染时不会重复解析或等待自身', async () => {
        mockHandleVariables.mockImplementation(async message_id => {
            await emitRendered(message_id);
        });
        await onMessageReceived(2);
        await emitRendered();
        expect(mockInvoke).toHaveBeenCalledTimes(1);
        expect(mockHandleVariables).toHaveBeenCalledTimes(1);
    });

    test('同楼层的新 swipe 使用自己的闭包，旧监听不影响新监听', async () => {
        const first = Promise.withResolvers<string | null>();
        const second = Promise.withResolvers<string | null>();
        mockInvoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        await onMessageReceived(2);
        SillyTavern.chat[2].swipe_id = 1;
        SillyTavern.chat[2].mes = '重新生成后的正文';
        await onMessageReceived(2);
        const rendered = emitRendered();
        second.resolve(UPDATE_RESULT);
        await rendered;
        first.resolve('过期的解析结果');
        expect(mockInvoke).toHaveBeenCalledTimes(2);
        expect(setChatMessages).toHaveBeenCalledWith(
            [{ message_id: 2, message: '重新生成后的正文\n\n' + UPDATE_RESULT }],
            { refresh: 'none' }
        );
        expect(setChatMessages).toHaveBeenCalledTimes(1);
    });

    test('后续楼层的接收回调不会覆盖旧回调捕获的目标', async () => {
        await onMessageReceived(2);
        SillyTavern.chat.push(createMessage('下一条回复的正文'));
        await onMessageReceived(3);
        await emitRendered(2);
        expect(mockInvoke).toHaveBeenCalledTimes(2);
        expect(setChatMessages).not.toHaveBeenCalled();
        await emitRendered(3);
        expect(setChatMessages).toHaveBeenCalledWith(
            [{ message_id: 3, message: '下一条回复的正文\n\n' + UPDATE_RESULT }],
            { refresh: 'none' }
        );
    });

    test.each(['切换聊天', '编辑', '切换 swipe', '替换消息', '删除', '追加消息'] as const)(
        '解析期间%s，丢弃过期结果',
        async change => {
            const pending = Promise.withResolvers<string | null>();
            mockInvoke.mockReturnValueOnce(pending.promise);
            await onMessageReceived(2);
            const rendered = emitRendered();
            switch (change) {
                case '切换聊天':
                    jest.mocked(SillyTavern.getCurrentChatId).mockReturnValue('chat-2');
                    break;
                case '编辑':
                    SillyTavern.chat[2].mes = '编辑后的回复正文';
                    break;
                case '切换 swipe':
                    SillyTavern.chat[2].swipe_id = 1;
                    break;
                case '替换消息':
                    SillyTavern.chat[2] = createMessage();
                    break;
                case '删除':
                    SillyTavern.chat.pop();
                    break;
                case '追加消息':
                    SillyTavern.chat.push(createMessage());
                    break;
            }
            pending.resolve(UPDATE_RESULT);
            await rendered;
            expect(setChatMessages).not.toHaveBeenCalled();
            expect(mockHandleVariables).not.toHaveBeenCalled();
        }
    );

    test('其他聊天的同号楼层不会等待原聊天的解析或应用结果', async () => {
        const pending = Promise.withResolvers<string | null>();
        mockInvoke.mockReturnValueOnce(pending.promise);
        await onMessageReceived(2);
        jest.mocked(SillyTavern.getCurrentChatId).mockReturnValue('chat-2');
        await emitRendered();
        expect(mockInvoke).toHaveBeenCalledTimes(1);
        expect(setChatMessages).not.toHaveBeenCalled();
        expect(eventRemoveListener).toHaveBeenCalled();
        pending.resolve(UPDATE_RESULT);
    });

    test('写回等待期间聊天变化时不再处理变量', async () => {
        jest.mocked(setChatMessages).mockImplementationOnce(async () => {
            jest.mocked(SillyTavern.getCurrentChatId).mockReturnValue('chat-2');
        });
        await onMessageReceived(2);
        await emitRendered();
        expect(mockHandleVariables).not.toHaveBeenCalled();
    });

    test('空结果提示失败但仍处理已有变量', async () => {
        mockInvoke.mockResolvedValueOnce(null);
        await onMessageReceived(2);
        await emitRendered();
        expect(toastr.error).toHaveBeenCalledTimes(1);
        expect(setChatMessages).not.toHaveBeenCalled();
        expect(mockHandleVariables).toHaveBeenCalledWith(2);
    });

    test.each(['请求', '写回'] as const)('%s 异常传回宿主，监听不会残留', async phase => {
        const error = new Error('failed');
        if (phase === '请求') {
            mockInvoke.mockRejectedValueOnce(error);
        } else {
            mockHandleVariables.mockRejectedValueOnce(error);
        }
        await onMessageReceived(2);
        await expect(emitRendered()).rejects.toBe(error);
        await emitRendered();
        expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    test('宿主事件依次注册并清理各自的渲染监听', async () => {
        const stop = initResponse();
        try {
            await emitReceived();
            await emitRendered();
            SillyTavern.chat.push(createMessage());
            await emitReceived(3);
            await emitRendered(3);
            expect(mockInvoke).toHaveBeenCalledTimes(2);
            expect(mockHandleVariables.mock.calls).toEqual([[2], [3]]);
        } finally {
            stop();
        }
    });

    test.each(['前置检查', '等待渲染', '解析'] as const)(
        '模块在%s期间卸载，清理监听并停止写回',
        async phase => {
            const supported = Promise.withResolvers<boolean>();
            const result = Promise.withResolvers<string | null>();
            if (phase === '前置检查') {
                mockIsExtraModelSupported.mockReturnValueOnce(supported.promise);
            }
            mockInvoke.mockReturnValueOnce(result.promise);
            const stop = initResponse();
            const received = emitReceived();
            let rendered: Promise<void> | undefined;
            if (phase !== '前置检查') {
                await received;
                if (phase === '解析') rendered = emitRendered();
            }
            stop();
            supported.resolve(true);
            result.resolve(UPDATE_RESULT);
            await received;
            await rendered;
            await emitRendered();
            expect(mockInvoke).toHaveBeenCalledTimes(phase === '前置检查' ? 0 : 1);
            expect(setChatMessages).not.toHaveBeenCalled();
            expect(mockHandleVariables).not.toHaveBeenCalled();
        }
    );

    test('接收事件不会清空在途请求的全局解析标记', async () => {
        useDataStore().runtimes.is_during_extra_analysis = true;
        await onMessageReceived(2);
        expect(useDataStore().runtimes.is_during_extra_analysis).toBe(true);
        await emitRendered();
    });
});
