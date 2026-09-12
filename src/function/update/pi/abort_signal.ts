/** 兼容旧浏览器的 AbortSignal 静态接口；可选方法由运行时检测后补齐。 */
type AbortSignalConstructorWithPolyfills = {
    any?: (signals: Iterable<AbortSignal>) => AbortSignal;
    timeout?: (milliseconds: number) => AbortSignal;
};

/**
 * 为旧版酒馆浏览器补齐 Pi OAuth 刷新所需的 AbortSignal.timeout 和 any。
 * 仅在原生实现缺失时安装，并在取消后解除组合信号的监听。
 */
export function installPiAbortSignalPolyfills(): void {
    const constructor = AbortSignal as unknown as AbortSignalConstructorWithPolyfills;
    if (typeof constructor.timeout !== 'function') {
        Object.defineProperty(constructor, 'timeout', {
            configurable: true,
            writable: true,
            /** 创建到期自动取消的信号，拒绝负数和非有限超时时间。 */
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
        /** 合并多个取消信号，首次取消时保留原始原因并清理其他监听。 */
        value(signals: Iterable<AbortSignal>): AbortSignal {
            const controller = new AbortController();
            const listeners = new Map<AbortSignal, () => void>();
            /** 解除已注册的取消监听，避免组合信号结束后继续持有输入信号。 */
            const cleanup = () => {
                for (const [signal, listener] of listeners) {
                    signal.removeEventListener('abort', listener);
                }
                listeners.clear();
            };
            /** 只转发首次取消原因，并统一释放组合信号的监听。 */
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
                /** 将当前输入信号的取消传递给组合信号。 */
                const listener = () => forward(signal);
                listeners.set(signal, listener);
                signal.addEventListener('abort', listener, { once: true });
            }
            return controller.signal;
        },
    });
}
