import { is_jest_environment, stoppableEventOn } from '@/util';

import { onMessageReceived } from '@/function/response/on_message_received';
import { handleVariablesInMessage } from '@/function/update_variables';

export function initResponse() {
    const stop_list: Array<() => void> = [];
    stop_list.push(stoppableEventOn(tavern_events.MESSAGE_SENT, handleVariablesInMessage));
    stop_list.push(
        stoppableEventOn(
            tavern_events.MESSAGE_RECEIVED,
            is_jest_environment ? onMessageReceived : _.throttle(onMessageReceived, 3000)
        )
    );
    return () => {
        stop_list.forEach(stop => stop());
    };
}
