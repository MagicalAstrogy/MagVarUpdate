import { initCheck } from '@/function/initvar/variable_init';
import { stoppableEventOn } from '@/util';

export async function initInitvar() {
    const stop_list: Array<() => void> = [];

    await initCheck();
    stop_list.push(stoppableEventOn(tavern_events.GENERATION_STARTED, initCheck));
    stop_list.push(stoppableEventOn(tavern_events.MESSAGE_SENT, initCheck));

    return () => {
        stop_list.forEach(stop => stop());
    };
}
