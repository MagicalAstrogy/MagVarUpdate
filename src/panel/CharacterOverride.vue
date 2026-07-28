<template>
    <Detail :title="title">
        <dl class="mvu-character-override__metadata">
            <dt>角色</dt>
            <dd>{{ store.character_settings.character_name || '未检测到当前角色' }}</dd>

            <dt>角色世界书</dt>
            <dd>{{ worldbook_label }}</dd>

            <dt>配置条目</dt>
            <dd>{{ entry_label }}</dd>

            <dt>自动保存</dt>
            <dd aria-live="polite">{{ save_status_label }}</dd>
        </dl>

        <div
            v-if="status_message"
            class="mvu-character-override__notice"
            :class="{
                'mvu-character-override__notice--warning':
                    store.character_settings.status === 'error' ||
                    (store.character_settings.status === 'ready' &&
                        !store.character_settings.is_valid),
            }"
        >
            {{ status_message }}
        </div>

        <fieldset class="mvu-character-override__fieldset" :disabled="!is_editable">
            <Field label="更新方式">
                <select v-model="update_method_model" class="text_pole">
                    <option :value="INHERIT">
                        跟随用户配置（当前：{{ store.settings.更新方式 }}）
                    </option>
                    <option value="随AI输出">随AI输出</option>
                    <option value="额外模型解析">额外模型解析</option>
                </select>
                <div class="mvu-character-override__values">
                    <span>用户配置：{{ store.settings.更新方式 }}</span>
                    <span>当前生效：{{ store.effective_settings.更新方式 }}</span>
                </div>
            </Field>

            <div class="mvu-character-override__group">
                <strong class="mvu-character-override__group-title">额外模型解析</strong>

                <Field label="自动请求">
                    <select v-model="auto_request_model" class="text_pole">
                        <option :value="INHERIT">
                            跟随用户配置（当前：{{
                                format_boolean(store.settings.额外模型解析配置.启用自动请求)
                            }}）
                        </option>
                        <option value="true">开启</option>
                        <option value="false">关闭</option>
                    </select>
                    <div class="mvu-character-override__values">
                        <span>
                            用户配置：{{
                                format_boolean(store.settings.额外模型解析配置.启用自动请求)
                            }}
                        </span>
                        <span>
                            当前生效：{{
                                format_boolean(
                                    store.effective_settings.额外模型解析配置.启用自动请求
                                )
                            }}
                        </span>
                    </div>
                </Field>

                <Field label="角色卡世界书条目白名单正则">
                    <input
                        v-model="whitelist_model"
                        type="text"
                        class="text_pole"
                        placeholder="角色|地点 或 /角色|地点/i"
                    />
                    <div v-if="whitelist_regex_error" class="mvu-character-override__regex-error">
                        角色卡配置正则无效：{{ whitelist_regex_error }}
                    </div>
                    <div class="mvu-character-override__values">
                        <span>
                            用户规则：{{
                                format_rule(store.settings.额外模型解析配置.世界书条目白名单正则)
                            }}
                        </span>
                        <span>生效规则：用户白名单 OR 角色卡白名单</span>
                    </div>
                </Field>

                <Field label="角色卡世界书条目黑名单正则">
                    <input
                        v-model="blacklist_model"
                        type="text"
                        class="text_pole"
                        placeholder="临时|禁用 或 /临时|禁用/i"
                    />
                    <div v-if="blacklist_regex_error" class="mvu-character-override__regex-error">
                        角色卡配置正则无效：{{ blacklist_regex_error }}
                    </div>
                    <div class="mvu-character-override__values">
                        <span>
                            用户规则：{{
                                format_rule(store.settings.额外模型解析配置.世界书条目黑名单正则)
                            }}
                        </span>
                        <span>生效规则：用户黑名单 OR 角色卡黑名单</span>
                    </div>
                </Field>
            </div>

            <div class="mvu-character-override__group">
                <strong class="mvu-character-override__group-title">兼容性</strong>

                <Field label="变量更新到聊天变量">
                    <select v-model="update_chat_variables_model" class="text_pole">
                        <option :value="INHERIT">
                            跟随用户配置（当前：{{
                                format_boolean(store.settings.兼容性.更新到聊天变量)
                            }}）
                        </option>
                        <option value="true">开启</option>
                        <option value="false">关闭</option>
                    </select>
                    <div class="mvu-character-override__values">
                        <span>
                            用户配置：{{ format_boolean(store.settings.兼容性.更新到聊天变量) }}
                        </span>
                        <span>
                            当前生效：{{
                                format_boolean(store.effective_settings.兼容性.更新到聊天变量)
                            }}
                        </span>
                    </div>
                </Field>

                <Field label="sendas 不视为 user 消息">
                    <select v-model="sendas_not_user_model" class="text_pole">
                        <option :value="INHERIT">
                            跟随用户配置（当前：{{
                                format_boolean(store.settings.兼容性.sendas不视为user消息)
                            }}）
                        </option>
                        <option value="true">开启</option>
                        <option value="false">关闭</option>
                    </select>
                    <div class="mvu-character-override__values">
                        <span>
                            用户配置：{{
                                format_boolean(store.settings.兼容性.sendas不视为user消息)
                            }}
                        </span>
                        <span>
                            当前生效：{{
                                format_boolean(store.effective_settings.兼容性.sendas不视为user消息)
                            }}
                        </span>
                    </div>
                </Field>
            </div>
        </fieldset>
    </Detail>
