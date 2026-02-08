import { cleanupMessageVariables } from '@/function/cleanup/cleanup_variables';
import { useDataStore } from '@/store';

export async function checkAndCleanupLegacyChat() {
    const store = useDataStore();
    if (
        !store.settings.自动清理变量.启用 ||
        SillyTavern.chat.length <= store.settings.自动清理变量.要保留变量的最近楼层数 + 5 ||
        !_.has(SillyTavern.chat, [1, 'variables', 0, 'stat_data']) ||
        _.has(SillyTavern.chat, [1, 'variables', 0, 'ignore_cleanup'])
    ) {
        return;
    }

    const result = await SillyTavern.callGenericPopup(
        '检测可以清理本聊天文件的旧变量从而减少文件体积, 是否清理?(备份会消耗较多内存，手机上建议关闭其他后台应用后进行，或是在计算机上备份)',
        SillyTavern.POPUP_TYPE.CONFIRM,
        '',
        {
            okButton: '仅清理',
            cancelButton: '不再提醒',
            customButtons: ['备份并清理'],
        }
    );

    if (
        result === SillyTavern.POPUP_RESULT.CANCELLED ||
        result === SillyTavern.POPUP_RESULT.NEGATIVE
    ) {
        _.set(SillyTavern.chat, [1, 'variables', 0, 'ignore_cleanup'], true);
        return;
    }
    toastr.info(
        `即将开始清理就聊天记录的变量${result === SillyTavern.POPUP_RESULT.CUSTOM1 ? '，自动生成备份' : ''}...`,
        '[MVU]自动清理'
    );

    if (result === SillyTavern.POPUP_RESULT.CUSTOM1 || result === 2) {
        try {
            const body = {
                is_group: false,
                avatar_url: SillyTavern.characters[Number(SillyTavern.characterId)]?.avatar,
                file: `${SillyTavern.getCurrentChatId()}.jsonl`,
                exportfilename: `${SillyTavern.getCurrentChatId()}.jsonl`,
                format: 'jsonl',
            };

            const response = await fetch('/api/chats/export', {
                method: 'POST',
                body: JSON.stringify(body),
                headers: SillyTavern.getRequestHeaders(),
            });
            const data = await response.json();
            if (!response.ok) {
                toastr.error(`聊天记录导出失败，放弃清理: ${data.message}`, '[MVU]自动清理');
                return;
            }

            const serialized = data.result;
            const blob = new Blob([serialized], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = body.exportfilename;
            link.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            toastr.error(`聊天记录导出失败，放弃清理: ${error}`, '[MVU]自动清理');
            return;
        }
    }

    const counter = cleanupMessageVariables(
        1, //0 层永不清理，以保证始终有快照能力。
        SillyTavern.chat.length - 1 - store.settings.自动清理变量.要保留变量的最近楼层数,
        store.settings.自动清理变量.快照保留间隔
    );
    if (counter > 0) {
        toastr.info(`已清理老聊天记录中的 ${counter} 条消息`, '[MVU]自动清理', {
            timeOut: 1000,
        });
    }
}
