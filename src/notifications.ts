import { useDataStore } from '@/store';

function notify(title: string, message: string) {
    toastr.success(message, title, { timeOut: 10000 });
}

export function showNotifications() {
    const store = useDataStore();

    if (store.settings.internal.已提醒更新了配置界面 === false) {
        notify(
            '[MVU]已更新独立配置界面',
            '配置界面位于酒馆扩展界面-「正则」下方, 请点开了解新功能或自定义配置'
        );
        store.settings.internal.已提醒更新了配置界面 = true;
    }
    if (store.settings.internal.已提醒自动清理旧变量功能 === false) {
        notify(
            '[MVU]已更新自动清理旧变量功能',
            'MVU 现在可以自动清理旧变量来减少聊天文件大小; 这不会影响你回退游玩以前的楼层；在设置中开启 `变量自动清理` 启用'
        );
        store.settings.internal.已提醒自动清理旧变量功能 = true;
    }
    if (store.settings.internal.已提醒更新了API温度等配置 === false) {
        notify(
            '[MVU]已更新更多自定义API配置',
            'MVU 现在可以自定义 API 的温度、频率惩罚、存在惩罚、最大回复 token 数；需要酒馆助手版本 >= 4.0.14'
        );
        store.settings.internal.已提醒更新了API温度等配置 = true;
    }

    if (store.settings.internal.已默认开启自动清理旧变量功能 === false) {
        notify(
            '[MVU]已更新自动清理配置',
            'MVU 现在会自动清理较老楼层上的变量信息，以降低聊天文件大小。'
        );
        store.settings.internal.已默认开启自动清理旧变量功能 = true;
        store.settings.自动清理变量.启用 = true;
    }

    if (store.settings.internal.已提醒内置破限 === false) {
        notify(
            '[MVU]已内置破限',
            '现在，额外模型解析如果取消「发送预设」，则会使用内置的破限提示词——既避免写作任务又避免道歉'
        );
        store.settings.internal.已提醒内置破限 = true;
    }

    if (store.settings.internal.已提醒额外模型同时请求 === false) {
        notify(
            '[MVU]已支持同时多次请求变量更新',
            '现在，你可以在「变量更新方式-请求策略-请求方式」中选择它，提高额外模型解析成功率且节省时间'
        );
        store.settings.internal.已提醒额外模型同时请求 = true;
    }
}
