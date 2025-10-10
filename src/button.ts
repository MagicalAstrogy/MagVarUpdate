import { getLastValidVariable, handleVariablesInMessage, updateVariables } from '@/function';
import { cleanUpMetadata, reconcileAndApplySchema } from '@/schema';
import { updateDescriptions } from '@/update_descriptions';
import { MvuData } from '@/variable_def';
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
            //此处 latest_init_data 内不存在复杂类型，因此可以采用 structuredClone
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
            merged_data.display_data = structuredClone(merged_data.stat_data);
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

            await replaceVariables(merged_data, { type: 'chat' });

            console.info('InitVar更新完成');
            toastr.success('InitVar描述已更新', '[MVU]', { timeOut: 3000 });
        },
    },
    {
        name: '快照楼层',
        function: async () => {
            const result = (await SillyTavern.callGenericPopup(
                '<h4>设置快照楼层可以避免指定的楼层在清理操作中被移除变量信息</h4>请填写要保留变量信息的楼层 (如 10 为第 10 层)<br><strong>后续楼层的重演将可以从这一层开始</strong>',
                SillyTavern.POPUP_TYPE.INPUT,
                '10'
            )) as string | undefined;
            if (!result) {
                return;
            }
            const message_id = parseInt(result);
            if (isNaN(message_id)) {
                toastr.error(`请输入有效的楼层数, 你输入的是 '${result}'`, '[MVU]配置楼层快照失败');
                return;
            }
            const chat_message = SillyTavern.chat[message_id];
            if (chat_message === undefined) {
                toastr.error(`无效的楼层 '${result}'`, '[MVU]配置楼层快照失败');
                return;
            }
            _.range(0, chat_message.swipes?.length ?? 1).forEach(i => {
                if (chat_message?.variables?.[i] === undefined) {
                    return;
                }
                chat_message.variables[i].snapshot = true;
            });
            SillyTavern.saveChat().then(() =>
                toastr.success(`已将 ${message_id} 层配置为快照楼层`, '[MVU]配置楼层快照')
            );
        },
    },
    {
        name: '重演楼层',
        function: async () => {
            const result = (await SillyTavern.callGenericPopup(
                '<h4>当变量更新出现 required/extensible 相关问题时，可以尝试通过从过去的楼层重演解决</h4>请填写要进行重演的楼层 (如 10 为第 10 层, -1 为最新楼层)<br><strong>也就是出现问题的楼层</strong>',
                SillyTavern.POPUP_TYPE.INPUT,
                '-1'
            )) as string | undefined;
            if (!result) {
                return;
            }
            let message_id = parseInt(result);
            if (message_id === -1) {
                message_id = getLastMessageId();
            }
            if (isNaN(message_id) || SillyTavern.chat[message_id] === undefined) {
                toastr.error(`请输入有效的楼层数, 你输入的是 '${result}'`, '[MVU]楼层重演失败');
                return;
            }

            const fnd_message = _(SillyTavern.chat)
                .slice(0, message_id) // 不包括那个下标
                .findLastIndex(chat_message => {
                    return (
                        _.get(chat_message, [
                            'variables',
                            chat_message.swipe_id ?? 0,
                            'stat_data',
                        ]) !== undefined &&
                        _.get(chat_message, ['variables', chat_message.swipe_id ?? 0, 'schema']) !==
                            undefined
                    ); //需要同时有 schema 和 stat_data
                });
            if (fnd_message === -1) {
                toastr.error(`无法找到可以进行重演的楼层`, '[MVU]楼层重演失败');
                return;
            }
            //让用户输入从哪个楼层开始重演
            const result2 = (await SillyTavern.callGenericPopup(
                `请填写从哪个楼层开始重演，找到最近的支持重演楼层为 [${fnd_message}]`,
                SillyTavern.POPUP_TYPE.INPUT,
                fnd_message.toString()
            )) as string | undefined;
            if (!result2) {
                return;
            }
            const final_message_id = parseInt(result2);
            if (isNaN(final_message_id)) {
                toastr.error(`请输入有效的楼层数, 你输入的是 '${result2}'`, '[MVU]楼层重演失败');
                return;
            }

            //进行重演
            const final_variable_data = structuredClone(
                getVariables({
                    type: 'message',
                    message_id: final_message_id,
                })
            );
            if (
                final_variable_data === undefined ||
                !_.has(final_variable_data, 'stat_data') ||
                !_.has(final_variable_data, 'schema')
            ) {
                toastr.error(
                    `请输入含变量信息的楼层, 你输入的是 '${result2}'`,
                    '[MVU]楼层重演失败'
                );
                return;
            }
            let counter = 0;
            for (let i = final_message_id + 1; i <= message_id; i++) {
                const chat_message = SillyTavern.chat[i];
                const index = i - (final_message_id + 1);

                console.log(`正在重演 ${index}, 内容 ${chat_message.mes}`);
                await updateVariables(chat_message.mes, final_variable_data);

                counter++;
                if (counter % 50 === 0) {
                    toastr.info(
                        `处理变量中 (${counter} / ${message_id - final_message_id})`,
                        `[MVU]楼层重演`
                    );
                }
            }

            const updater = (data: Record<string, any>) => {
                data.stat_data = final_variable_data.stat_data;
                data.display_data = final_variable_data.display_data;
                data.delta_data = final_variable_data.delta_data;
                data.initialized_lorebooks = final_variable_data.initialized_lorebooks;
                data.schema = final_variable_data.schema;
                return data;
            };
            await updateVariablesWith(updater, { type: 'message', message_id: message_id });

            SillyTavern.saveChat().then(() =>
                toastr.success(
                    `已将 ${message_id} 层变量状态重演完毕，共重演 ${counter} 楼`,
                    '[MVU]楼层重演'
                )
            );
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
                toastr.error(
                    `请输入有效的楼层数, 你输入的是 '${result}'`,
                    '[MVU]清理旧楼层变量失败'
                );
                return;
            }
            SillyTavern.chat.slice(1, -depth).forEach(chat_message => {
                if (chat_message.variables === undefined) {
                    return;
                }
                chat_message.variables = _.range(0, chat_message.swipes?.length ?? 1).map(i => {
                    if (chat_message?.variables?.[i] === undefined) {
                        return {};
                    }
                    if (_.get(chat_message.variables[i], 'snapshot') === true)
                        return chat_message.variables[i];
                    return _.omit(
                        chat_message.variables[i],
                        `stat_data`,
                        `display_data`,
                        `delta_data`,
                        `schema`
                    );
                });
            });
            SillyTavern.saveChat().then(() =>
                toastr.success(
                    `已清理旧变量, 保留了最后 ${depth} 层的变量`,
                    '[MVU]清理旧楼层变量成功'
                )
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
