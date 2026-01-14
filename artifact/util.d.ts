export declare function initSillyTavernVersion(): Promise<void>;
export declare function getSillyTavernVersion(): string;
export declare function initTavernHelperVersion(): Promise<void>;
export declare function getTavernHelperVersion(): string;
export declare function isFunctionCallingSupported(): boolean;
export declare const is_jest_environment: boolean;
export declare const saveChatDebounced: import("lodash").DebouncedFunc<() => Promise<void>>;
/**
 * 寻找包含变量信息的最后一个楼层
 * @param end_message_id 从哪一条消息开始倒序搜索(不含那一条)
 */
export declare function findLastValidMessage(end_message_id: number): number;
export declare function scopedEventOn<T extends EventType>(event_type: T, listener: ListenerType[T]): void;
export declare function clearScopedEvent(): void;
export declare function parseString(content: string): any;
export declare function correctlyMerge<TObject, TSource>(lhs: TObject, rhs: TSource): TObject & TSource;
export declare function showHelpPopup(content: string): void;
