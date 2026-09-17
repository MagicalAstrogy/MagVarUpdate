import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { isFunctionCallingSupported } from '@/function/is_function_calling_supported';
import {
    compileEntryCommentRegex,
    EntryCommentFilterResult,
    EntryCommentFilterSource,
    logEntryCommentFilterResult,
    testEntryCommentRegex,
} from '@/function/request/entry_comment_regex';
import { tr } from '@/i18n';
import { useDataStore, type MvuSettings } from '@/store';
import { PLOT_REGEX, UPDATE_REGEX } from '@/variable_def';

/** 将规则来源转换为提示和日志中显示的本地化名称。 */
function getFilterSourceLabel(source: EntryCommentFilterSource): string {
    return tr(
        source === '用户全局配置'
            ? 'runtime.filter.globalSettingsSource'
            : 'runtime.filter.characterSettingsSource'
    );
}

/** 将黑白名单类型转换为正则错误提示中的本地化名称。 */
function getFilterRegexLabel(label: '白名单正则' | '黑名单正则'): string {
    return tr(
        label === '白名单正则'
            ? 'runtime.filter.whitelistRegexLabel'
            : 'runtime.filter.blacklistRegexLabel'
    );
}

/** 按宿主来源分组的原始条目，也可用于保存仅含 world、uid、comment 的过滤快照。 */
export type LoreEntries = {
    globalLore: Record<string, any>[];
    characterLore: Record<string, any>[];
    chatLore: Record<string, any>[];
    personaLore: Record<string, any>[];
};

/** 只含可克隆数据，随单次请求/扫描保存，避免异步期间读取另一请求的全局状态。 */
export type EntryFilterContext = {
    update_method: MvuSettings['更新方式'];
    is_extra_analysis: boolean;
    tool_calling_unsupported: boolean;
    extra_model_supported: boolean;
    whitelist: string;
    blacklist: string;
    character_whitelist: string;
    character_blacklist: string;
};

/**
 * 保存一次过滤所需的配置和能力判断，避免异步扫描期间混用其他请求的状态。
 *
 * 更新方式、阶段和正则在首次等待之前复制；需要筛选时再异步查询角色主世界书的支持情况。
 * 返回值仅含可克隆数据，可以随元数据探针进入宿主的 structuredClone 流程。
 *
 * @param is_extra_analysis 是否按额外分析规则筛选，默认取调用时的全局阶段。
 * @param request_settings 本次请求的额外模型配置，默认取调用时的面板配置。
 * @returns 包含配置与所需能力判断的独立过滤快照。
 */
export async function createEntryFilterContext(
    is_extra_analysis = useDataStore().runtimes.is_during_extra_analysis,
    request_settings = useDataStore().settings.额外模型解析配置
): Promise<EntryFilterContext> {
    const store = useDataStore();
    const character_settings = store.character_settings.is_valid
        ? store.character_settings.draft.额外模型解析配置
        : undefined;
    const context: EntryFilterContext = {
        update_method: store.effective_settings.更新方式,
        is_extra_analysis,
        tool_calling_unsupported:
            request_settings.应答格式 === '工具调用' &&
            request_settings.模型来源 !== '更多' &&
            !isFunctionCallingSupported(),
        extra_model_supported: false,
        whitelist: request_settings.世界书条目白名单正则,
        blacklist: request_settings.世界书条目黑名单正则,
        character_whitelist: character_settings?.世界书条目白名单正则 ?? '',
        character_blacklist: character_settings?.世界书条目黑名单正则 ?? '',
    };
    if (context.update_method !== '随AI输出' && !context.tool_calling_unsupported) {
        context.extra_model_supported = await isExtraModelSupported();
    }
    return context;
}

/**
 * 按过滤快照执行阶段标签、整本支持情况和标题黑白名单筛选。
 *
 * 原地删除四组数组中的条目，并更新最近过滤结果与提示信息。
 * 既可用于扫描前的原始条目，也可用于扫描后的元数据快照以计算删除集合。
 *
 * @param lores 待筛选的四组条目数组。
 * @param context 已保存的请求策略；未提供时即时创建，兼容原有调用方式。
 */
