import { useDataStore } from '@/store';

export function showNotifications() {
    const store = useDataStore();

    if (store.settings.internal.已提醒更新了配置界面 === false) {
        toastr.info(
            '配置界面位于酒馆扩展界面-「正则」下方, 请点开了解新功能或自定义配置',
            '[MVU]已更新独立配置界面'
        );
        store.settings.internal.已提醒更新了配置界面 = true;
    }
    if (store.settings.internal.已提醒自动清理旧变量功能 === false) {
        toastr.info(
            'MVU 现在可以自动清理旧变量来减少聊天文件大小; 这不会影响你回退游玩以前的楼层；在设置中开启 `变量自动清理` 启用',
            '[MVU]已更新自动清理旧变量功能'
        );
        store.settings.internal.已提醒自动清理旧变量功能 = true;
    }
    if (store.settings.internal.已提醒更新了API温度等配置 === false) {
        toastr.info(
            'MVU 现在可以自定义 API 的温度、频率惩罚、存在惩罚、最大回复 token 数；需要酒馆助手版本 >= 4.0.14',
            '[MVU]已更新更多自定义API配置'
        );
        store.settings.internal.已提醒更新了API温度等配置 = true;
    }

    if (store.settings.internal.已默认开启自动清理旧变量功能 === false) {
        toastr.info(
            'MVU 现在会自动清理较老楼层上的变量信息，以降低聊天文件大小。',
            '[MVU]已更新自动清理配置'
        );
        //会在 main.ts 中进行具体的设置操作，所以提醒部分不需更新。
    }
}
