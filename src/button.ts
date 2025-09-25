import { getLastValidVariable, handleVariablesInMessage } from '@/function';
import { updateDescriptions } from '@/update_descriptions';
import { createEmptyGameData, loadInitVarData } from '@/variable_init';

interface Button {
    name: string;
    function: (() => void) | (() => Promise<void>);
}
export const buttons: Button[] = [
    {
        name: '重新处理变量',
        function: async () => {
            const last_msg = getLastMessageId();
            if (last_msg < 1 || SillyTavern.chat.length === 0) {
                return;
            }
            await updateVariablesWith(
                variables => {
                    _.unset(variables, 'stat_data');
                    _.unset(variables, 'delta_data');
                    _.unset(variables, 'display_data');
                    return variables;
                },
                { type: 'message', message_id: last_msg }
            );
            await handleVariablesInMessage(last_msg);
        },
    },
    {
        name: '重新读取初始变量',
        function: async () => {
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
        },
    },
    {
        name: '清除旧楼层变量',
        function: async () => {
            const result = (await SillyTavern.callGenericPopup(
                '<h4>清除旧楼层变量信息以减小聊天文件大小避免手机崩溃</h4>请填写要保留变量信息的楼层数 (如 10 为保留最后 10 层)<br><strong>注意: 你将不能正常回退游玩到没保留变量信息的楼层</strong>',
                SillyTavern.POPUP_TYPE.INPUT,
                '10'
            )) as string | undefined;
            if (!result) {
                return;
            }
            const depth = parseInt(result);
            if (isNaN(depth)) {
                toastr.error(`请输入有效的楼层数, 你输入的是 '${result}'`, '清理旧楼层变量失败');
                return;
            }
            SillyTavern.chat.slice(0, -depth).forEach(chat_message => {
                if (chat_message.variables === undefined) return;
                chat_message.variables.forEach(variable => {
                    _.unset(variable, `stat_data`);
                    _.unset(variable, `display_data`);
                    _.unset(variable, `delta_data`);
                    _.unset(variable, `schema`);
                });
            });
            SillyTavern.saveChat().then(() =>
                toastr.success(`已清理旧变量, 保留了最后 ${depth} 层的变量`, '清理旧楼层变量成功')
            );
        },
    },
];

export function registerButtons() {
    appendInexistentScriptButtons(buttons.map(b => ({ name: b.name, visible: false })));
    buttons.forEach(b => {
        eventOn(getButtonEvent(b.name), b.function);
    });
}
