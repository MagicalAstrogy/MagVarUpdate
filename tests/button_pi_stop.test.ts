import { buttons } from '@/button';
import { stopAllExtraModelRequests } from '@/function/update/pi/controller_registry';

jest.mock('@/function/update/pi/controller_registry', () => ({
    stopAllExtraModelRequests: jest.fn(),
}));

const mockStopAllExtraModelRequests = jest.mocked(stopAllExtraModelRequests);
const stopPiExtraModel = buttons.find(button => button.name === '停止 Pi 额外模型解析')!.function;

describe('stop Pi extra-model button', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (globalThis as any).toastr = { info: jest.fn() };
    });

    test('stops only the active Pi requests and reports the stopped count', async () => {
        mockStopAllExtraModelRequests.mockReturnValue(2);

        await stopPiExtraModel();

        expect(mockStopAllExtraModelRequests).toHaveBeenCalledTimes(1);
        expect((globalThis as any).toastr.info).toHaveBeenCalledWith(
            '已停止 2 个 Pi 额外模型请求',
            '[MVU]停止 Pi 额外模型解析',
            { timeOut: 3000 }
        );
    });

    test('reports when no Pi request is active', async () => {
        mockStopAllExtraModelRequests.mockReturnValue(0);

        await stopPiExtraModel();

        expect(mockStopAllExtraModelRequests).toHaveBeenCalledTimes(1);
        expect((globalThis as any).toastr.info).toHaveBeenCalledWith(
            '当前没有正在运行的 Pi 额外模型请求',
            '[MVU]停止 Pi 额外模型解析',
            { timeOut: 3000 }
        );
    });
});
