import {
    handleVariablesInMessage,
    handleVariablesInCallback,
    getLastValidVariable,
} from '@/function';
import { initCheck, createEmptyGameData, loadInitVarData } from '@/variable_init';
import { variable_events } from '@/variable_def';
import { updateDescriptions } from '@/update_descriptions';

$(() => {
    eventOn(tavern_events.GENERATION_STARTED, initCheck);
    eventOn(tavern_events.MESSAGE_SENT, initCheck);
    eventOn(tavern_events.MESSAGE_SENT, handleVariablesInMessage);
    eventOn(tavern_events.MESSAGE_RECEIVED, handleVariablesInMessage);
    eventOn(variable_events.INVOKE_MVU_PROCESS, handleVariablesInCallback);

    // 导出到窗口，便于调试
    _.set(window, 'handleVariablesInMessage', handleVariablesInMessage);
});

$(window).on('unload', () => {
    eventRemoveListener(tavern_events.GENERATION_STARTED, initCheck);
    eventRemoveListener(tavern_events.MESSAGE_SENT, initCheck);
    eventRemoveListener(tavern_events.MESSAGE_SENT, handleVariablesInMessage);
    eventRemoveListener(tavern_events.MESSAGE_RECEIVED, handleVariablesInMessage);
    eventRemoveListener(variable_events.INVOKE_MVU_PROCESS, handleVariablesInCallback);
});

eventOnButton('重新处理变量', async function () {
    const last_msg = getLastMessageId();
    if (last_msg < 1) return;
    if (SillyTavern.chat.length === 0) return;
    await deleteVariable('stat_data', { type: 'message', message_id: last_msg });
    //重新处理变量
    await handleVariablesInMessage(getLastMessageId());
});

eventOnButton('重新读取初始变量', async function () {
    // 1. 创建一个新的空 GameData 并加载 InitVar 数据
    const latest_init_data = createEmptyGameData();

    try {
        const hasInitData = await loadInitVarData(latest_init_data);
        if (!hasInitData) {
            console.error('没有找到 InitVar 数据');
            toastr.error('没有找到 InitVar 数据', '', { timeOut: 3000 });
            return;
        }
    } catch (e) {
        console.error('加载 InitVar 数据失败:', e);
        return;
    }

    // 2. 从最新楼层获取最新变量
    const message_id = getLastMessageId();
    if (message_id < 0) {
        console.error('没有找到消息');
        toastr.error('没有找到消息', '', { timeOut: 3000 });
        return;
    }

    const latest_msg_data = await getLastValidVariable(message_id);

    if (!_.has(latest_msg_data, 'stat_data')) {
        console.error('最新消息中没有找到 stat_data');
        toastr.error('最新消息中没有 stat_data', '', { timeOut: 3000 });
        return;
    }

    // 3. 产生新变量，以 latest_init_data 为基础，合并入 latest_msg_data 的内容
    //此处 latest_init_data 内不存在复杂类型，因此可以采用 structuredClone
    const merged_data = structuredClone(latest_init_data);
    merged_data.stat_data = _.merge(merged_data.stat_data, latest_msg_data.stat_data);

    // 4-5. 遍历并更新描述字段
    updateDescriptions(
        '',
        latest_init_data.stat_data,
        latest_msg_data.stat_data,
        merged_data.stat_data
    );

    // 6. 更新变量到最新消息
    await replaceVariables(merged_data, { type: 'message', message_id: message_id });

    console.info('InitVar更新完成');
    toastr.success('InitVar描述已更新', '', { timeOut: 3000 });
});
