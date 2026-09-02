import { installPiAbortSignalPolyfills } from '@/function/update/pi/abort_signal';

describe('Pi AbortSignal compatibility', () => {
    const original_descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
    const original_timeout_descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');

    afterEach(() => {
        if (original_descriptor) {
            Object.defineProperty(AbortSignal, 'any', original_descriptor);
        } else {
            Reflect.deleteProperty(AbortSignal, 'any');
        }
        if (original_timeout_descriptor) {
            Object.defineProperty(AbortSignal, 'timeout', original_timeout_descriptor);
        } else {
            Reflect.deleteProperty(AbortSignal, 'timeout');
        }
    });

    test('combines caller and timeout signals on browsers without AbortSignal.any', () => {
        Reflect.deleteProperty(AbortSignal, 'any');
        installPiAbortSignalPolyfills();

        const caller = new AbortController();
        const timeout = new AbortController();
        const combined = AbortSignal.any([caller.signal, timeout.signal]);
        const reason = new Error('caller stopped');

        caller.abort(reason);

        expect(combined.aborted).toBe(true);
        expect(combined.reason).toBe(reason);
    });

    test('forwards an already-aborted signal and keeps the first reason', () => {
        Reflect.deleteProperty(AbortSignal, 'any');
        installPiAbortSignalPolyfills();

        const first = new AbortController();
        const second = new AbortController();
        first.abort('first');
        second.abort('second');

        const combined = AbortSignal.any([first.signal, second.signal]);

        expect(combined.aborted).toBe(true);
        expect(combined.reason).toBe('first');
    });

    test('provides the timeout signal used by OAuth refresh on older browsers', async () => {
        Reflect.deleteProperty(AbortSignal, 'timeout');
        installPiAbortSignalPolyfills();

        const signal = AbortSignal.timeout(0);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(signal.aborted).toBe(true);
        expect(signal.reason).toBeInstanceOf(DOMException);
        expect((signal.reason as DOMException).name).toBe('TimeoutError');
    });
});
