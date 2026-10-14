/** 覆盖生产环境的节流路径：当次事件立即启动处理，窗口内重复事件不在尾部补调。 */
import { initResponse } from '@/function/update';
import { onMessageReceived } from '@/function/update/on_message_received';

jest.mock('@/jest', () => ({ is_jest_environment: false }));
jest.mock('@/function/update/on_message_received', () => ({
    onMessageReceived: jest.fn(),
}));
jest.mock('@/function/update/pi/controller_registry', () => ({
    clearPiRequestControllers: jest.fn(),
}));
jest.mock('@/function/update_variables', () => ({
    handleVariablesInMessage: jest.fn(),
}));
jest.mock('@/util', () => ({
    controlledStoppableEventOn: (event: EventType, listener: (...args: any[]) => any) => {
        eventOn(event, listener);
        return () => eventRemoveListener(event, listener);
    },
}));

describe('MESSAGE_RECEIVED 生产环境节流', () => {
    const mockReceive = jest.mocked(onMessageReceived);
    let stop: () => void;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        mockReceive.mockReset().mockResolvedValue(undefined);
        stop = initResponse();
    });

    afterEach(() => {
        stop();
        jest.useRealTimers();
    });

    test('立即调用并丢弃窗口内的事件，到期不补调，后续事件可立即执行', async () => {
        const first = eventEmit(tavern_events.MESSAGE_RECEIVED, 1, 'normal');
        // 不推进计时器、不让出当前调用栈，处理应当已经开始。
        expect(mockReceive).toHaveBeenCalledWith(1, { signal: expect.any(AbortSignal) });
        await first;

        await jest.advanceTimersByTimeAsync(1000);
        await eventEmit(tavern_events.MESSAGE_RECEIVED, 2, 'normal');
        await jest.advanceTimersByTimeAsync(1000);
        await eventEmit(tavern_events.MESSAGE_RECEIVED, 3, 'normal');
        await jest.advanceTimersByTimeAsync(1000);
        expect(mockReceive).toHaveBeenCalledTimes(1);

        const next = eventEmit(tavern_events.MESSAGE_RECEIVED, 4, 'normal');
        expect(mockReceive).toHaveBeenCalledTimes(2);
        expect(mockReceive).toHaveBeenLastCalledWith(4, { signal: expect.any(AbortSignal) });
        await next;
        await jest.advanceTimersByTimeAsync(3000);
        expect(mockReceive).toHaveBeenCalledTimes(2);
    });

    test('宿主事件等待当次处理的 Promise，并收到其异常', async () => {
        const pending = Promise.withResolvers<void>();
        mockReceive.mockReturnValueOnce(pending.promise);
        let settled = false;
        const emitted = eventEmit(tavern_events.MESSAGE_RECEIVED, 1, 'normal').finally(() => {
            settled = true;
        });
        const error = new Error('receive failed');
        const assertion = expect(emitted).rejects.toBe(error);

        await Promise.resolve();
        expect(mockReceive).toHaveBeenCalledTimes(1);
        expect(settled).toBe(false);

        pending.reject(error);
        await assertion;
        expect(settled).toBe(true);
        await jest.advanceTimersByTimeAsync(3000);
        expect(mockReceive).toHaveBeenCalledTimes(1);
    });
});
