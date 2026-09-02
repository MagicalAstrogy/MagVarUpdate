import { isPiMultiproviderEnabled } from '@/function/update/pi/feature_flag';

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
