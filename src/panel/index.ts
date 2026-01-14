import Panel from '@/panel/Panel.vue';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

export function initPanel() {
    const app = createApp(Panel).use(createPinia());

    const $app = $('<div>').attr('script_id', getScriptId()).appendTo('#extensions_settings2');
    app.mount($app[0]);

    const $style = $(`<div>`)
        .attr('script_id', getScriptId())
        .append($(`head > style`, document).clone())
        .appendTo('head');

    return {
        destroy: () => {
            app.unmount();
            $app.remove();
            $style.remove();
        },
    };
}
