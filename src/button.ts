import { getLastValidVariable, handleVariablesInMessage } from '@/function';
import { cleanUpMetadata, reconcileAndApplySchema } from '@/schema';
import { useSettingsStore } from '@/settings';
import { updateDescriptions } from '@/update_descriptions';
import { isFunctionCallingSupported, scopedEventOn } from '@/util';
import { MvuData } from '@/variable_def';
import { createEmptyGameData, loadInitVarData } from '@/variable_init';
import { klona } from 'klona';

interface Button {
    name: string;
    function: (() => void) | (() => Promise<void>);
}

type OnMessageReceived = (message_id: number, reason?: any) => Promise<void>;

let msg_received_callback: OnMessageReceived;
let is_extra_model_support: boolean;

export function SetReceivedCallbackFn(fn: OnMessageReceived) {
    msg_received_callback = fn;
}
export function SetExtraModelSupported(is_support: boolean) {
    is_extra_model_support = is_support;
}

async function EmitVariableAnalysisJob() {
    const settings = useSettingsStore().settings;
    if (settings.更新方式 === '随AI输出') {
        toastr.info(`当前配置没有启用额外模型解析，不需要进行此操作`, '[MVU]重试额外模型解析', {
            timeOut: 3000,
        });
        return;
    } else if (settings.额外模型解析配置.使用函数调用 && !isFunctionCallingSupported()) {
        toastr.info(`当前配置指定的LLM不支持函数调用，不需要进行此操作`, '[MVU]重试额外模型解析', {
            timeOut: 3000,
        });
        return;
    } else if (!is_extra_model_support) {
        toastr.info(
            `当前角色卡不支持额外模型解析，或是刚刚刷新页面，无法进行此操作`,
            '[MVU]重试额外模型解析',
            {
                timeOut: 3000,
            }
        );
        return;
    }
    const last_msg = getLastMessageId();
    const current_chatmsg = getChatMessages(last_msg).at(-1);
    const current_chat_content = current_chatmsg?.message ?? '';
    const begin_pos = current_chat_content.lastIndexOf('<UpdateVariable>');
    if (begin_pos >= 0) {
        //裁剪掉已有的变量更新块
        const end_pos = current_chat_content.lastIndexOf('</UpdateVariable>');
        let filtered_string = '';
        if (end_pos === -1) {
            //没有找到，裁剪掉后面的所有内容
            filtered_string = current_chat_content.slice(0, begin_pos);
        } else {
            //找到了，还需要拼接 </UpdateVariable> 后的内容
            filtered_string =
                current_chat_content.slice(0, begin_pos) + current_chat_content.slice(end_pos + 17);
        }
        //更新聊天记录
        await setChatMessages(
            [
                {
                    message_id: last_msg,
                    message: filtered_string,
                },
            ],
            {
                refresh: 'none',
            }
        );
    }
    await msg_received_callback(last_msg, 'manual_emit');
    toastr.info(`解析完成`, '[MVU]重试额外模型解析');
}

export const buttons: Button[] = [
    {
        name: '重新处理变量',
        function: async () => {
            const last_msg = getLastMessageId();
            if (last_msg < 1) return;
            if (SillyTavern.chat.length === 0) return;
            await updateVariablesWith(
                variables => {
                    _.unset(variables, `stat_data`);
                    _.unset(variables, `delta_data`);
                    _.unset(variables, `display_data`);
                    _.unset(variables, `schema`);
                    return variables;
                },
                { type: 'message', message_id: last_msg }
            );
            //重新处理变量
            await handleVariablesInMessage(getLastMessageId());
        },
    },
    {
        name: '重新读取初始变量',
        function: async () => {
            // 1. 创建一个新的空 GameData 并加载 InitVar 数据
            const latest_init_data = createEmptyGameData();

            try {
                const hasInitData = await loadInitVarData(latest_init_data);
                if (!hasInitData) {
                    console.error('没有找到 InitVar 数据');
                    toastr.error('没有找到 InitVar 数据', '[MVU]', { timeOut: 3000 });
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
                toastr.error('没有找到消息', '[MVU]', { timeOut: 3000 });
                return;
            }

            const latest_msg_data = await getLastValidVariable(message_id);

            if (!_.has(latest_msg_data, 'stat_data')) {
                console.error('最新消息中没有找到 stat_data');
                toastr.error('最新消息中没有 stat_data', '[MVU]', { timeOut: 3000 });
                return;
            }

            // 3. 产生新变量，以 latest_init_data 为基础，合并入 latest_msg_data 的内容
            //此处 latest_init_data 内不存在复杂类型，因此可以采用 klona
            const merged_data: Record<string, any> = { stat_data: undefined, schema: undefined };
            merged_data.stat_data = _.merge(
                {},
                latest_init_data.stat_data,
                latest_msg_data.stat_data
            );
            merged_data.schema = _.merge({}, latest_msg_data.schema, latest_init_data.schema);
            merged_data.initialized_lorebooks = _.merge(
                {},
                latest_init_data.initialized_lorebooks,
                latest_msg_data.initialized_lorebooks
            );
            merged_data.display_data = klona(merged_data.stat_data);
            merged_data.delta_data = latest_msg_data.delta_data;

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

            // @ts-expect-error 该函数可用
            await setChatMessage({}, message_id);

            if (useSettingsStore().settings.更新到聊天变量) {
                await replaceVariables(merged_data, { type: 'chat' });
            }

            console.info('InitVar更新完成');
            toastr.success('InitVar描述已更新', '[MVU]', { timeOut: 3000 });
        },
    },
    {
        name: '重试额外模型解析',
        function: EmitVariableAnalysisJob,
    },
];

export function registerButtons() {
    appendInexistentScriptButtons(buttons.map(b => ({ name: b.name, visible: false })));
    buttons.forEach(b => {
        scopedEventOn(getButtonEvent(b.name), b.function);
    });
}
