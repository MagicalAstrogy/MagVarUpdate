import { filterEntries } from '@/function/request/filter_entries';
import { filterPrompts } from '@/function/request/filter_prompts';
import { overrideToolRequest, registerFunction } from '@/function/request/function_call';
import { stoppableEventOn } from '@/util';

export function initRequest() {
    const stop_list: Array<() => void> = [];
    stop_list.push(registerFunction());

    stop_list.push(stoppableEventOn('worldinfo_entries_loaded', filterEntries));
    stop_list.push(
        stoppableEventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, overrideToolRequest)
    );
    stop_list.push(stoppableEventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, filterPrompts));

    return () => {
        stop_list.forEach(stop => stop());
    };
}
