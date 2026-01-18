import * as z from 'zod';
export declare const Settings: z.ZodPrefault<z.ZodObject<{
    通知: z.ZodPrefault<z.ZodObject<{
        变量初始化成功: z.ZodDefault<z.ZodBoolean>;
        变量更新出错: z.ZodDefault<z.ZodBoolean>;
        额外模型解析中: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    更新方式: z.ZodDefault<z.ZodEnum<{
        随AI输出: "随AI输出";
        额外模型解析: "额外模型解析";
    }>>;
    额外模型解析配置: z.ZodPrefault<z.ZodObject<{
        破限方案: z.ZodDefault<z.ZodEnum<{
            使用内置破限: "使用内置破限";
            使用当前预设: "使用当前预设";
        }>>;
        使用函数调用: z.ZodDefault<z.ZodBoolean>;
        兼容假流式: z.ZodDefault<z.ZodBoolean>;
        启用自动请求: z.ZodDefault<z.ZodBoolean>;
        请求方式: z.ZodDefault<z.ZodEnum<{
            "\u4F9D\u6B21\u8BF7\u6C42\uFF0C\u5931\u8D25\u540E\u91CD\u8BD5": "依次请求，失败后重试";
            同时请求多次: "同时请求多次";
            "\u5148\u8BF7\u6C42\u4E00\u6B21, \u5931\u8D25\u540E\u518D\u540C\u65F6\u8BF7\u6C42\u591A\u6B21": "先请求一次, 失败后再同时请求多次";
        }>>;
        请求次数: z.ZodDefault<z.ZodNumber>;
        模型来源: z.ZodDefault<z.ZodEnum<{
            与插头相同: "与插头相同";
            自定义: "自定义";
        }>>;
        api地址: z.ZodDefault<z.ZodString>;
        密钥: z.ZodDefault<z.ZodString>;
        模型名称: z.ZodDefault<z.ZodString>;
        温度: z.ZodPipe<z.ZodDefault<z.ZodCoercedNumber<unknown>>, z.ZodTransform<number, number>>;
        频率惩罚: z.ZodPipe<z.ZodDefault<z.ZodCoercedNumber<unknown>>, z.ZodTransform<number, number>>;
        存在惩罚: z.ZodPipe<z.ZodDefault<z.ZodCoercedNumber<unknown>>, z.ZodTransform<number, number>>;
        top_p: z.ZodPipe<z.ZodDefault<z.ZodCoercedNumber<unknown>>, z.ZodTransform<number, number>>;
        最大回复token数: z.ZodPipe<z.ZodDefault<z.ZodCoercedNumber<unknown>>, z.ZodTransform<number, number>>;
    }, z.core.$strip>>;
    自动清理变量: z.ZodPrefault<z.ZodObject<{
        启用: z.ZodDefault<z.ZodBoolean>;
        快照保留间隔: z.ZodDefault<z.ZodNumber>;
        要保留变量的最近楼层数: z.ZodDefault<z.ZodNumber>;
        触发恢复变量的最近楼层数: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    兼容性: z.ZodPrefault<z.ZodObject<{
        更新到聊天变量: z.ZodDefault<z.ZodBoolean>;
        显示老旧功能: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    internal: z.ZodPrefault<z.ZodObject<{
        已提醒更新了配置界面: z.ZodDefault<z.ZodBoolean>;
        已提醒自动清理旧变量功能: z.ZodDefault<z.ZodBoolean>;
        已提醒更新了API温度等配置: z.ZodDefault<z.ZodBoolean>;
        已默认开启自动清理旧变量功能: z.ZodDefault<z.ZodBoolean>;
        已提醒内置破限: z.ZodDefault<z.ZodBoolean>;
        已提醒额外模型同时请求: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    debug: z.ZodPrefault<z.ZodObject<{
        首次额外请求必失败: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$strip>>;
export declare const useDataStore: import("pinia").StoreDefinition<"data", Pick<{
    settings: import("vue").Ref<{
        通知: {
            变量初始化成功: boolean;
            变量更新出错: boolean;
            额外模型解析中: boolean;
        };
        更新方式: "随AI输出" | "额外模型解析";
        额外模型解析配置: {
            破限方案: "使用内置破限" | "使用当前预设";
            使用函数调用: boolean;
            兼容假流式: boolean;
            启用自动请求: boolean;
            请求方式: "依次请求，失败后重试" | "同时请求多次" | "先请求一次, 失败后再同时请求多次";
            请求次数: number;
            模型来源: "与插头相同" | "自定义";
            api地址: string;
            密钥: string;
            模型名称: string;
            温度: number;
            频率惩罚: number;
            存在惩罚: number;
            top_p: number;
            最大回复token数: number;
        };
        自动清理变量: {
            启用: boolean;
            快照保留间隔: number;
            要保留变量的最近楼层数: number;
            触发恢复变量的最近楼层数: number;
        };
        兼容性: {
            更新到聊天变量: boolean;
            显示老旧功能: boolean;
        };
        internal: {
            已提醒更新了配置界面: boolean;
            已提醒自动清理旧变量功能: boolean;
            已提醒更新了API温度等配置: boolean;
            已默认开启自动清理旧变量功能: boolean;
            已提醒内置破限: boolean;
            已提醒额外模型同时请求: boolean;
        };
        debug: {
            首次额外请求必失败: boolean;
        };
    }, {
        通知: {
            变量初始化成功: boolean;
            变量更新出错: boolean;
            额外模型解析中: boolean;
        };
        更新方式: "随AI输出" | "额外模型解析";
        额外模型解析配置: {
            破限方案: "使用内置破限" | "使用当前预设";
            使用函数调用: boolean;
            兼容假流式: boolean;
            启用自动请求: boolean;
            请求方式: "依次请求，失败后重试" | "同时请求多次" | "先请求一次, 失败后再同时请求多次";
            请求次数: number;
            模型来源: "与插头相同" | "自定义";
            api地址: string;
            密钥: string;
            模型名称: string;
            温度: number;
            频率惩罚: number;
            存在惩罚: number;
            top_p: number;
            最大回复token数: number;
        };
        自动清理变量: {
            启用: boolean;
            快照保留间隔: number;
            要保留变量的最近楼层数: number;
            触发恢复变量的最近楼层数: number;
        };
        兼容性: {
            更新到聊天变量: boolean;
            显示老旧功能: boolean;
        };
        internal: {
            已提醒更新了配置界面: boolean;
            已提醒自动清理旧变量功能: boolean;
            已提醒更新了API温度等配置: boolean;
            已默认开启自动清理旧变量功能: boolean;
            已提醒内置破限: boolean;
            已提醒额外模型同时请求: boolean;
        };
        debug: {
            首次额外请求必失败: boolean;
        };
    } | {
        通知: {
            变量初始化成功: boolean;
            变量更新出错: boolean;
            额外模型解析中: boolean;
        };
        更新方式: "随AI输出" | "额外模型解析";
        额外模型解析配置: {
            破限方案: "使用内置破限" | "使用当前预设";
            使用函数调用: boolean;
            兼容假流式: boolean;
            启用自动请求: boolean;
            请求方式: "依次请求，失败后重试" | "同时请求多次" | "先请求一次, 失败后再同时请求多次";
            请求次数: number;
            模型来源: "与插头相同" | "自定义";
            api地址: string;
            密钥: string;
            模型名称: string;
            温度: number;
            频率惩罚: number;
            存在惩罚: number;
            top_p: number;
            最大回复token数: number;
        };
        自动清理变量: {
            启用: boolean;
            快照保留间隔: number;
            要保留变量的最近楼层数: number;
            触发恢复变量的最近楼层数: number;
        };
        兼容性: {
            更新到聊天变量: boolean;
            显示老旧功能: boolean;
        };
        internal: {
            已提醒更新了配置界面: boolean;
            已提醒自动清理旧变量功能: boolean;
            已提醒更新了API温度等配置: boolean;
            已默认开启自动清理旧变量功能: boolean;
            已提醒内置破限: boolean;
            已提醒额外模型同时请求: boolean;
        };
        debug: {
            首次额外请求必失败: boolean;
        };
    }>;
    runtimes: import("vue").Ref<{
        unsupported_warnings: string;
        is_extra_model_supported: boolean;
        is_during_extra_analysis: boolean;
        is_function_call_enabled: boolean;
    }, {
        unsupported_warnings: string;
        is_extra_model_supported: boolean;
        is_during_extra_analysis: boolean;
        is_function_call_enabled: boolean;
    } | {
        unsupported_warnings: string;
        is_extra_model_supported: boolean;
        is_during_extra_analysis: boolean;
        is_function_call_enabled: boolean;
    }>;
    resetRuntimes: () => void;
}, "settings" | "runtimes">, Pick<{
    settings: import("vue").Ref<{
        通知: {
            变量初始化成功: boolean;
            变量更新出错: boolean;
            额外模型解析中: boolean;
        };
        更新方式: "随AI输出" | "额外模型解析";
        额外模型解析配置: {
            破限方案: "使用内置破限" | "使用当前预设";
            使用函数调用: boolean;
            兼容假流式: boolean;
            启用自动请求: boolean;
            请求方式: "依次请求，失败后重试" | "同时请求多次" | "先请求一次, 失败后再同时请求多次";
            请求次数: number;
            模型来源: "与插头相同" | "自定义";
            api地址: string;
            密钥: string;
            模型名称: string;
            温度: number;
            频率惩罚: number;
            存在惩罚: number;
            top_p: number;
            最大回复token数: number;
        };
        自动清理变量: {
            启用: boolean;
            快照保留间隔: number;
            要保留变量的最近楼层数: number;
            触发恢复变量的最近楼层数: number;
        };
        兼容性: {
            更新到聊天变量: boolean;
            显示老旧功能: boolean;
        };
        internal: {
            已提醒更新了配置界面: boolean;
            已提醒自动清理旧变量功能: boolean;
            已提醒更新了API温度等配置: boolean;
            已默认开启自动清理旧变量功能: boolean;
            已提醒内置破限: boolean;
            已提醒额外模型同时请求: boolean;
        };
        debug: {
            首次额外请求必失败: boolean;
        };
    }, {
        通知: {
            变量初始化成功: boolean;
            变量更新出错: boolean;
            额外模型解析中: boolean;
        };
        更新方式: "随AI输出" | "额外模型解析";
        额外模型解析配置: {
            破限方案: "使用内置破限" | "使用当前预设";
            使用函数调用: boolean;
            兼容假流式: boolean;
            启用自动请求: boolean;
            请求方式: "依次请求，失败后重试" | "同时请求多次" | "先请求一次, 失败后再同时请求多次";
            请求次数: number;
            模型来源: "与插头相同" | "自定义";
            api地址: string;
            密钥: string;
            模型名称: string;
            温度: number;
            频率惩罚: number;
            存在惩罚: number;
            top_p: number;
            最大回复token数: number;
        };
        自动清理变量: {
            启用: boolean;
            快照保留间隔: number;
            要保留变量的最近楼层数: number;
            触发恢复变量的最近楼层数: number;
        };
        兼容性: {
            更新到聊天变量: boolean;
            显示老旧功能: boolean;
        };
        internal: {
            已提醒更新了配置界面: boolean;
            已提醒自动清理旧变量功能: boolean;
            已提醒更新了API温度等配置: boolean;
            已默认开启自动清理旧变量功能: boolean;
            已提醒内置破限: boolean;
            已提醒额外模型同时请求: boolean;
        };
        debug: {
            首次额外请求必失败: boolean;
        };
    } | {
        通知: {
            变量初始化成功: boolean;
            变量更新出错: boolean;
            额外模型解析中: boolean;
        };
        更新方式: "随AI输出" | "额外模型解析";
        额外模型解析配置: {
            破限方案: "使用内置破限" | "使用当前预设";
            使用函数调用: boolean;
            兼容假流式: boolean;
            启用自动请求: boolean;
            请求方式: "依次请求，失败后重试" | "同时请求多次" | "先请求一次, 失败后再同时请求多次";
            请求次数: number;
            模型来源: "与插头相同" | "自定义";
            api地址: string;
            密钥: string;
            模型名称: string;
            温度: number;
            频率惩罚: number;
            存在惩罚: number;
            top_p: number;
            最大回复token数: number;
        };
        自动清理变量: {
            启用: boolean;
            快照保留间隔: number;
            要保留变量的最近楼层数: number;
            触发恢复变量的最近楼层数: number;
        };
        兼容性: {
            更新到聊天变量: boolean;
            显示老旧功能: boolean;
        };
        internal: {
            已提醒更新了配置界面: boolean;
            已提醒自动清理旧变量功能: boolean;
            已提醒更新了API温度等配置: boolean;
            已默认开启自动清理旧变量功能: boolean;
            已提醒内置破限: boolean;
            已提醒额外模型同时请求: boolean;
        };
        debug: {
            首次额外请求必失败: boolean;
        };
    }>;
    runtimes: import("vue").Ref<{
        unsupported_warnings: string;
        is_extra_model_supported: boolean;
        is_during_extra_analysis: boolean;
        is_function_call_enabled: boolean;
    }, {
        unsupported_warnings: string;
        is_extra_model_supported: boolean;
        is_during_extra_analysis: boolean;
        is_function_call_enabled: boolean;
    } | {
        unsupported_warnings: string;
        is_extra_model_supported: boolean;
        is_during_extra_analysis: boolean;
        is_function_call_enabled: boolean;
    }>;
    resetRuntimes: () => void;
}, never>, Pick<{
    settings: import("vue").Ref<{
        通知: {
            变量初始化成功: boolean;
            变量更新出错: boolean;
            额外模型解析中: boolean;
        };
        更新方式: "随AI输出" | "额外模型解析";
        额外模型解析配置: {
            破限方案: "使用内置破限" | "使用当前预设";
            使用函数调用: boolean;
            兼容假流式: boolean;
            启用自动请求: boolean;
            请求方式: "依次请求，失败后重试" | "同时请求多次" | "先请求一次, 失败后再同时请求多次";
            请求次数: number;
            模型来源: "与插头相同" | "自定义";
            api地址: string;
            密钥: string;
            模型名称: string;
            温度: number;
            频率惩罚: number;
            存在惩罚: number;
            top_p: number;
            最大回复token数: number;
        };
        自动清理变量: {
            启用: boolean;
            快照保留间隔: number;
            要保留变量的最近楼层数: number;
            触发恢复变量的最近楼层数: number;
        };
        兼容性: {
            更新到聊天变量: boolean;
            显示老旧功能: boolean;
        };
        internal: {
            已提醒更新了配置界面: boolean;
            已提醒自动清理旧变量功能: boolean;
            已提醒更新了API温度等配置: boolean;
            已默认开启自动清理旧变量功能: boolean;
            已提醒内置破限: boolean;
            已提醒额外模型同时请求: boolean;
        };
        debug: {
            首次额外请求必失败: boolean;
        };
    }, {
        通知: {
            变量初始化成功: boolean;
            变量更新出错: boolean;
            额外模型解析中: boolean;
        };
        更新方式: "随AI输出" | "额外模型解析";
        额外模型解析配置: {
            破限方案: "使用内置破限" | "使用当前预设";
            使用函数调用: boolean;
            兼容假流式: boolean;
            启用自动请求: boolean;
            请求方式: "依次请求，失败后重试" | "同时请求多次" | "先请求一次, 失败后再同时请求多次";
            请求次数: number;
            模型来源: "与插头相同" | "自定义";
            api地址: string;
            密钥: string;
            模型名称: string;
            温度: number;
            频率惩罚: number;
            存在惩罚: number;
            top_p: number;
            最大回复token数: number;
        };
        自动清理变量: {
            启用: boolean;
            快照保留间隔: number;
            要保留变量的最近楼层数: number;
            触发恢复变量的最近楼层数: number;
        };
        兼容性: {
            更新到聊天变量: boolean;
            显示老旧功能: boolean;
        };
        internal: {
            已提醒更新了配置界面: boolean;
            已提醒自动清理旧变量功能: boolean;
            已提醒更新了API温度等配置: boolean;
            已默认开启自动清理旧变量功能: boolean;
            已提醒内置破限: boolean;
            已提醒额外模型同时请求: boolean;
        };
        debug: {
            首次额外请求必失败: boolean;
        };
    } | {
        通知: {
            变量初始化成功: boolean;
            变量更新出错: boolean;
            额外模型解析中: boolean;
        };
        更新方式: "随AI输出" | "额外模型解析";
        额外模型解析配置: {
            破限方案: "使用内置破限" | "使用当前预设";
            使用函数调用: boolean;
            兼容假流式: boolean;
            启用自动请求: boolean;
            请求方式: "依次请求，失败后重试" | "同时请求多次" | "先请求一次, 失败后再同时请求多次";
            请求次数: number;
            模型来源: "与插头相同" | "自定义";
            api地址: string;
            密钥: string;
            模型名称: string;
            温度: number;
            频率惩罚: number;
            存在惩罚: number;
            top_p: number;
            最大回复token数: number;
        };
        自动清理变量: {
            启用: boolean;
            快照保留间隔: number;
            要保留变量的最近楼层数: number;
            触发恢复变量的最近楼层数: number;
        };
        兼容性: {
            更新到聊天变量: boolean;
            显示老旧功能: boolean;
        };
        internal: {
            已提醒更新了配置界面: boolean;
            已提醒自动清理旧变量功能: boolean;
            已提醒更新了API温度等配置: boolean;
            已默认开启自动清理旧变量功能: boolean;
            已提醒内置破限: boolean;
            已提醒额外模型同时请求: boolean;
        };
        debug: {
            首次额外请求必失败: boolean;
        };
    }>;
    runtimes: import("vue").Ref<{
        unsupported_warnings: string;
        is_extra_model_supported: boolean;
        is_during_extra_analysis: boolean;
        is_function_call_enabled: boolean;
    }, {
        unsupported_warnings: string;
        is_extra_model_supported: boolean;
        is_during_extra_analysis: boolean;
        is_function_call_enabled: boolean;
    } | {
        unsupported_warnings: string;
        is_extra_model_supported: boolean;
        is_during_extra_analysis: boolean;
        is_function_call_enabled: boolean;
    }>;
    resetRuntimes: () => void;
}, "resetRuntimes">>;
