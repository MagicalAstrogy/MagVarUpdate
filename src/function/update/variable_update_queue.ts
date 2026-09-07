type PendingVariableUpdate = {
    chat: typeof SillyTavern.chat;
    message_id: number;
    settled: Promise<void>;
};

const pending_updates = new Set<PendingVariableUpdate>();

/**
 * 登记一条消息从解析到变量写入的完整异步任务，并在结束时通知等待者。
 * 无论成功或失败都释放等待，避免后续消息永久阻塞。
 */
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

/** 只等待当前聊天中更早消息的变量更新，使新消息快照包含已经完成的前序写入。 */
export async function waitForEarlierVariableUpdates(message_id: number): Promise<void> {
    await Promise.all(
        [...pending_updates]
            .filter(pending => pending.chat === SillyTavern.chat && pending.message_id < message_id)
            .map(pending => pending.settled)
    );
}
