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
export function updateDescriptions(
    _init_path: string,
    init_data: any,
    msg_data: any,
    target_data: any
) {
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
            } else if (_.has(msg_data, current_path) && _.isArray(_.get(msg_data, current_path))) {
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
