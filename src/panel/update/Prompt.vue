<template>
    <Detail :title="t('panel.prompt.section')">
        <div class="mvu-note">{{ t('panel.prompt.apiOptionsMigrated') }}</div>

        <Field :label="t('panel.prompt.whitelist')">
            <template #label-suffix>
                <HelpIcon
                    :help="
                        t('panel.prompt.whitelistHelp', {
                            example: t('panel.prompt.whitelistPlaceholder', { or: '|' }),
                        })
                    "
                />
                <OverrideBadge v-if="has_active_character_whitelist" kind="additive" />
            </template>
            <input
                v-model="store.settings.额外模型解析配置.世界书条目白名单正则"
                type="text"
                class="text_pole"
                :placeholder="t('panel.prompt.whitelistPlaceholder', { or: '|' })"
            />
            <div v-if="whitelist_regex_error" class="mvu-regex-error">
                {{ whitelist_regex_error }}
            </div>
        </Field>

        <Field :label="t('panel.prompt.blacklist')">
            <template #label-suffix>
                <HelpIcon
                    :help="
                        t('panel.prompt.blacklistHelp', {
                            example: t('panel.prompt.blacklistPlaceholder', { or: '|' }),
                        })
                    "
                />
                <OverrideBadge v-if="has_active_character_blacklist" kind="additive" />
            </template>
            <input
                v-model="store.settings.额外模型解析配置.世界书条目黑名单正则"
                type="text"
                class="text_pole"
                :placeholder="t('panel.prompt.blacklistPlaceholder', { or: '|' })"
            />
            <div v-if="blacklist_regex_error" class="mvu-regex-error">
                {{ blacklist_regex_error }}
            </div>
        </Field>

        <div class="mvu-regex-actions">
            <input
                class="mvu-regex-actions__button menu_button menu_button_icon interactable"
                type="button"
                :value="t('panel.prompt.filtered.title')"
                @click="showLastFilteredEntriesPopup"
            />
        </div>
    </Detail>
</template>

<script setup lang="ts">
import { compileEntryCommentRegex } from '@/function/request/entry_comment_regex';
import { useMvuI18n } from '@/i18n';
import { useDataStore } from '@/store';
import { computed } from 'vue';
import Detail from '@/panel/component/Detail.vue';
import Field from '@/panel/component/Field.vue';
import OverrideBadge from '@/panel/component/OverrideBadge.vue';
import HelpIcon from '../component/HelpIcon.vue';

const store = useDataStore();
const { locale, t } = useMvuI18n();
function getRegexError(value: string) {
    const error = compileEntryCommentRegex(value).error;
    return error ? t('panel.prompt.regexInvalid', { error }) : '';
}

const whitelist_regex_error = computed(() =>
    getRegexError(store.settings.额外模型解析配置.世界书条目白名单正则)
);
const blacklist_regex_error = computed(() =>
    getRegexError(store.settings.额外模型解析配置.世界书条目黑名单正则)
);
const has_active_character_whitelist = computed(() => {
    const value = store.get_character_settings_override('额外模型解析配置.世界书条目白名单正则');
    return typeof value === 'string' && compileEntryCommentRegex(value).regex !== undefined;
});
const has_active_character_blacklist = computed(() => {
    const value = store.get_character_settings_override('额外模型解析配置.世界书条目黑名单正则');
    return typeof value === 'string' && compileEntryCommentRegex(value).regex !== undefined;
});

function showLastFilteredEntriesPopup() {
    const result = store.runtimes.上次世界书条目过滤结果;
    const content = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = t('panel.prompt.filtered.title');
    content.append(heading);

    if (result.length === 0) {
        const empty_message = document.createElement('p');
        empty_message.textContent = t('panel.prompt.filtered.empty');
        content.append(empty_message);
    } else {
        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';

        const header_row = document.createElement('tr');
        [
            t('panel.prompt.filtered.entrySource'),
            t('panel.prompt.filtered.worldBook'),
            t('panel.prompt.filtered.reason'),
            t('panel.prompt.filtered.configSource'),
            t('panel.prompt.filtered.comment'),
        ].forEach(label => appendTableCell(header_row, label, true));

        const table_head = document.createElement('thead');
        table_head.append(header_row);
        table.append(table_head);

        const table_body = document.createElement('tbody');
        result.forEach(entry => {
            const row = document.createElement('tr');
            appendTableCell(row, getLoreLabel(entry.lore));
            appendTableCell(row, entry.world);
            appendTableCell(row, getReasonLabel(entry.reason));
            appendTableCell(row, getFilterSources(entry));
            appendTableCell(row, entry.comment, false, true);
            table_body.append(row);
        });
        table.append(table_body);
        content.append(table);
    }

    SillyTavern.callGenericPopup(content.outerHTML, SillyTavern.POPUP_TYPE.TEXT, '', {
        allowVerticalScrolling: true,
        leftAlign: true,
        wide: true,
    });
}

function appendTableCell(
    row: HTMLTableRowElement,
    value: string,
    is_header = false,
    break_word = false
) {
    const cell = document.createElement(is_header ? 'th' : 'td');
    cell.textContent = value;
    cell.style.textAlign = 'left';
    cell.style.padding = '0.35rem';
    if (is_header) {
        cell.style.borderBottom = '1px solid currentColor';
    } else {
        cell.style.verticalAlign = 'top';
    }
    if (break_word) {
        cell.style.wordBreak = 'break-word';
    }
    row.append(cell);
}

function getLoreLabel(lore: string): string {
    const labels = {
        globalLore: t('panel.prompt.filtered.globalLore'),
        characterLore: t('panel.prompt.filtered.characterLore'),
        chatLore: t('panel.prompt.filtered.chatLore'),
        personaLore: t('panel.prompt.filtered.personaLore'),
    };
    return labels[lore as keyof typeof labels] ?? lore;
}

function getReasonLabel(reason: string): string {
    return reason === '白名单'
        ? t('panel.prompt.filtered.whitelistReason')
        : reason === '黑名单'
          ? t('panel.prompt.filtered.blacklistReason')
          : reason;
}

/** 将过滤条目的来源转换为本地化标签，并为缺失或无效来源显示占位符。 */
function getFilterSources(entry: unknown): string {
    const sources = _.get(entry, 'sources');
    if (!Array.isArray(sources)) {
        return '—';
    }
    const labels = sources
        .filter((source): source is string => typeof source === 'string')
        .map(source => {
            if (source === '用户全局配置') {
                return t('panel.prompt.filtered.globalConfig');
            }
            if (source === '角色卡配置') {
                return t('panel.prompt.filtered.characterConfig');
            }
            return source;
        });
    return labels.length > 0 ? labels.join(locale.value === 'zh-CN' ? '、' : ', ') : '—';
}
</script>

<style scoped>
.mvu-note {
    padding: 0 0.6rem 0.45rem;
    opacity: 0.8;
    font-size: calc(var(--mainFontSize, 1rem) * 0.9);
}

.mvu-regex-error {
    color: var(--SmartThemeQuoteColor, #ff6b6b);
    font-size: calc(var(--mainFontSize, 1rem) * 0.9);
    line-height: 1.35;
    word-break: break-word;
}

.mvu-regex-actions {
    display: flex;
    padding: 0 0.6rem 0.45rem;
}

.mvu-regex-actions__button {
    min-height: 2rem;
    white-space: normal;
}
</style>
