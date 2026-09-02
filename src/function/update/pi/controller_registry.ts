import { getPendingPromptCaptureDiagnostics } from './prompt_capture';

const pi_request_controllers = new Map<string, AbortController>();
const pi_request_attempts = new Map<string, AbortController>();

export class PiRequestAbortedError extends Error {
    readonly generationId: string;

    constructor(generationId: string, reason?: unknown) {
        const detail =
            reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
        super(
            detail
                ? `Pi request '${generationId}' was aborted: ${detail}`
                : `Pi request '${generationId}' was aborted`
        );
        this.name = 'PiRequestAbortedError';
        this.generationId = generationId;
    }
}

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
 * Reserve an id for the complete capture -> provider request attempt.
 *
 * This controller deliberately outlives prompt capture. It is also the tombstone
 * that records a stop which lands after Slash has finished but before the Pi
 * runtime has registered its provider controller.
 */
export function beginPiRequestAttempt(generation_id: string): PiRequestAttemptRegistration {
    if (!generation_id.trim()) {
        throw new Error('Pi request generation_id must not be empty');
    }
    if (pi_request_attempts.has(generation_id) || pi_request_controllers.has(generation_id)) {
        throw new Error(`Pi request generation_id '${generation_id}' is already active`);
    }

    const controller = new AbortController();
    pi_request_attempts.set(generation_id, controller);
    let released = false;
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

export function registerPiRequestController(
    generation_id: string,
    caller_signal?: AbortSignal
): PiRequestControllerRegistration {
    if (!generation_id.trim()) {
        throw new Error('Pi request generation_id must not be empty');
    }
    if (pi_request_controllers.has(generation_id)) {
        throw new Error(`Pi request generation_id '${generation_id}' is already active`);
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

/**
 * Stop every currently reachable layer for one extra-model attempt. Slash owns
 * prompt generation, the attempt controller spans capture -> runtime, and the
 * runtime controller owns the provider stream once it has been registered.
 */
export function stopExtraModelRequestById(generation_id: string, reason?: unknown): boolean {
    const slash_stopped = stopGenerationById(generation_id);
    const pi_stopped = stopPiRequestById(generation_id, reason);
    return slash_stopped || pi_stopped;
}

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

/** Stop every active Pi extra-model attempt, including the short Slash prompt-capture phase. */
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

export function getActivePiRequestIds(): readonly string[] {
    return [...new Set([...pi_request_attempts.keys(), ...pi_request_controllers.keys()])];
}

/**
 * Abort every request during script teardown.
 *
 * Registrations are deliberately not removed here. In particular, an attempt
 * controller is the cancellation tombstone for the capture -> runtime gap: if
 * prompt capture settles after teardown, runtime registration must still see
 * the aborted attempt and refuse to start a provider request. Each owner removes
 * its own registration from its `finally` block via `release()`.
 */
export function clearPiRequestControllers(): void {
    stopAllExtraModelRequests(new Error('Pi request registry disposed'));
}
