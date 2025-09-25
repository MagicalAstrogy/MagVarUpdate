import Panel from '@/Panel.vue';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

const app = createApp(Panel);

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

    app.use(createPinia()).mount($app[0]);
}

function deteleportStyle() {
    $(`head > div[script_id="${getScriptId()}"]`).remove();
}
export function destroyPanel() {
    app.unmount();

    $(`#extensions_settings2 > div[script_id="${getScriptId()}"]`).remove();

    deteleportStyle();
}
