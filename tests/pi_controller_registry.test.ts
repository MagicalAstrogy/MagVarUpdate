import {
    beginPiRequestAttempt,
    clearPiRequestControllers,
    getActivePiRequestIds,
    registerPiRequestController,
    stopAllExtraModelRequests,
    stopExtraModelRequestById,
    stopPiRequestById,
    withPiRequestController,
} from '@/function/update/pi/controller_registry';
import { capturePrompt } from '@/function/update/pi/prompt_capture';

describe('Pi request controller registry', () => {
    beforeEach(() => {
        clearPiRequestControllers();
        (globalThis as any).stopGenerationById = jest.fn().mockReturnValue(false);
    });

    test('registers, forwards caller abort, and releases an id', () => {
        const caller = new AbortController();
        const registration = registerPiRequestController('request-1', caller.signal);

        expect(getActivePiRequestIds()).toEqual(['request-1']);
        caller.abort('caller stopped');
        expect(registration.signal.aborted).toBe(true);
        expect(registration.signal.reason).toBe('caller stopped');

        registration.release();
        expect(getActivePiRequestIds()).toEqual([]);
    });

    test('rejects an empty or duplicate id', () => {
        expect(() => beginPiRequestAttempt('')).toThrow('must not be empty');
        expect(() => registerPiRequestController('')).toThrow('must not be empty');
        const registration = registerPiRequestController('duplicate');
        expect(() => registerPiRequestController('duplicate')).toThrow('already active');
        registration.release();
    });

    test('keeps a stopped attempt tombstone until the complete attempt releases it', () => {
        const attempt = beginPiRequestAttempt('capture-runtime-gap');

        expect(getActivePiRequestIds()).toEqual(['capture-runtime-gap']);
        expect(stopExtraModelRequestById('capture-runtime-gap', 'winner selected')).toBe(true);
        expect(attempt.signal.aborted).toBe(true);

        const runtime = registerPiRequestController('capture-runtime-gap');
        expect(runtime.signal.aborted).toBe(true);
        expect(runtime.signal.reason).toBe('winner selected');

        runtime.release();
        expect(getActivePiRequestIds()).toEqual(['capture-runtime-gap']);
        attempt.release();
        expect(getActivePiRequestIds()).toEqual([]);
    });

    test('keeps a teardown tombstone until a capturing invoke releases its attempt', () => {
        const attempt = beginPiRequestAttempt('capture-teardown-gap');

        clearPiRequestControllers();

        expect(attempt.signal.aborted).toBe(true);
        expect(getActivePiRequestIds()).toEqual(['capture-teardown-gap']);

        // Simulate prompt capture settling after teardown. Runtime registration inherits the
        // retained tombstone and therefore cannot start a provider request.
        const runtime = registerPiRequestController('capture-teardown-gap');
        expect(runtime.signal.aborted).toBe(true);
        runtime.release();
        expect(getActivePiRequestIds()).toEqual(['capture-teardown-gap']);

        attempt.release();
        expect(getActivePiRequestIds()).toEqual([]);
    });

    test('withPiRequestController always cleans up', async () => {
        await expect(
            withPiRequestController('failed', async signal => {
                expect(signal.aborted).toBe(false);
                throw new Error('provider failed');
            })
        ).rejects.toThrow('provider failed');
        expect(getActivePiRequestIds()).toEqual([]);
    });

    test('stops a Pi request by id and ignores unrelated ids', () => {
        const first = registerPiRequestController('first');
        const second = registerPiRequestController('second');

        expect(stopPiRequestById('unknown')).toBe(false);
        expect(stopPiRequestById('first', 'loser')).toBe(true);
        expect(stopPiRequestById('first', 'duplicate stop')).toBe(false);
        expect(first.signal.aborted).toBe(true);
        expect(second.signal.aborted).toBe(false);
        expect(() => registerPiRequestController('first')).toThrow('already active');
        first.release();
        expect(getActivePiRequestIds()).toEqual(['second']);
        second.release();
    });

    test('unified stop attempts both Slash and Pi phases', () => {
        const registration = registerPiRequestController('shared-id');
        (globalThis as any).stopGenerationById.mockReturnValue(true);

        expect(stopExtraModelRequestById('shared-id', 'manual')).toBe(true);
        expect((globalThis as any).stopGenerationById).toHaveBeenCalledWith('shared-id');
        expect(registration.signal.aborted).toBe(true);
        expect(getActivePiRequestIds()).toEqual(['shared-id']);
        registration.release();
        expect(getActivePiRequestIds()).toEqual([]);
    });

    test('manual stop discovers an attempt while Slash is still capturing its prompt', async () => {
        let reject_capture!: (reason?: unknown) => void;
        const capture = capturePrompt(
            () =>
                new Promise<never>((_resolve, reject) => {
                    reject_capture = reject;
                }),
            { generation_id: 'capturing-id' }
        );
        (globalThis as any).stopGenerationById.mockReturnValue(true);

        expect(stopAllExtraModelRequests()).toBe(1);
        expect((globalThis as any).stopGenerationById).toHaveBeenCalledWith('capturing-id');

        reject_capture('Clicked stop button');
        await expect(capture).rejects.toBe('Clicked stop button');
    });
});
