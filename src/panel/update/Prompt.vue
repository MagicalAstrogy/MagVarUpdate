<template>
    <Detail title="请求内容">
        <Field label="破限方案">
            <template #label-suffix>
                <HelpIcon :help="prompt_break_help" />
            </template>
            <Select
                v-model="store.settings.额外模型解析配置.破限方案"
                :options="['使用内置破限', '使用当前预设', '使用其他预设']"
            />
        </Field>

        <Field v-if="store.settings.额外模型解析配置.破限方案 === '使用其他预设'" label="目标预设">
            <Select
                v-if="available_preset_names.length > 0"
                v-model="store.settings.额外模型解析配置.其他预设名称"
                :options="available_preset_names"
            />
            <input v-else class="text_pole" type="text" disabled value="未检测到可用的已保存预设" />
        </Field>

        <Field v-if="store.settings.额外模型解析配置.破限方案 === '使用内置破限'" label="随机头部">
            <template #label-suffix>
                <HelpIcon
                    help="gemini系模型会对破限头部进行记录，因此需要在头部增加随机数。如果您使用的不是Gemini系模型，请关闭这个功能，避免缓存失效。"
                />
            </template>
            <Checkbox v-model="store.settings.额外模型解析配置.随机头部">
                <span>随机头部</span>
            </Checkbox>
        </Field>

        <Field label="应答格式">
            <template #label-suffix>
                <HelpIcon :help="prompt_toolcall_help" />
            </template>
            <Select
                v-model="store.settings.额外模型解析配置.应答格式"
                :options="response_format_options"
            />
        </Field>

        <Field
            v-if="store.settings.额外模型解析配置.应答格式 === '格式化输出(v4兼容)'"
            label="关闭thinking"
        >
            <template #label-suffix>
                <HelpIcon help="关闭后会避免一部分空回状况。" />
            </template>
            <Checkbox v-model="store.settings.额外模型解析配置.关闭thinking">
                <span>关闭</span>
            </Checkbox>
        </Field>

        <Field label="兼容假流式">
            <template #label-suffix>
                <HelpIcon
                    help="勾选后, 额外模型解析将会要求 AI 流式传输, 从而兼容一些需要假流式来保活的渠道模型"
                />
            </template>
            <Checkbox v-model="store.settings.额外模型解析配置.兼容假流式">
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
import { getFunctionCallingApiVersionUnsupportedMessage } from '@/function/is_function_calling_supported';
import { getAvailableExtraModelPresetNames } from '@/function/update/extra_model_preset';
import Checkbox from '@/panel/component/Checkbox.vue';
import Detail from '@/panel/component/Detail.vue';
import Field from '@/panel/component/Field.vue';
import Select from '@/panel/component/Select.vue';
import prompt_break_help from '@/panel/update/prompt_break.md';
import prompt_toolcall_help from '@/panel/update/prompt_toolcall.md';
import { EXTRA_MODEL_RESPONSE_FORMATS, useDataStore } from '@/store';
import { computed, watch } from 'vue';
import HelpIcon from '../component/HelpIcon.vue';

const store = useDataStore();
const available_preset_names = computed(() => getAvailableExtraModelPresetNames());
const response_format_options = [...EXTRA_MODEL_RESPONSE_FORMATS];

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

function ensureValidPresetSelection() {
    if (store.settings.额外模型解析配置.破限方案 !== '使用其他预设') {
        return;
    }

    if (available_preset_names.value.length === 0) {
        store.settings.额外模型解析配置.其他预设名称 = '';
        return;
    }

    if (!available_preset_names.value.includes(store.settings.额外模型解析配置.其他预设名称)) {
        [store.settings.额外模型解析配置.其他预设名称] = available_preset_names.value;
    }
}

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

watch(available_preset_names, ensureValidPresetSelection, { immediate: true });
watch(
    () => store.settings.额外模型解析配置.破限方案,
    () => ensureValidPresetSelection(),
    { immediate: true }
);

watch(
    () =>
        [
            store.settings.额外模型解析配置.应答格式,
            store.settings.额外模型解析配置.模型来源,
        ] as const,
    ([value, model_source]) => {
        if (value === '工具调用') {
            const version_message = getFunctionCallingApiVersionUnsupportedMessage();
            if (version_message) {
                toastr.error(version_message, "[MVU]无法使用'工具调用'", {
                    timeOut: 5000,
                });
                store.settings.额外模型解析配置.应答格式 = '聊天消息';
                return;
            }
            if (!SillyTavern.ToolManager.isToolCallingSupported()) {
                toastr.error(
                    '当前 API 源不支持工具调用，请换用支持 tools 的渠道模型或改用其他应答格式',
                    "[MVU]无法使用'工具调用'",
                    {
                        timeOut: 5000,
                    }
                );
                store.settings.额外模型解析配置.应答格式 = '聊天消息';
                return;
            }
        }
        if (value === '格式化输出(v4兼容)' && model_source === '与插头相同') {
            toastr.error(
                '格式化输出(v4兼容)需要额外模型来源为自定义，不能与插头相同',
                "[MVU]无法使用'格式化输出(v4兼容)'",
                {
                    timeOut: 5000,
                }
            );
            store.settings.额外模型解析配置.应答格式 = '聊天消息';
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
