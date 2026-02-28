export declare const useDataStore: import("pinia").StoreDefinition<"MVU变量框架", Pick<{
    settings: globalThis.Ref<{
        通知: {
            MVU框架加载成功: boolean;
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
            top_k: number;
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
            已开启默认不兼容假流式: boolean;
        };
    }, {
        通知: {
            MVU框架加载成功: boolean;
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
            top_k: number;
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
            已开启默认不兼容假流式: boolean;
        };
    } | {
        通知: {
            MVU框架加载成功: boolean;
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
            top_k: number;
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
            已开启默认不兼容假流式: boolean;
        };
    }>;
    runtimes: globalThis.Ref<{
        unsupported_warnings: string;
        is_during_extra_analysis: boolean;
        is_function_call_enabled: boolean;
        debug: {
            首次额外请求必失败: boolean;
        };
    }, {
        unsupported_warnings: string;
        is_during_extra_analysis: boolean;
        is_function_call_enabled: boolean;
        debug: {
            首次额外请求必失败: boolean;
        };
    } | {
        unsupported_warnings: string;
        is_during_extra_analysis: boolean;
        is_function_call_enabled: boolean;
        debug: {
            首次额外请求必失败: boolean;
        };
    }>;
    versions: globalThis.Ref<{
        sillytavern: string;
        tavernhelper: string;
    }, {
        sillytavern: string;
        tavernhelper: string;
    } | {
        sillytavern: string;
        tavernhelper: string;
    }>;
    resetRuntimes: () => void;
    _wait_init: () => Promise<void>;
}, "settings" | "runtimes" | "versions">, Pick<{
    settings: globalThis.Ref<{
        通知: {
            MVU框架加载成功: boolean;
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
            top_k: number;
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
            已开启默认不兼容假流式: boolean;
        };
    }, {
        通知: {
            MVU框架加载成功: boolean;
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
            top_k: number;
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
            已开启默认不兼容假流式: boolean;
        };
    } | {
        通知: {
            MVU框架加载成功: boolean;
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
            top_k: number;
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
            已开启默认不兼容假流式: boolean;
        };
    }>;
    runtimes: globalThis.Ref<{
        unsupported_warnings: string;
        is_during_extra_analysis: boolean;
        is_function_call_enabled: boolean;
        debug: {
            首次额外请求必失败: boolean;
        };
    }, {
        unsupported_warnings: string;
        is_during_extra_analysis: boolean;
        is_function_call_enabled: boolean;
        debug: {
            首次额外请求必失败: boolean;
        };
    } | {
        unsupported_warnings: string;
        is_during_extra_analysis: boolean;
        is_function_call_enabled: boolean;
        debug: {
            首次额外请求必失败: boolean;
        };
    }>;
    versions: globalThis.Ref<{
        sillytavern: string;
        tavernhelper: string;
    }, {
        sillytavern: string;
        tavernhelper: string;
    } | {
        sillytavern: string;
        tavernhelper: string;
    }>;
    resetRuntimes: () => void;
    _wait_init: () => Promise<void>;
}, never>, Pick<{
    settings: globalThis.Ref<{
        通知: {
            MVU框架加载成功: boolean;
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
            top_k: number;
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
            已开启默认不兼容假流式: boolean;
        };
    }, {
        通知: {
            MVU框架加载成功: boolean;
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
            top_k: number;
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
            已开启默认不兼容假流式: boolean;
        };
    } | {
        通知: {
            MVU框架加载成功: boolean;
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
            top_k: number;
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
            已开启默认不兼容假流式: boolean;
        };
    }>;
    runtimes: globalThis.Ref<{
        unsupported_warnings: string;
        is_during_extra_analysis: boolean;
        is_function_call_enabled: boolean;
        debug: {
            首次额外请求必失败: boolean;
        };
    }, {
        unsupported_warnings: string;
        is_during_extra_analysis: boolean;
        is_function_call_enabled: boolean;
        debug: {
            首次额外请求必失败: boolean;
        };
    } | {
        unsupported_warnings: string;
        is_during_extra_analysis: boolean;
        is_function_call_enabled: boolean;
        debug: {
            首次额外请求必失败: boolean;
        };
    }>;
    versions: globalThis.Ref<{
        sillytavern: string;
        tavernhelper: string;
    }, {
        sillytavern: string;
        tavernhelper: string;
    } | {
        sillytavern: string;
        tavernhelper: string;
    }>;
    resetRuntimes: () => void;
    _wait_init: () => Promise<void>;
}, "resetRuntimes" | "_wait_init">>;
