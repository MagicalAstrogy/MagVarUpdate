import { getPendingPromptCaptureDiagnostics } from './prompt_capture';

const pi_request_controllers = new Map<string, AbortController>();
const pi_request_attempts = new Map<string, AbortController>();

export class PiRequestAbortedError extends Error {
    readonly generationId: string;

    /** 将取消原因与生成编号绑定，供重试策略和界面识别主动停止。 */
    constructor(generationId: string, reason?: unknown) {
        const detail =
            reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
        super(
            detail
                ? `More source request '${generationId}' was aborted: ${detail}`
                : `More source request '${generationId}' was aborted`
        );
        this.name = 'PiRequestAbortedError';
        this.generationId = generationId;
    }
}

/** 识别 Pi 的主动取消错误，避免将其当作普通请求失败重试。 */
export function isPiRequestAbortedError(error: unknown): error is PiRequestAbortedError {
    return error instanceof PiRequestAbortedError;
}

export type PiRequestControllerRegistration = {
    controller: AbortController;
    signal: AbortSignal;
    release: () => void;
};

export type PiRequestAttemptRegistration = {
    signal: AbortSignal;
    release: () => void;
};

/**
 * 为“提示词捕获 → 服务商请求”的完整尝试保留生成编号和取消信号。
 * 该记录在捕获结束后仍保留停止标记，防止间隙中的取消被后续请求注册绕过。
 */
export function beginPiRequestAttempt(generation_id: string): PiRequestAttemptRegistration {
    if (!generation_id.trim()) {
        throw new Error('More source request generation_id must not be empty');
    }
    if (pi_request_attempts.has(generation_id) || pi_request_controllers.has(generation_id)) {
        throw new Error(`More source request generation_id '${generation_id}' is already active`);
    }

    const controller = new AbortController();
    pi_request_attempts.set(generation_id, controller);
    let released = false;
    /** 只释放本次尝试登记的记录，避免清理同编号的新实例。 */
    const release = () => {
        if (released) {
            return;
        }
        released = true;
        if (pi_request_attempts.get(generation_id) === controller) {
            pi_request_attempts.delete(generation_id);
        }
    };

    return { signal: controller.signal, release };
}

/** 登记实际请求控制器，并继承完整尝试已发生或随后发生的取消。 */
export function registerPiRequestController(
    generation_id: string,
    caller_signal?: AbortSignal
): PiRequestControllerRegistration {
    if (!generation_id.trim()) {
        throw new Error('More source request generation_id must not be empty');
    }
    if (pi_request_controllers.has(generation_id)) {
        throw new Error(`More source request generation_id '${generation_id}' is already active`);
    }

    const controller = new AbortController();
    const attempt_signal = pi_request_attempts.get(generation_id)?.signal;
    const abort_sources = [
        ...new Set(
            [attempt_signal, caller_signal].filter(
                (signal): signal is AbortSignal => signal !== undefined
            )
        ),
    ];
    const abort_listeners = abort_sources.map(signal => {
        /** 把调用方或尝试层信号的取消原因传给实际请求控制器。 */
        const forward_abort = () => {
            if (!controller.signal.aborted) {
                controller.abort(signal.reason);
            }
        };
        signal.addEventListener('abort', forward_abort, { once: true });
        if (signal.aborted) {
            forward_abort();
        }
        return { signal, forward_abort };
    });

    pi_request_controllers.set(generation_id, controller);
    let released = false;
    /** 解除上游取消监听，并只移除当前请求的登记项。 */
    const release = () => {
        if (released) {
            return;
        }
        released = true;
        for (const { signal, forward_abort } of abort_listeners) {
            signal.removeEventListener('abort', forward_abort);
        }
        if (pi_request_controllers.get(generation_id) === controller) {
            pi_request_controllers.delete(generation_id);
        }
    };

    return { controller, signal: controller.signal, release };
}

/** 在实际请求执行期间登记控制器，无论成功、失败还是取消都释放登记。 */
export async function withPiRequestController<T>(
    generation_id: string,
    run: (signal: AbortSignal) => Promise<T>,
    caller_signal?: AbortSignal
): Promise<T> {
    const registration = registerPiRequestController(generation_id, caller_signal);
    try {
        return await run(registration.signal);
    } finally {
        registration.release();
    }
}

/** 按生成编号取消 Pi 尝试和实际请求，保留可供后续注册检查的停止状态。 */
export function stopPiRequestById(generation_id: string, reason?: unknown): boolean {
    const controllers = [
        pi_request_attempts.get(generation_id),
        pi_request_controllers.get(generation_id),
    ];
    let stopped = false;
    for (const controller of controllers) {
        if (!controller || controller.signal.aborted) {
            continue;
        }
        controller.abort(reason ?? new PiRequestAbortedError(generation_id));
        stopped = true;
    }
    return stopped;
}

/** 同时停止同一编号的 Slash 捕获和 Pi 请求，覆盖生成链路的各个阶段。 */
export function stopExtraModelRequestById(generation_id: string, reason?: unknown): boolean {
    const slash_stopped = stopGenerationById(generation_id);
    const pi_stopped = stopPiRequestById(generation_id, reason);
    return slash_stopped || pi_stopped;
}

/** 取消所有仍活动的 Pi 尝试与请求，并返回受影响的生成编号数量。 */
export function stopAllPiRequests(reason?: unknown): number {
    const ids = [
        ...new Set([...pi_request_attempts.keys(), ...pi_request_controllers.keys()]),
    ].filter(id => {
        const attempt = pi_request_attempts.get(id);
        const runtime = pi_request_controllers.get(id);
        return (
            (attempt !== undefined && !attempt.signal.aborted) ||
            (runtime !== undefined && !runtime.signal.aborted)
        );
    });
    for (const id of ids) {
        stopPiRequestById(id, reason);
    }
    return ids.length;
}

/** 停止全部额外模型尝试，包括仍处于 Slash 提示词捕获阶段的请求。 */
export function stopAllExtraModelRequests(reason?: unknown): number {
    const ids = new Set([
        ...getPendingPromptCaptureDiagnostics().map(capture => capture.generationId),
        ...pi_request_attempts.keys(),
        ...pi_request_controllers.keys(),
    ]);
    let stopped = 0;
    for (const id of ids) {
        if (stopExtraModelRequestById(id, reason)) {
            stopped += 1;
        }
    }
    return stopped;
}

/** 返回当前登记的生成编号，供取消操作及生命周期诊断使用。 */
export function getActivePiRequestIds(): readonly string[] {
    return [...new Set([...pi_request_attempts.keys(), ...pi_request_controllers.keys()])];
}

/**
 * 脚本卸载时取消全部请求，但保留登记项直到各自结束。
 * 尝试记录仍充当停止标记，防止并发完成的捕获在卸载后发起新请求。
 */
export function clearPiRequestControllers(): void {
    stopAllExtraModelRequests(new Error('More source request registry disposed'));
}
