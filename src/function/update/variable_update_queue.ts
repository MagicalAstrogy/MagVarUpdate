type PendingVariableUpdate = {
    chat: typeof SillyTavern.chat;
    message_id: number;
    settled: Promise<void>;
};

const pending_updates = new Set<PendingVariableUpdate>();

/** Keep later message snapshots behind the complete response update, including variable writes. */
export async function withPendingVariableUpdate<T>(
    message_id: number,
    run: () => Promise<T>
): Promise<T> {
    let release!: () => void;
    const pending: PendingVariableUpdate = {
        chat: SillyTavern.chat,
        message_id,
        settled: new Promise<void>(resolve => {
            release = resolve;
        }),
    };
    pending_updates.add(pending);
    try {
        return await run();
    } finally {
        pending_updates.delete(pending);
        release();
    }
}

export async function waitForEarlierVariableUpdates(message_id: number): Promise<void> {
    await Promise.all(
        [...pending_updates]
            .filter(pending => pending.chat === SillyTavern.chat && pending.message_id < message_id)
            .map(pending => pending.settled)
    );
}
