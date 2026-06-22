<template>
    <Detail title="请求策略">
        <Field label="请求方式">
            <template #label-suffix>
                <HelpIcon :help="request_method_help" />
            </template>
            <Select
                v-model="store.settings.额外模型解析配置.请求方式"
                :options="[
                    '依次请求，失败后重试',
                    '同时请求多次',
                    '先请求一次, 失败后再同时请求多次',
                ]"
            />
        </Field>

        <Field label="请求次数">
            <RangeNumber
                v-model="store.settings.额外模型解析配置.请求次数"
                :min="
                    store.settings.额外模型解析配置.请求方式 === '先请求一次, 失败后再同时请求多次'
                        ? 2
                        : 1
                "
                :max="10"
                :step="1"
            />
        </Field>

        <Field label="自动请求">
            <template #label-suffix>
                <HelpIcon
                    help="如果关闭, 当 AI 回复完成时将不再自动触发额外模型解析, 而是需要你主动点击`重试额外模型解析`按钮才会进行解析工作并添加状态栏占位符 `<StatusPlaceHolderImpl/>`"
                />
            </template>
            <Checkbox v-model="store.settings.额外模型解析配置.启用自动请求">
                <span>启用</span>
            </Checkbox>
        </Field>

        <Field label="世界书条目白名单正则">
            <template #label-suffix>
                <HelpIcon
                    help="留空关闭；非空时，额外模型解析阶段只保留 comment 匹配该正则的世界书条目。支持 角色|地点 或 /角色|地点/i。"
                />
            </template>
            <input
                v-model="store.settings.额外模型解析配置.世界书条目白名单正则"
                type="text"
                class="text_pole"
                placeholder="角色|地点 或 /角色|地点/i"
            />
            <div v-if="whitelist_regex_error" class="mvu-regex-error">
                {{ whitelist_regex_error }}
            </div>
        </Field>

        <Field label="世界书条目黑名单正则">
            <template #label-suffix>
                <HelpIcon
                    help="留空关闭；非空时，额外模型解析阶段会排除 comment 匹配该正则的世界书条目。支持 临时|禁用 或 /临时|禁用/i。"
                />
            </template>
            <input
                v-model="store.settings.额外模型解析配置.世界书条目黑名单正则"
                type="text"
                class="text_pole"
                placeholder="临时|禁用 或 /临时|禁用/i"
            />
            <div v-if="blacklist_regex_error" class="mvu-regex-error">
                {{ blacklist_regex_error }}
            </div>
        </Field>

        <div class="mvu-regex-actions">
            <input
                class="mvu-regex-actions__button menu_button menu_button_icon interactable"
                type="button"
                value="查看上次分析被筛选的条目"
                @click="showLastFilteredEntriesPopup"
            />
        </div>
    </Detail>
</template>

<script setup lang="ts">
import { compileEntryCommentRegex } from '@/function/request/entry_comment_regex';
import Checkbox from '@/panel/component/Checkbox.vue';
import Detail from '@/panel/component/Detail.vue';
import Field from '@/panel/component/Field.vue';
import HelpIcon from '@/panel/component/HelpIcon.vue';
import RangeNumber from '@/panel/component/RangeNumber.vue';
import Select from '@/panel/component/Select.vue';
import request_method_help from '@/panel/update/request_method.md';
import { useDataStore } from '@/store';
import { compare } from 'compare-versions';
import { computed, watch } from 'vue';

const store = useDataStore();

function getRegexError(value: string) {
    const error = compileEntryCommentRegex(value).error;
    return error ? `正则无效：${error}` : '';
}

const whitelist_regex_error = computed(() =>
    getRegexError(store.settings.额外模型解析配置.世界书条目白名单正则)
);
const blacklist_regex_error = computed(() =>
    getRegexError(store.settings.额外模型解析配置.世界书条目黑名单正则)
);

function showLastFilteredEntriesPopup() {
    const result = store.runtimes.上次世界书条目过滤结果;
    const content =
        result.length === 0
            ? '<div><h3>上次分析被筛选的条目</h3><p>上次分析没有被黑/白名单筛选掉的条目。</p></div>'
            : `
                <div>
                    <h3>上次分析被筛选的条目</h3>
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr>
                                <th style="text-align: left; border-bottom: 1px solid currentColor; padding: 0.35rem;">来源</th>
                                <th style="text-align: left; border-bottom: 1px solid currentColor; padding: 0.35rem;">世界书</th>
                                <th style="text-align: left; border-bottom: 1px solid currentColor; padding: 0.35rem;">原因</th>
                                <th style="text-align: left; border-bottom: 1px solid currentColor; padding: 0.35rem;">comment</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${result
                                .map(
                                    entry => `
                                        <tr>
                                            <td style="vertical-align: top; padding: 0.35rem;">${_.escape(entry.lore)}</td>
                                            <td style="vertical-align: top; padding: 0.35rem;">${_.escape(entry.world)}</td>
                                            <td style="vertical-align: top; padding: 0.35rem;">${_.escape(entry.reason)}</td>
                                            <td style="vertical-align: top; padding: 0.35rem; word-break: break-word;">${_.escape(entry.comment)}</td>
                                        </tr>
                                    `
                                )
                                .join('')}
                        </tbody>
                    </table>
                </div>
            `;

    SillyTavern.callGenericPopup(content, SillyTavern.POPUP_TYPE.TEXT, '', {
        allowVerticalScrolling: true,
        leftAlign: true,
        wide: true,
    });
}

watch(
    () => store.settings.额外模型解析配置.请求方式,
    value => {
        if (
            value !== '依次请求，失败后重试' &&
            compare(store.versions.tavernhelper, '4.4.3', '<')
        ) {
            toastr.warning(
                '请升级酒馆助手到 4.4.3 或更高版本，否则批量请求功能可能让预设的「流式传输」设置失效',
                '[MVU]批量请求可能有问题',
                {
                    timeOut: 5000,
                }
            );
        }
    }
);
</script>

<style scoped>
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
