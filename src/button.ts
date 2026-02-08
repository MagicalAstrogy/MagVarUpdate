import { createEmptyGameData, loadInitVarData } from '@/function/initvar/variable_init';
import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { cleanUpMetadata, reconcileAndApplySchema } from '@/function/schema';
import { onMessageReceived } from '@/function/update/on_message_received';
import { handleVariablesInMessage, updateVariables } from '@/function/update_variables';
import { useDataStore } from '@/store';
import { getLastValidMessageId, getLastValidVariable, isFunctionCallingSupported } from '@/util';
import { MvuData } from '@/variable_def';
import { klona } from 'klona';

/**
 * 递归更新描述字段
 *
 * 示例数据结构：
 * initData: {
 *   "属性": {
 *     "value": 100,
 *     "description": "这是初始描述"  // 条件 4(a)
 *   },
 *   "生命值": [100, "初始生命值"],  // 条件 4(b): ValueWithDescription<number>
 *   "技能": [{
 *     "name": "攻击",
 *     "damage": [50, "基础伤害"],  // 嵌套的 ValueWithDescription
 *     "description": "普通攻击"
 *   }],
 *   "装备": {
 *     "武器": ["剑", "初始武器"],  // ValueWithDescription<string>
 *     "属性加成": {
 *       "攻击力": [10, "武器攻击力加成"]
 *     }
 *   }
 * }
 */
function updateDescriptions(_init_path: string, init_data: any, msg_data: any, target_data: any) {
    _.forEach(init_data, (value, key) => {
        const current_path = key; //init_path ? `${init_path}.${key}` : key;

        if (_.isArray(value)) {
            // 检查是否为 ValueWithDescription<T> 类型 (长度为2，第二个元素是字符串)
            if (value.length === 2 && _.isString(value[1])) {
                // 条件 4(b): 满足 ValueWithDescription<T> 定义
                if (_.isArray(_.get(msg_data, current_path))) {
                    const msgValue = _.get(msg_data, current_path);
                    if (msgValue.length === 2) {
                        // 更新描述(第二个元素)
                        _.set(target_data, `${current_path}[1]`, value[1]);

                        // 如果第一个元素是对象或数组，需要递归处理
                        if (_.isObject(value[0]) && !_.isArray(value[0])) {
                            // 处理对象
                            const targetObj = _.get(target_data, `${key}[0]`);

                            // 如果对象包含description属性，需要特殊处理
                            if (
                                _.has(value[0], 'description') &&
                                _.isString(value[0].description)
                            ) {
                                if (_.has(msgValue[0], 'description')) {
                                    _.set(
                                        target_data,
                                        `${current_path}[0].description`,
                                        value[0].description
                                    );
                                }
                            }

                            // 递归处理对象的其他属性
                            updateDescriptions(
                                `${current_path}[0]`,
                                value[0],
                                msgValue[0],
                                targetObj
                            );
                        } else if (_.isArray(value[0])) {
                            // 处理数组
                            updateDescriptions(
                                `${current_path}[0]`,
                                value[0],
                                msgValue[0],
                                target_data[0]
                            );
                        }
                    }
                }
            } else if (_.isArray(_.get(msg_data, current_path))) {
                // 普通数组，递归处理每个元素
                const msg_array = _.get(msg_data, current_path);
                value.forEach((item, index) => {
                    if (index < msg_array.length) {
                        if (_.isObject(item)) {
                            const current_target = _.get(target_data, `${current_path}[${index}]`);
                            // 如果对象包含description属性，需要特殊处理
                            if (_.has(item, 'description') && _.isString(item.description)) {
                                if (_.has(msg_array[index], 'description')) {
                                    _.set(current_target, `description`, item.description);
                                }
                            }

                            updateDescriptions(
                                `${current_path}[${index}]`,
                                value[index],
                                msg_array[index],
                                current_target
                            );
                        }
                    }
                });
            }
        } else if (_.isObject(value)) {
            // 处理对象
            if (_.has(value, 'description') && _.isString(value.description)) {
                // 条件 4(a): 对象包含 description 字段且为字符串
                //msg_data 等已经在递归时跟着进入了更深的层次，不需要 currentPath前缀
                const description_path = `${key}.description`;
                if (_.has(msg_data, description_path)) {
                    _.set(target_data, description_path, value.description);
                }
            }

            // 继续递归处理对象的其他属性
            if (_.has(msg_data, key) && _.isObject(msg_data[key])) {
                updateDescriptions(current_path, value, msg_data[key], target_data[key]);
            }
        }
    });
}

interface Button {
    name: string;
    function: (() => void) | (() => Promise<void>);
    is_legacy?: boolean;
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
        is_legacy: true,
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

            const latest_msg_data = getLastValidVariable(message_id);

