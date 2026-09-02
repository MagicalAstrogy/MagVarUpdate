type AbortSignalConstructorWithPolyfills = {
    any?: (signals: Iterable<AbortSignal>) => AbortSignal;
    timeout?: (milliseconds: number) => AbortSignal;
};

/** Install the AbortSignal primitives used by pi-ai's OAuth refresh path on older ST browsers. */
export function installPiAbortSignalPolyfills(): void {
    const constructor = AbortSignal as unknown as AbortSignalConstructorWithPolyfills;
    if (typeof constructor.timeout !== 'function') {
        Object.defineProperty(constructor, 'timeout', {
            configurable: true,
            writable: true,
            value(milliseconds: number): AbortSignal {
                if (!Number.isFinite(milliseconds) || milliseconds < 0) {
                    throw new RangeError(
                        'AbortSignal timeout must be a non-negative finite number'
                    );
                }
                const controller = new AbortController();
                setTimeout(
                    () =>
                        controller.abort(
                            new DOMException('The operation timed out', 'TimeoutError')
                        ),
                    milliseconds
                );
                return controller.signal;
            },
        });
    }

    if (typeof constructor.any === 'function') {
        return;
    }

    Object.defineProperty(constructor, 'any', {
        configurable: true,
        writable: true,
        value(signals: Iterable<AbortSignal>): AbortSignal {
            const controller = new AbortController();
            const listeners = new Map<AbortSignal, () => void>();
            const cleanup = () => {
                for (const [signal, listener] of listeners) {
                    signal.removeEventListener('abort', listener);
                }
                listeners.clear();
            };
            const forward = (signal: AbortSignal) => {
                if (!controller.signal.aborted) {
                    controller.abort(signal.reason);
                }
                cleanup();
            };

            for (const signal of signals) {
                if (listeners.has(signal)) {
                    continue;
                }
                if (signal.aborted) {
                    forward(signal);
                    break;
                }
                const listener = () => forward(signal);
                listeners.set(signal, listener);
                signal.addEventListener('abort', listener, { once: true });
            }
            return controller.signal;
        },
    });
}
