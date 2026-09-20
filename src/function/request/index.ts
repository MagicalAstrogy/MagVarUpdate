import { applyExtraModelRequestOverrides } from '@/function/request/extra_model_request_override';
import { overrideToolRequest, registerFunction } from '@/function/function_call';
import { onWorldinfoEntriesLoaded, onWorldinfoScanDone } from '@/function/request/worldinfo_scan';
import { filterPrompts } from '@/function/request/filter_prompts';
import { controlledStoppableEventOn } from '@/util';

/**
 * 注册实例级世界书监听；聊天切换或聊天级模块重建不影响正在扫描的请求。
 *
 * 监听持续到 MVU 实例卸载，回调仍受 should_enable 控制。
 */
export function initWorldinfoFilter() {
    const stop_loaded = controlledStoppableEventOn(
        'worldinfo_entries_loaded',
        onWorldinfoEntriesLoaded
    );
    const stop_scan = controlledStoppableEventOn('worldinfo_scan_done', onWorldinfoScanDone);
    return () => {
        stop_loaded();
        stop_scan();
    };
}

/**
 * 注册当前聊天的请求参数覆盖和最终提示词清理监听器。
 *
 * @returns 卸载本次注册的聊天级监听器及工具注册的清理函数。
 */
export function initRequest() {
    const stop_list: Array<() => void> = [];
    stop_list.push(registerFunction());

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
