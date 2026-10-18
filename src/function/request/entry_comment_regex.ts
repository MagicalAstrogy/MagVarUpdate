import { tr } from '@/i18n';

export { compileRegex as compileEntryCommentRegex } from '@/util/regex';
export type { RegexCompileResult as EntryCommentRegexCompileResult } from '@/util/regex';

export type EntryCommentFilterSource = '用户全局配置' | '角色卡配置';

export type EntryCommentFilterResult = {
    lore: 'globalLore' | 'characterLore' | 'chatLore' | 'personaLore';
    world: string;
    comment: string;
    reason: '白名单' | '黑名单';
    sources: EntryCommentFilterSource[];
};

export const ENTRY_COMMENT_FILTER_LOG_TITLE = tr('runtime.filter.logTitle');

export function logEntryCommentFilterResult(result: EntryCommentFilterResult[]) {
    console.log(
        ENTRY_COMMENT_FILTER_LOG_TITLE,
        result.map(entry => ({ ...entry }))
    );
}

export function testEntryCommentRegex(regex: RegExp, comment: string): boolean {
    regex.lastIndex = 0;
    return regex.test(comment);
}