</template>

<script setup lang="ts">
import { setCharacterSettingsOverride } from '@/function/character_override';
import type { CharacterSettingsOverridePath } from '@/function/character_override/schema';
import { compileEntryCommentRegex } from '@/function/request/entry_comment_regex';
import Detail from '@/panel/component/Detail.vue';
import Field from '@/panel/component/Field.vue';
import { useDataStore } from '@/store';
import { computed } from 'vue';
import type { WritableComputedRef } from 'vue';

const INHERIT = '__inherit__';
const store = useDataStore();

const title = computed(
    () => `当前角色卡配置（${store.is_character_settings_override_active ? '覆盖中' : '未启用'}）`
);

const is_editable = computed(
    () =>
        store.character_settings.status === 'ready' &&
        store.character_settings.worldbook_name !== null
);

const worldbook_label = computed(() => {
    if (store.character_settings.status === 'loading') {
        return '正在读取…';
    }
    if (!store.character_settings.worldbook_name) {
        return '未绑定';
    }
    return store.character_settings.worldbook_name;
});

const entry_label = computed(() => {
    if (store.character_settings.status === 'loading') {
        return '尚未读取';
    }
    if (
        store.character_settings.status === 'unbound' ||
        store.character_settings.status === 'error'
    ) {
        return '不可用';
    }
    if (store.character_settings.entry_uid === null) {
        return '尚未创建';
    }
    return `[config_override]（UID ${store.character_settings.entry_uid}，关闭）`;
});

const save_status_label = computed(() => {
    if (store.character_settings.status === 'loading') {
        return '尚未读取';
    }
    if (
        store.character_settings.status === 'unbound' ||
        store.character_settings.status === 'error'
    ) {
        return '不可用';
    }
    if (store.character_settings.is_saving) {
        return '正在保存…';
    }
    if (store.character_settings.has_pending_save) {
        return '等待自动保存';
    }
    return '无待保存修改';
});

const status_message = computed(() => {
    switch (store.character_settings.status) {
        case 'loading':
            return '正在读取当前角色卡绑定的世界书。';
        case 'unbound':
            return '当前角色卡未绑定角色世界书，角色卡配置不可用。';
        case 'error':
            return '角色世界书读取失败，暂时无法编辑角色卡配置。';
        case 'ready':
            if (!store.character_settings.is_valid) {
                return '现有 [config_override] 配置无效，修改任一配置后将自动保存以修复该条目。';
            }
            if (store.character_settings.entry_uid === null) {
                return '修改配置时将自动创建关闭的 [config_override] 条目。';
            }
            return 'MVU 会主动读取这个关闭的 [config_override] 条目；关闭状态不会使配置失效。';
    }
    return '';
});

