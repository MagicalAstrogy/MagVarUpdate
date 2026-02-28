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
export declare function updateDescriptions(_init_path: string, init_data: any, msg_data: any, target_data: any): void;
interface Button {
    name: string;
    function: (() => void) | (() => Promise<void>);
    is_legacy?: boolean;
}
export declare const buttons: Button[];
export declare function initButtons(): () => void;
export {};
