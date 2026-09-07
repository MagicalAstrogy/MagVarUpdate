/**
 * 测试场景：验证 Pi 发布开关在测试构建中默认开启，并可在 MVU 加载前通过运行时变量关闭。
 */
import { isPiMultiproviderEnabled } from '@/function/update/pi/feature_flag';

// 发布开关：默认启用与运行时显式禁用分别生效。
describe('Pi multiprovider release flag', () => {
    afterEach(() => {
        delete globalThis.__MVU_PI_MULTIPROVIDER_ENABLED__;
    });

    test('is enabled by default in Jest builds', () => {
        expect(isPiMultiproviderEnabled()).toBe(true);
    });

    test('can be disabled before MVU loads', () => {
        globalThis.__MVU_PI_MULTIPROVIDER_ENABLED__ = false;
        expect(isPiMultiproviderEnabled()).toBe(false);
    });
});
