import { PLOT_REGEX, UPDATE_REGEX } from '@/variable_def';

export async function isExtraModelSupported(): Promise<boolean> {
    try {
        const lorebook_name = getCurrentCharPrimaryLorebook();
        if (!lorebook_name) {
            return false;
        }
        return await getLorebookEntries(lorebook_name).then(entries =>
            entries.some(
                entry => UPDATE_REGEX.test(entry.comment) || PLOT_REGEX.test(entry.comment)
            )
        );
    } catch {
        console.warn('无法找到角色世界书，在多人聊天下不支持额外模型解析。');
        return false;
    }
}