export async function filterEntries(lores: LoreEntries, context?: EntryFilterContext) {
    const store = useDataStore();
    const filter_context = context ?? (await createEntryFilterContext());
    store.runtimes.unsupported_warnings = '';
    if (filter_context.is_extra_analysis) {
        store.runtimes.上次世界书条目过滤结果 = [];
    }

    //在这个回调中，会将所有lore的条目传入，此处可以去除所有 [mvu_update] 相关的条目，避免在非更新的轮次中输出相关内容。
    if (filter_context.update_method === '随AI输出') {
        return;
    }
    if (filter_context.tool_calling_unsupported) {
        toastr.warning(
            tr('runtime.filter.toolCallingUnsupported'),
            tr('runtime.filter.toolCallingUnsupportedTitle'),
            {
                timeOut: 2000,
            }
        );
        return;
    }

    const supported_worlds = new Set<string>();
    /** 同时收集支持 MVU 的世界书，并按正文生成或额外分析阶段排除相应标签条目。 */
    const remove_and_check = (lore: Record<string, any>[]) => {
        // 规则应当为：存在任意一个 [mvu_plot]/[mvu_update] 即算是支持，而不是必须存在 [mvu_plot]
        _.remove(lore, entry => {
            const is_update_regex = UPDATE_REGEX.test(entry.comment);
            const is_plot_regex = PLOT_REGEX.test(entry.comment);
            if (is_update_regex || is_plot_regex) {
                supported_worlds.add(entry.world);
            }
            return filter_context.is_extra_analysis
                ? is_plot_regex && !is_update_regex
                : !is_plot_regex && is_update_regex;
        });
    };
    remove_and_check(lores.characterLore);
    //若要支持分步解析，角色世界书须是支持的。
    //全局世界书支持，角色世界书不支持，亦算作不支持。
    //在不支持的情况下，需要发送全局世界书等其他内容的所有条目。
    if (!filter_context.extra_model_supported) {
        return;
    }
    remove_and_check(lores.globalLore);
    remove_and_check(lores.chatLore);
    remove_and_check(lores.personaLore);

    /** 额外分析时移除不支持的附加世界书；普通生成仅收集名称用于提示。 */
    const process_unsupported_worlds = (lore: Record<string, any>[]) => {
        let removed_entries: Record<string, any>[] = [];
        if (filter_context.is_extra_analysis) {
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

    if (!filter_context.is_extra_analysis) {
        return;
    }

    /** 编译单个来源的正则；无效配置只提示并忽略，不阻断其他有效规则。 */
    const compile_filter_regex = (
        label: '白名单正则' | '黑名单正则',
        source: EntryCommentFilterSource,
        value: string
    ) => {
        const result = compileEntryCommentRegex(value);
        if (result.error) {
            toastr.warning(
                tr('runtime.filter.invalidRegex', {
                    source: getFilterSourceLabel(source),
                    label: getFilterRegexLabel(label),
                    cause: _.escape(result.error),
                }),
                tr('runtime.filter.invalidRegexTitle'),
                { timeOut: 5000 }
            );
        }
        return result.regex ? { regex: result.regex, source } : undefined;
    };

    // 白名单任一来源命中即可保留，角色卡规则不会抹掉用户的全局规则；
    // 黑名单则是任一来源命中即过滤。
    const white_regexes = [
        compile_filter_regex('白名单正则', '用户全局配置', filter_context.whitelist),
        compile_filter_regex('白名单正则', '角色卡配置', filter_context.character_whitelist),
    ].filter(value => value !== undefined);
    const black_regexes = [
        compile_filter_regex('黑名单正则', '用户全局配置', filter_context.blacklist),
        compile_filter_regex('黑名单正则', '角色卡配置', filter_context.character_blacklist),
    ].filter(value => value !== undefined);

    if (white_regexes.length === 0 && black_regexes.length === 0) {
        return;
    }

    const filtered_entries: EntryCommentFilterResult[] = [];

    /** 判断标题是否被黑白名单排除；更新标签始终豁免，并记录实际命中的规则来源。 */
    const get_comment_filter_reason = (
        entry: Record<string, any>
    ): Pick<EntryCommentFilterResult, 'reason' | 'sources'> | undefined => {
        const comment = String(entry.comment ?? '');
        if (UPDATE_REGEX.test(comment)) {
            return undefined;
        }
        if (
            white_regexes.length > 0 &&
            !white_regexes.some(({ regex }) => testEntryCommentRegex(regex, comment))
        ) {
            return {
                reason: '白名单',
                sources: white_regexes.map(({ source }) => source),
            };
        }
        const matched_blacklist_sources = black_regexes
            .filter(({ regex }) => testEntryCommentRegex(regex, comment))
            .map(({ source }) => source);
        if (matched_blacklist_sources.length > 0) {
            return {
                reason: '黑名单',
                sources: matched_blacklist_sources,
            };
        }
        return undefined;
    };

    /** 对一个来源的条目原地执行标题筛选，并累积供面板与日志展示的过滤原因。 */
    const apply_comment_regex_filter = (
        lore_name: EntryCommentFilterResult['lore'],
        lore: Record<string, any>[]
    ) => {
        _.remove(lore, entry => {
            const filter_result = get_comment_filter_reason(entry);
            if (!filter_result) {
                return false;
            }
            filtered_entries.push({
                lore: lore_name,
                world: String(entry.world ?? ''),
                comment: String(entry.comment ?? ''),
                ...filter_result,
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
