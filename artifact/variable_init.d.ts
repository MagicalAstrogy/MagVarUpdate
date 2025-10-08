import { MvuData } from '@/variable_def';
export declare function initCheck(): Promise<void>;
/**
 * 获取所有启用的 lorebook 列表
 */
export declare function getEnabledLorebookList(): Promise<string[]>;
/**
 * 从 lorebook 中加载所有 InitVar 数据并合并到提供的 GameData 中
 */
export declare function loadInitVarData(mvu_data: MvuData, lorebook_list?: string[]): Promise<boolean>;
/**
 * 创建一个新的空 GameData 对象
 */
export declare function createEmptyGameData(): MvuData;
/**
 * 获取最后一条消息的变量数据
 */
export declare function getLastMessageVariables(): Promise<{
    message: ChatMessageSwiped;
    variables: MvuData | undefined;
}>;
/**
 * 更新 lorebook 设置为推荐配置
 */
export declare function updateLorebookSettings(): Promise<void>;
