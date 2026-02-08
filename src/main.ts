import { initButtons } from '@/button';
import { initCleanup } from '@/function/cleanup';
import { initGlobals } from '@/function/global';
import { initInitvar } from '@/function/initvar';
import { initNotification } from '@/function/notification';
import { initRequest } from '@/function/request';
import { initResponse } from '@/function/update';
import { initPanel } from '@/panel';
import { useDataStore } from '@/store';
import { checkMinimumVersion } from '@util/common';

setActivePinia(getActivePinia() ?? createPinia());

$(async () => {
    await checkMinimumVersion('3.4.17', 'MVU变量框架');

    const store = useDataStore();
    await store._wait_init();

    const stop_list: Array<() => void> = [];

    stop_list.push(initPanel());
    stop_list.push(initButtons());
    stop_list.push(initGlobals());

    let chat_level_stop_list = await initChatLevel();
    let current_chat_id = SillyTavern.getCurrentChatId();
    eventOn(tavern_events.CHAT_CHANGED, async (chat_id: string) => {
        if (current_chat_id !== chat_id) {
            current_chat_id = chat_id;
            chat_level_stop_list.forEach(stop => stop());
            chat_level_stop_list = await initChatLevel();
        }
    });

    stop_list.push(initNotification());

    $(window).on('pagehide', async () => {
        chat_level_stop_list.forEach(stop => stop());
        stop_list.forEach(stop => stop());
    });
});

async function initChatLevel() {
    const stop_list: Array<() => void> = [];
    stop_list.push(await initInitvar());
    stop_list.push(initRequest());
    stop_list.push(initResponse());
    stop_list.push(initCleanup());
    return stop_list;
}