            if (!latest_msg_data) {
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

            if (useDataStore().settings.兼容性.更新到聊天变量) {
                await replaceVariables(merged_data, { type: 'chat' });
            }

            console.info('InitVar更新完成');
            toastr.success('InitVar描述已更新', '[MVU]', { timeOut: 3000 });
        },
    },
    {
        name: '快照楼层',
        is_legacy: true,
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
        is_legacy: true,
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

            const fnd_message = getLastValidMessageId(message_id);
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
            const recur_intial_message_id = parseInt(result2);
            if (isNaN(recur_intial_message_id)) {
                toastr.error(`请输入有效的楼层数, 你输入的是 '${result2}'`, '[MVU]楼层重演失败');
                return;
            }

            //进行重演
            //这个变量将会在每次重演的过程一直更新。
            const recur_variable_data = klona(
                getVariables({
                    type: 'message',
                    message_id: recur_intial_message_id,
                })
            );
            if (
                recur_variable_data === undefined ||
                !_.has(recur_variable_data, 'stat_data') ||
                !_.has(recur_variable_data, 'schema')
            ) {
                toastr.error(
                    `请输入含变量信息的楼层, 你输入的是 '${result2}'`,
                    '[MVU]楼层重演失败'
                );
                return;
            }
            let counter = 0;
            /**
             * 对输入的楼层变量进行重演，进行重演的消息内容为 (recur_intial_message_id, recur_end_message_id]
             * @param recur_variable_data 楼层变量(MvuData)
             * @param recur_intial_message_id 开始重演的楼层id(重演过程不会重演这个楼层的变动)
             * @param message_id 结束重演的楼层id(重演过程中会重演这个楼层的变动)
             */
            for (let i = recur_intial_message_id + 1; i <= message_id; i++) {
                const chat_message = SillyTavern.chat[i];
                const index = i - (recur_intial_message_id + 1);

                console.log(`正在重演 ${index}, 内容 ${chat_message.mes}`);
                // @ts-expect-error 新老版本酒馆助手类型信息兼容
                await updateVariables(chat_message.mes, recur_variable_data);

                counter++;
                if (counter % 50 === 0) {
                    toastr.info(
                        `处理变量中 (${counter} / ${message_id - recur_intial_message_id})`,
                        `[MVU]楼层重演`
                    );
                }
            }

            const updater = (data: Record<string, any>) => {
                data.stat_data = recur_variable_data.stat_data;
                data.display_data = recur_variable_data.display_data;
                data.delta_data = recur_variable_data.delta_data;
                data.initialized_lorebooks = recur_variable_data.initialized_lorebooks;
                data.schema = recur_variable_data.schema;
                return data;
            };
            await updateVariablesWith(updater, { type: 'message', message_id: message_id });

            SillyTavern.saveChat().then(() =>
                toastr.success(
                    `已将 ${message_id} 层变量状态重演完毕，共重演 ${counter} 楼`,
                    '[MVU]楼层重演'
                )
            );
            await setChatMessages(
                [
                    {
                        message_id: message_id,
                    },
                ],
                {
                    refresh: 'affected',
                }
            );
        },
    },
    {
        name: '重试额外模型解析',
        function: async () => {
            const store = useDataStore();
            if (store.settings.更新方式 === '随AI输出') {
                toastr.info(
                    `当前配置没有启用额外模型解析，不需要进行此操作`,
                    '[MVU]重试额外模型解析',
                    {
                        timeOut: 3000,
                    }
                );
                return;
            } else if (
                store.settings.额外模型解析配置.使用函数调用 &&
                !isFunctionCallingSupported()
            ) {
                toastr.info(
                    `当前配置指定的LLM不支持函数调用，不需要进行此操作`,
                    '[MVU]重试额外模型解析',
                    {
                        timeOut: 3000,
                    }
                );
                return;
            } else if (!(await isExtraModelSupported())) {
                toastr.info(
                    `当前角色卡不支持额外模型解析，无法进行此操作`,
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
                        current_chat_content.slice(0, begin_pos) +
                        current_chat_content.slice(end_pos + 17);
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
                //需要将当前楼层的变量重置为上一层的样子，才能保证在重试时发出的内容是对的。
                //不能直接删除，因为世界书条目中会取当前楼层的变量。
                const last_valid_msg = getLastValidMessageId(last_msg);
                if (last_valid_msg !== -1) {
                    const last_variable_data = klona(
                        getVariables({
                            type: 'message',
                            message_id: last_valid_msg,
                        })
                    );
                    //还原上一次更新的变量，如果有
                    await updateVariablesWith(
                        variables => {
                            _.set(variables, `stat_data`, last_variable_data?.stat_data);
                            _.set(variables, `delta_data`, last_variable_data?.delta_data);
                            _.set(variables, `display_data`, last_variable_data?.display_data);
                            _.set(variables, `schema`, last_variable_data?.schema);
                            return variables;
                        },
                        { type: 'message', message_id: last_msg }
                    );
                }
            }
            await onMessageReceived(last_msg, { force: true });
            toastr.info(`解析完成`, '[MVU]重试额外模型解析');
        },
    },
    {
        name: '清除旧楼层变量',
        is_legacy: true,
        function: async () => {
            const snapshot_interval = useDataStore().settings.自动清理变量.快照保留间隔;
            const result = (await SillyTavern.callGenericPopup(
                `<h4>清除旧楼层变量信息以减小聊天文件大小避免手机崩溃</h4>请填写要保留变量信息的楼层数 (如 10 为保留最后 10 层，每 [${snapshot_interval}] 层保留一层作为快照)，每 <br><strong>注意: 你需要通过重演才能回退游玩到没保留变量信息的楼层</strong>`,
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
            SillyTavern.chat.slice(1, -depth - 1).forEach((chat_message, index) => {
                if (chat_message.variables === undefined) {
                    return;
                }
                chat_message.variables = _.range(0, chat_message.swipes?.length ?? 1).map(i => {
                    if (chat_message?.variables?.[i] === undefined) {
                        return {};
                    }
                    if (_.get(chat_message.variables[i], 'snapshot') === true)
                        return chat_message.variables[i];
                    if ((index + 1) % snapshot_interval === 0) {
                        chat_message.variables[i].snapshot = true;
                        console.log(`将 [${index + 1}] 层作为快照楼层`);
                        return chat_message.variables[i];
                    }
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

export function initButtons() {
    appendInexistentScriptButtons(buttons.map(button => ({ name: button.name, visible: false })));
    buttons.forEach(button => {
        eventOn(getButtonEvent(button.name), button.function);
    });

    return () => {};
}
