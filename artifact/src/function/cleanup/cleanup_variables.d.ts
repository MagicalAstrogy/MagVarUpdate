/** 清理 `[start_message_id, end_message_id]` 内, 楼层号不为 `snap_interval` 倍数的楼层变量 */
export declare function cleanupMessageVariables(start_message_id: number, end_message_id: number, snap_interval: number): number;
