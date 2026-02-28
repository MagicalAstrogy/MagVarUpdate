import { MvuData } from '@/variable_def';
import * as jsonpatch from 'fast-json-patch';
export declare const is_jest_environment: boolean;
export declare const saveChatDebounced: import("lodash").DebouncedFunc<() => Promise<void>>;
/**
 * 寻找包含变量信息的最后一个楼层
 * @param end_message_id 从哪一条消息开始倒序搜索(不含那一条)
 */
export declare function getLastValidMessageId(end_message_id: number): number;
export declare function getLastValidVariable(end_message_id: number): MvuData | undefined;
export declare function stoppableEventOn<T extends EventType>(event_type: T, listener: ListenerType[T]): () => void;
export declare function isJsonPatch(patch: any): patch is jsonpatch.Operation[];
export declare function showHelpPopup(content: string): void;
export declare function normalizeBaseURL(api_url: string): string;
