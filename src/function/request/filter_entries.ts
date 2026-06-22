import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { isFunctionCallingSupported } from '@/function/is_function_calling_supported';
import {
    compileEntryCommentRegex,
    EntryCommentFilterResult,
    logEntryCommentFilterResult,
    testEntryCommentRegex,
} from '@/function/request/entry_comment_regex';
import { useDataStore } from '@/store';
import { PLOT_REGEX, UPDATE_REGEX } from '@/variable_def';

export async function filterEntries(lores: {
    globalLore: Record<string, any>[];
    characterLore: Record<string, any>[];
    chatLore: Record<string, any>[];
    personaLore: Record<string, any>[];
}) {
    const store = useDataStore();
    store.runtimes.unsupported_warnings = '';
    if (store.runtimes.is_during_extra_analysis) {
        store.runtimes.上次世界书条目过滤结果 = [];
    }

    //在这个回调中，会将所有lore的条目传入，此处可以去除所有 [mvu_update] 相关的条目，避免在非更新的轮次中输出相关内容。
    if (store.settings.更新方式 === '随AI输出') {
        return;
    }
    if (store.settings.额外模型解析配置.应答格式 === '工具调用' && !isFunctionCallingSupported()) {
        toastr.warning(
            '当前 TavernHelper 版本或 预设/API 不支持工具调用，已退化回 `随AI输出`',
            '[MVU]无法使用工具调用',
            {
                timeOut: 2000,
            }
        );
        return;
    }

    const supported_worlds = new Set<string>();
    const remove_and_check = (lore: Record<string, any>[]) => {
        // 规则应当为：存在任意一个 [mvu_plot]/[mvu_update] 即算是支持，而不是必须存在 [mvu_plot]
        _.remove(lore, entry => {
            const is_update_regex = UPDATE_REGEX.test(entry.comment);
            const is_plot_regex = PLOT_REGEX.test(entry.comment);
            if (is_update_regex || is_plot_regex) {
                supported_worlds.add(entry.world);
            }
            return store.runtimes.is_during_extra_analysis
                ? is_plot_regex && !is_update_regex
                : !is_plot_regex && is_update_regex;
        });
    };
    remove_and_check(lores.characterLore);
    //若要支持分步解析，角色世界书须是支持的。
    //全局世界书支持，角色世界书不支持，亦算作不支持。
    //在不支持的情况下，需要发送全局世界书等其他内容的所有条目。
    const is_extra_model_supported = await isExtraModelSupported();
    if (!is_extra_model_supported) {
        return;
    }
    remove_and_check(lores.globalLore);
    remove_and_check(lores.chatLore);
    remove_and_check(lores.personaLore);

    const process_unsupported_worlds = (lore: Record<string, any>[]) => {
        let removed_entries: Record<string, any>[] = [];
        if (store.runtimes.is_during_extra_analysis) {
            removed_entries = _.remove(lore, entry => !supported_worlds.has(entry.world));
        } else {
            //如果不在额外分析，则只进行整理
            removed_entries = _.filter(lore, entry => !supported_worlds.has(entry.world));
        }
        return removed_entries.map(entry => entry.world);
    };
    const removed_worlds = _(
        _.concat(
            process_unsupported_worlds(lores.globalLore),
            process_unsupported_worlds(lores.chatLore),
            process_unsupported_worlds(lores.personaLore)
        )
    )
        .sort()
        .sortedUniq()
        .value();

    store.runtimes.unsupported_warnings = Array.from(removed_worlds).join(', ');

    if (!store.runtimes.is_during_extra_analysis) {
        return;
    }

    const compile_filter_regex = (label: string, value: string) => {
        const result = compileEntryCommentRegex(value);
        if (result.error) {
            toastr.warning(
                `${label}无效，已在本轮世界书条目过滤中忽略：${result.error}`,
                '[MVU]世界书条目过滤正则无效',
                { timeOut: 5000 }
            );
        }
        return result.regex;
    };

    const white_regex = compile_filter_regex(
        '白名单正则',
        store.settings.额外模型解析配置.世界书条目白名单正则
    );
    const black_regex = compile_filter_regex(
        '黑名单正则',
        store.settings.额外模型解析配置.世界书条目黑名单正则
    );

    if (!white_regex && !black_regex) {
        return;
    }

    const filtered_entries: EntryCommentFilterResult[] = [];

    const get_comment_filter_reason = (entry: Record<string, any>) => {
        const comment = String(entry.comment ?? '');
        if (UPDATE_REGEX.test(comment)) {
            return undefined;
        }
        if (white_regex && !testEntryCommentRegex(white_regex, comment)) {
            return '白名单';
        }
        if (black_regex && testEntryCommentRegex(black_regex, comment)) {
            return '黑名单';
        }
        return undefined;
    };

    const apply_comment_regex_filter = (
        lore_name: EntryCommentFilterResult['lore'],
        lore: Record<string, any>[]
    ) => {
        _.remove(lore, entry => {
            const reason = get_comment_filter_reason(entry);
            if (!reason) {
                return false;
            }
            filtered_entries.push({
                lore: lore_name,
                world: String(entry.world ?? ''),
                comment: String(entry.comment ?? ''),
                reason,
            });
            return true;
        });
    };
    apply_comment_regex_filter('characterLore', lores.characterLore);
    apply_comment_regex_filter('globalLore', lores.globalLore);
    apply_comment_regex_filter('chatLore', lores.chatLore);
    apply_comment_regex_filter('personaLore', lores.personaLore);

    store.runtimes.上次世界书条目过滤结果 = filtered_entries;
    if (filtered_entries.length > 0) {
        logEntryCommentFilterResult(filtered_entries);
    }
}
