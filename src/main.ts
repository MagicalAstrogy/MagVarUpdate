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

async function initialize() {}

async function destroy() {}

setActivePinia(getActivePinia() ?? createPinia());

$(async () => {
    await checkMinimumVersion('3.4.17', 'MVU变量框架');

    const store = useDataStore();
    await store._wait_init();

    const stop_list: Array<() => void> = [];

    stop_list.push(initPanel());
    stop_list.push(initButtons());
    stop_list.push(initGlobals());

    stop_list.push(await initInitvar());
    stop_list.push(initRequest());
    stop_list.push(initResponse());

    stop_list.push(initCleanup());

    stop_list.push(initNotification());

    $(window).on('pagehide', async () => {
        stop_list.forEach(stop => stop());
    });
});

// TODO: 重新考虑哪些在 CHAT_CHANGED 时应该被重载
eventOn(tavern_events.CHAT_CHANGED, reloadScript);
let current_chat_id = SillyTavern.getCurrentChatId();
function reloadScript(chat_id: string) {
    if (current_chat_id !== chat_id) {
        current_chat_id = chat_id;
        destroy();
        initialize();
    }
}