const update_method_model = computed<string>({
    get: () => {
        const value = store.get_character_settings_override('更新方式');
        return value === '随AI输出' || value === '额外模型解析' ? value : INHERIT;
    },
    set: value => {
        setCharacterSettingsOverride(
            '更新方式',
            value === '随AI输出' || value === '额外模型解析' ? value : undefined
        );
    },
});

function make_boolean_model(path: CharacterSettingsOverridePath): WritableComputedRef<string> {
    return computed<string>({
        get: () => {
            const value = store.get_character_settings_override(path);
            return typeof value === 'boolean' ? String(value) : INHERIT;
        },
        set: value => {
            setCharacterSettingsOverride(path, value === INHERIT ? undefined : value === 'true');
        },
    });
}

function make_regex_model(path: CharacterSettingsOverridePath): WritableComputedRef<string> {
    return computed<string>({
        get: () => {
            const value = store.get_character_settings_override(path);
            return typeof value === 'string' ? value : '';
        },
        set: value => setCharacterSettingsOverride(path, value),
    });
}

const auto_request_model = make_boolean_model('额外模型解析配置.启用自动请求');
const update_chat_variables_model = make_boolean_model('兼容性.更新到聊天变量');
const sendas_not_user_model = make_boolean_model('兼容性.sendas不视为user消息');
const whitelist_model = make_regex_model('额外模型解析配置.世界书条目白名单正则');
const blacklist_model = make_regex_model('额外模型解析配置.世界书条目黑名单正则');

const whitelist_regex_error = computed(
    () => compileEntryCommentRegex(whitelist_model.value).error ?? ''
);
const blacklist_regex_error = computed(
    () => compileEntryCommentRegex(blacklist_model.value).error ?? ''
);

function format_boolean(value: boolean): string {
    return value ? '开启' : '关闭';
}

function format_rule(value: string): string {
    return value.trim() === '' ? '未设置' : value;
}
</script>

<style scoped>
.mvu-character-override__metadata {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.25rem 0.7rem;
    margin: 0;
    padding: 0.35rem 0.55rem;
    border-radius: 8px;
    background-color: rgba(0, 0, 0, 0.08);
}

.mvu-character-override__metadata dt {
    font-weight: 600;
    opacity: 0.82;
}

.mvu-character-override__metadata dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
}

.mvu-character-override__notice {
    padding: 0.45rem 0.6rem;
    border: 1px solid color-mix(in srgb, var(--SmartThemeQuoteColor, #6ba7ff) 35%, transparent);
    border-radius: 8px;
    background-color: color-mix(in srgb, var(--SmartThemeQuoteColor, #6ba7ff) 10%, transparent);
    overflow-wrap: anywhere;
}

.mvu-character-override__notice--warning {
    border-color: color-mix(in srgb, var(--SmartThemeEmColor, #d39e00) 40%, transparent);
    background-color: color-mix(in srgb, var(--SmartThemeEmColor, #d39e00) 12%, transparent);
}

.mvu-character-override__fieldset {
    min-inline-size: 0;
    margin: 0;
    padding: 0;
    border: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
}

.mvu-character-override__fieldset:disabled {
    opacity: 0.6;
}

.mvu-character-override__group {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding-top: 0.1rem;
}

.mvu-character-override__group-title {
    padding: 0 0.15rem;
}

.mvu-character-override__values {
    display: flex;
    flex-wrap: wrap;
    gap: 0.15rem 0.75rem;
    font-size: calc(var(--mainFontSize, 1rem) * 0.86);
    line-height: 1.35;
    opacity: 0.82;
    overflow-wrap: anywhere;
}

.mvu-character-override__regex-error {
    color: var(--SmartThemeQuoteColor, #ff6b6b);
    font-size: calc(var(--mainFontSize, 1rem) * 0.9);
    line-height: 1.35;
    overflow-wrap: anywhere;
}
</style>
