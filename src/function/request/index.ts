import { applyExtraModelRequestOverrides } from '@/function/request/extra_model_request_override';
import { overrideToolRequest, registerFunction } from '@/function/function_call';
import { onWorldinfoEntriesLoaded, onWorldinfoScanDone } from '@/function/request/worldinfo_scan';
import { filterPrompts } from '@/function/request/filter_prompts';
import { controlledStoppableEventOn } from '@/util';

/**
 * 注册当前聊天的世界书过滤、请求参数覆盖和最终提示词清理监听器。
 *
 * 原始条目加载与扫描完成由两阶段过滤分别处理；请求标记清理由在途登记单独维护。
 *
 * @returns 卸载本次注册的聊天级监听器及工具注册的清理函数。
 */
export function initRequest() {
    const stop_list: Array<() => void> = [];
    stop_list.push(registerFunction());

    stop_list.push(
        controlledStoppableEventOn('worldinfo_entries_loaded', onWorldinfoEntriesLoaded)
    );
    stop_list.push(controlledStoppableEventOn('worldinfo_scan_done', onWorldinfoScanDone));
    stop_list.push(
        controlledStoppableEventOn(
            tavern_events.CHAT_COMPLETION_SETTINGS_READY,
            applyExtraModelRequestOverrides
        )
    );
    stop_list.push(
        controlledStoppableEventOn(
            tavern_events.CHAT_COMPLETION_SETTINGS_READY,
            overrideToolRequest
        )
    );
    stop_list.push(
        controlledStoppableEventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, filterPrompts)
    );

    return () => {
        stop_list.forEach(stop => stop());
    };
}
