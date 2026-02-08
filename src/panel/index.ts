import Panel from '@/panel/Panel.vue';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

export function initPanel() {
    const app = createApp(Panel).use(getActivePinia() ?? createPinia());

    const $app = $('<div>').attr('script_id', getScriptId());
    $('#extensions_settings2').append($app);
    app.mount($app[0]);

    const $style = $(`<div>`)
        .attr('script_id', getScriptId())
        .append($(`head > style`, document).clone())
        .appendTo('head');

    return () => {
        app.unmount();
        $app.remove();
        $style.remove();
    };
}
