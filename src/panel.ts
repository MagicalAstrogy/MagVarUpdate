import Panel from '@/Panel.vue';
import { createPinia } from 'pinia';
import { App, createApp } from 'vue';

let app: App<Element> | undefined = createApp(Panel);

function teleportStyle() {
    if ($(`head > div[script_id="${getScriptId()}"]`).length > 0) {
        return;
    }
    const $div = $(`<div>`)
        .attr('script_id', getScriptId())
        .append($(`head > style`, document).clone());
    $('head').append($div);
}
export function initPanel() {
    teleportStyle();

    const $app = $('<div>').attr('script_id', getScriptId());
    $('#extensions_settings2').append($app);

    if (app === undefined) {
        app = createApp(Panel);
    }
    app.use(createPinia()).mount($app[0]);
}

function deteleportStyle() {
    $(`head > div[script_id="${getScriptId()}"]`).remove();
}
export function destroyPanel() {
    if (app !== undefined) {
        app.unmount();
        app = undefined;
    }

    $(`#extensions_settings2 > div[script_id="${getScriptId()}"]`).remove();

    deteleportStyle();
}
