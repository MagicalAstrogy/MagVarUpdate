export declare function initSillyTavernVersion(): Promise<void>;
export declare function getSillyTavernVersion(): string;
export declare function isFunctionCallingSupported(): boolean;
export declare const is_jest_environment: boolean;
export declare const saveChatDebounced: import("lodash").DebouncedFunc<() => Promise<void>>;
/**
 * 寻找包含变量信息的最后一个楼层
 * @param end_message_id 从哪一条消息开始倒序搜索(不含那一条)
 */
export declare function findLastValidMessage(end_message_id: number): number;
