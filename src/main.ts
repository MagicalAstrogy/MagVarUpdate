import { registerButtons } from '@/button';
import { exportGlobals } from '@/export_globals';
import { handleVariablesInCallback, handleVariablesInMessage, updateVariable } from '@/function';
import { destroyPanel, initPanel } from '@/panel';
import { useSettingsStore } from '@/settings';
import { exported_events } from '@/variable_def';
import { initCheck } from '@/variable_init';
import { compare } from 'compare-versions';

$(async () => {
    if (compare(await getTavernHelperVersion(), '3.4.17', '<')) {
        toastr.warning(
            '酒馆助手版本过低, 可能无法正常处理, 请更新至 3.4.17 或更高版本（建议保持酒馆助手最新）'
        );
    }

    initPanel();

    exportGlobals();
    registerButtons();
    eventOn(tavern_events.GENERATION_STARTED, initCheck);
    eventOn(tavern_events.MESSAGE_SENT, initCheck);
    eventOn(tavern_events.MESSAGE_SENT, handleVariablesInMessage);

    const settings = useSettingsStore().settings;
    let reverse = false;
    eventOn(tavern_events.WORLD_INFO_ACTIVATED, entries => {
        if (settings.更新方式 === '随AI输出') {
            return;
        }
        _.remove(entries, entry => {
            const match = entry.comment.match(/\[mvu_update\]/i);
            return reverse ? !match : !!match;
        });
    });
    eventOn(tavern_events.MESSAGE_RECEIVED, async message_id => {
        if (settings.更新方式 === '随AI输出') {
            handleVariablesInMessage(message_id);
            return;
        }

        reverse = true;
        // TODO: 破限怎么办
        const result = await generateRaw({
            user_input: `---
<status_description>
<%= YAML.stringify(getvar('stat_data'), { blockQuote: 'literal' }) _%>
</status_description>
<must>停止扮演模式，以旁白视角分析最新剧情，按照变量更新规则更新\`<status_description>\`中的变量</must>`,
        });
        reverse = false;

        // QUESTION: 目前的方案是直接将额外模型对变量的解析结果直接尾附到楼层中, 会不会像 tool calling 那样把结果新建为一个楼层更好?
        const chat_message = getChatMessages(message_id);
        await setChatMessages(
            [
                {
                    message_id,
                    message:
                        chat_message[0].message +
                        '<UpdateVariable>' +
                        result
                            .replaceAll('<UpdateVariable>', '')
                            .replaceAll('</UpdateVariable>', '') +
                        '</UpdateVariable>',
                },
            ],
            {
                refresh: 'none',
            }
        );
        handleVariablesInMessage(message_id);
    });

    eventOn(exported_events.INVOKE_MVU_PROCESS, handleVariablesInCallback);
    eventOn(exported_events.UPDATE_VARIABLE, updateVariable);
    _.set(parent.window, 'handleVariablesInMessage', handleVariablesInMessage);
});

$(window).on('pagehide', () => {
    destroyPanel();
});
