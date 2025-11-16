import { useSettingsStore } from '@/settings';

export function showNotifications() {
    const store = useSettingsStore();

    if (store.settings.internal.已提醒更新了配置界面 === false) {
        toastr.info(
            '配置界面位于酒馆扩展界面-「正则」下方, 请点开了解新功能或自定义配置',
            '[MVU]已更新独立配置界面'
        );
        store.settings.internal.已提醒更新了配置界面 = true;
    }
    if (store.settings.internal.已提醒更新了API温度等配置 === false) {
        toastr.info(
            'MVU 现在可以自定义 API 的温度、频率惩罚、存在惩罚、最大回复 token 数；需要酒馆助手版本 >= 4.0.14',
            '[MVU]已更新更多自定义API配置'
        );
        store.settings.internal.已提醒更新了API温度等配置 = true;
    }
}
