import { useSettingsStore, useTempContents } from '@/settings';
import { isFunctionCallingSupported } from '@/util';
import { isDuringExtraAnalysis } from '@/variable_def';

/**
 * 记录世界书是否支持额外模型
 */
let isExtraModelSupported = false;
const UPDATE_REGEX = /\[mvu_update\]/i;
const PLOT_REGEX = /\[mvu_plot\]/i;

export function getIsExtraModelSupported() {
    return isExtraModelSupported;
}

export function setIsExtraModelSupported(value: boolean) {
    isExtraModelSupported = value;
}

export async function handlePromptFilter(lores: {
    globalLore: Record<string, any>[];
    characterLore: Record<string, any>[];
    chatLore: Record<string, any>[];
    personaLore: Record<string, any>[];
}) {
    const settings = useSettingsStore().settings;
    const temp_contents = useTempContents().temp_contents;
    temp_contents.unsupported_warnings = '';

    //每次开始解析时都进行重置。
    isExtraModelSupported = false;

    //在这个回调中，会将所有lore的条目传入，此处可以去除所有 [mvu_update] 相关的条目，避免在非更新的轮次中输出相关内容。
    if (settings.更新方式 === '随AI输出') {
        return;
    }
    if (settings.额外模型解析配置.使用函数调用 && !isFunctionCallingSupported()) {
        toastr.warning(
            '当前预设/API 不支持函数调用，已退化回 `随AI输出`',
            '[MVU]无法使用函数调用',
            {
                timeOut: 2000,
            }
        );
        return;
    }

    const tagged_worlds = new Set<string>();
    const remove_and_check = (lore: Record<string, any>[]) => {
        // 规则应当为：存在任意一个 [mvu_plot]/[mvu_update] 即算是支持，而不是必须存在 [mvu_plot]
        let any_match = false;
        _.remove(lore, entry => {
            const is_update_regex = UPDATE_REGEX.test(entry.comment);
            const is_plot_regex = PLOT_REGEX.test(entry.comment);
            if (is_update_regex || is_plot_regex) {
                any_match = true;
                tagged_worlds.add(entry.world);
            }
            return isDuringExtraAnalysis()
                ? is_plot_regex && !is_update_regex
                : !is_plot_regex && is_update_regex;
        });
        if (any_match) {
            isExtraModelSupported = true;
        }
    };
    remove_and_check(lores.characterLore);
    //若要支持分步解析，角色世界书须是支持的。
    //全局世界书支持，角色世界书不支持，亦算作不支持。
    //在不支持的情况下，需要发送全局世界书等其他内容的所有条目。
    if (!isExtraModelSupported) return;
    remove_and_check(lores.globalLore);
    remove_and_check(lores.chatLore);
    remove_and_check(lores.personaLore);

    //先处理 remove_and_check 获取到明确的有效世界书列表，然后再筛选。
    // 只在额外分析时进行这个过滤
    if (isExtraModelSupported) {
        const supported_worlds = tagged_worlds;
        const process_unsupported_worlds = (lore: Record<string, any>[]) => {
            let removed_entries: Record<string, any>[] = [];
            if (isDuringExtraAnalysis()) {
                removed_entries = _.remove(lore, entry => !supported_worlds.has(entry.world));
            } else {
                //如果不在额外分析，则只进行整理
                removed_entries = _.filter(lore, entry => !supported_worlds.has(entry.world));
            }
            return _(removed_entries)
                .map(entry => entry.world)
                .uniq()
                .value();
        };
        const removed_worlds = _(
            _.concat(
                process_unsupported_worlds(lores.globalLore),
                process_unsupported_worlds(lores.chatLore),
                process_unsupported_worlds(lores.personaLore)
            )
        )
            .uniq()
            .value();

        temp_contents.unsupported_warnings = Array.from(removed_worlds).join(', ');
    }
}
