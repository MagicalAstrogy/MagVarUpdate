import { getLastValidVariable, handleVariablesInMessage } from '@/function';
import { updateDescriptions } from '@/update_descriptions';
import { createEmptyGameData, loadInitVarData } from '@/variable_init';
import { cleanUpMetadata, reconcileAndApplySchema } from '@/schema';
import { MvuData } from '@/variable_def';

const buttons = ['重新处理变量', '重新读取初始变量', '清除旧楼层变量'];

// Rate limiting for button callbacks - execute at most once every 3 seconds
let lastButtonExecutionTime = 0;
const BUTTON_RATE_LIMIT_INTERVAL = 3000; // 3 seconds in milliseconds

function addButtons() {
    const current_buttons = getScriptButtons(getScriptId());
    const current_button_names = current_buttons.map(b => b.name);
    for (const button of buttons.filter(b => !current_button_names.includes(b))) {
        current_buttons.push({ name: button, visible: false });
    }
    replaceScriptButtons(getScriptId(), current_buttons);
}

export function registerButtons() {
    addButtons();

    eventOnButton('重新处理变量', async function () {
        // Skip rate limiting in Jest test environment
        const isJestEnvironment =
            // @ts-ignore
            typeof jest !== 'undefined' ||
            // @ts-ignore
            (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test');

        if (!isJestEnvironment) {
            const now = Date.now();
            if (now - lastButtonExecutionTime < BUTTON_RATE_LIMIT_INTERVAL) {
                console.info('Rate limit applied: 重新处理变量 button skipped');
                toastr.warning('避免重复点击', '防止连点', { timeOut: 1000 });
                return;
            }
            lastButtonExecutionTime = now;
        }

        const last_msg = getLastMessageId();
        if (last_msg < 1) return;
        if (SillyTavern.chat.length === 0) return;
        await deleteVariable('stat_data', { type: 'message', message_id: last_msg });
        await deleteVariable('delta_data', { type: 'message', message_id: last_msg });
        await deleteVariable('display_data', { type: 'message', message_id: last_msg });
        await deleteVariable('schema', { type: 'message', message_id: last_msg });
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
        await reconcileAndApplySchema(latest_init_data);

        cleanUpMetadata(latest_init_data.stat_data);

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
        const merged_data: Record<string, any> = { stat_data: undefined, schema: undefined };
        merged_data.stat_data = _.merge({}, latest_init_data.stat_data, latest_msg_data.stat_data);
        merged_data.schema = _.merge({}, latest_msg_data.schema, latest_init_data.schema);

        // 4-5. 遍历并更新描述字段
        updateDescriptions(
            '',
            latest_init_data.stat_data,
            latest_msg_data.stat_data,
            merged_data.stat_data
        );

        //应用
        await reconcileAndApplySchema(merged_data as MvuData);

        cleanUpMetadata(merged_data.stat_data);

        // 6. 更新变量到最新消息
        await replaceVariables(merged_data, { type: 'message', message_id: message_id });

        await replaceVariables(merged_data, { type: 'chat' });

        console.info('InitVar更新完成');
        toastr.success('InitVar描述已更新', '', { timeOut: 3000 });
    });

    eventOnButton('清除旧楼层变量', async function () {
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
    });
}
