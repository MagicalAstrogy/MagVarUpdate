<template>
    <Detail :title="title">
        <dl class="mvu-character-override__metadata">
            <dt>{{ t('panel.character.character') }}</dt>
            <dd>
                {{ store.character_settings.character_name || t('panel.character.noCharacter') }}
            </dd>

            <dt>{{ t('panel.character.worldBook') }}</dt>
            <dd>{{ worldbook_label }}</dd>

            <dt>{{ t('panel.character.configEntry') }}</dt>
            <dd>{{ entry_label }}</dd>

            <dt>{{ t('panel.character.autoSave') }}</dt>
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
            <Field :label="t('panel.update.section')">
                <select v-model="update_method_model" class="text_pole">
                    <option :value="INHERIT">
                        {{
                            t('panel.character.inherit', {
                                value: format_update_method(store.settings.更新方式),
                            })
                        }}
                    </option>
                    <option value="随AI输出">{{ t('panel.update.method.aiOutput') }}</option>
                    <option value="额外模型解析">
                        {{ t('panel.update.method.extraModel') }}
                    </option>
                </select>
                <div class="mvu-character-override__values">
                    <span>
                        {{
                            t('panel.character.userConfig', {
                                value: format_update_method(store.settings.更新方式),
                            })
                        }}
                    </span>
                    <span>
                        {{
                            t('panel.character.effectiveConfig', {
                                value: format_update_method(store.effective_settings.更新方式),
                            })
                        }}
                    </span>
                </div>
            </Field>

            <div class="mvu-character-override__group">
                <strong class="mvu-character-override__group-title">
                    {{ t('panel.character.extraModelGroup') }}
                </strong>

                <Field :label="t('panel.character.autoRequest')">
                    <select v-model="auto_request_model" class="text_pole">
                        <option :value="INHERIT">
                            {{
                                t('panel.character.inherit', {
                                    value: format_boolean(
                                        store.settings.额外模型解析配置.启用自动请求
                                    ),
                                })
                            }}
                        </option>
                        <option value="true">{{ t('common.enabled') }}</option>
                        <option value="false">{{ t('common.disabled') }}</option>
                    </select>
                    <div class="mvu-character-override__values">
                        <span>
                            {{
                                t('panel.character.userConfig', {
                                    value: format_boolean(
                                        store.settings.额外模型解析配置.启用自动请求
                                    ),
                                })
                            }}
                        </span>
                        <span>
                            {{
                                t('panel.character.effectiveConfig', {
                                    value: format_boolean(
                                        store.effective_settings.额外模型解析配置.启用自动请求
                                    ),
                                })
                            }}
                        </span>
                    </div>
                </Field>

                <Field :label="t('panel.character.whitelist')">
                    <input
                        v-model="whitelist_model"
                        type="text"
                        class="text_pole"
                        :placeholder="t('panel.prompt.whitelistPlaceholder', { or: '|' })"
                    />
                    <div v-if="whitelist_regex_error" class="mvu-character-override__regex-error">
                        {{
                            t('panel.character.regexInvalid', {
                                error: whitelist_regex_error,
                            })
                        }}
                    </div>
                    <div class="mvu-character-override__values">
                        <span>
                            {{
                                t('panel.character.userRule', {
                                    value: format_rule(
                                        store.settings.额外模型解析配置.世界书条目白名单正则
                                    ),
                                })
                            }}
                        </span>
                        <span>{{ t('panel.character.whitelistEffective') }}</span>
                    </div>
                </Field>

                <Field :label="t('panel.character.blacklist')">
                    <input
                        v-model="blacklist_model"
                        type="text"
                        class="text_pole"
                        :placeholder="t('panel.prompt.blacklistPlaceholder', { or: '|' })"
                    />
                    <div v-if="blacklist_regex_error" class="mvu-character-override__regex-error">
                        {{
                            t('panel.character.regexInvalid', {
                                error: blacklist_regex_error,
                            })
                        }}
                    </div>
                    <div class="mvu-character-override__values">
                        <span>
                            {{
                                t('panel.character.userRule', {
                                    value: format_rule(
                                        store.settings.额外模型解析配置.世界书条目黑名单正则
                                    ),
                                })
                            }}
                        </span>
                        <span>{{ t('panel.character.blacklistEffective') }}</span>
                    </div>
                </Field>
            </div>

            <div class="mvu-character-override__group">
                <strong class="mvu-character-override__group-title">
                    {{ t('panel.compatibility.section') }}
                </strong>

                <Field :label="t('panel.compatibility.updateChatVariables')">
                    <select v-model="update_chat_variables_model" class="text_pole">
                        <option :value="INHERIT">
                            {{
                                t('panel.character.inherit', {
                                    value: format_boolean(store.settings.兼容性.更新到聊天变量),
                                })
                            }}
                        </option>
                        <option value="true">{{ t('common.enabled') }}</option>
                        <option value="false">{{ t('common.disabled') }}</option>
                    </select>
                    <div class="mvu-character-override__values">
                        <span>
                            {{
                                t('panel.character.userConfig', {
                                    value: format_boolean(store.settings.兼容性.更新到聊天变量),
                                })
                            }}
                        </span>
                        <span>
                            {{
                                t('panel.character.effectiveConfig', {
                                    value: format_boolean(
                                        store.effective_settings.兼容性.更新到聊天变量
                                    ),
                                })
                            }}
                        </span>
                    </div>
                </Field>

                <Field :label="t('panel.compatibility.sendasNotUser')">
                    <select v-model="sendas_not_user_model" class="text_pole">
                        <option :value="INHERIT">
                            {{
                                t('panel.character.inherit', {
                                    value: format_boolean(
                                        store.settings.兼容性.sendas不视为user消息
                                    ),
                                })
                            }}
                        </option>
                        <option value="true">{{ t('common.enabled') }}</option>
                        <option value="false">{{ t('common.disabled') }}</option>
                    </select>
                    <div class="mvu-character-override__values">
                        <span>
                            {{
                                t('panel.character.userConfig', {
                                    value: format_boolean(
                                        store.settings.兼容性.sendas不视为user消息
                                    ),
                                })
                            }}
                        </span>
                        <span>
                            {{
                                t('panel.character.effectiveConfig', {
                                    value: format_boolean(
                                        store.effective_settings.兼容性.sendas不视为user消息
                                    ),
                                })
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
import { useMvuI18n } from '@/i18n';
import Detail from '@/panel/component/Detail.vue';
import Field from '@/panel/component/Field.vue';
import { useDataStore } from '@/store';
import { computed } from 'vue';
import type { WritableComputedRef } from 'vue';

const INHERIT = '__inherit__';
const store = useDataStore();
const { t } = useMvuI18n();

const title = computed(() =>
    t(
        store.is_character_settings_override_active
            ? 'panel.character.titleActive'
            : 'panel.character.titleInactive'
    )
);

const is_editable = computed(
    () =>
        store.character_settings.status === 'ready' &&
        store.character_settings.worldbook_name !== null
);

const worldbook_label = computed(() => {
    if (store.character_settings.status === 'loading') {
        return t('panel.character.reading');
    }
    if (!store.character_settings.worldbook_name) {
        return t('panel.character.unbound');
    }
    return store.character_settings.worldbook_name;
});

const entry_label = computed(() => {
    if (store.character_settings.status === 'loading') {
        return t('panel.character.notRead');
    }
    if (
        store.character_settings.status === 'unbound' ||
        store.character_settings.status === 'error'
    ) {
        return t('common.unavailable');
    }
    if (store.character_settings.entry_uid === null) {
        return t('panel.character.notCreated');
    }
    return t('panel.character.entry', { uid: store.character_settings.entry_uid });
});

const save_status_label = computed(() => {
    if (store.character_settings.status === 'loading') {
        return t('panel.character.notRead');
    }
    if (
        store.character_settings.status === 'unbound' ||
        store.character_settings.status === 'error'
    ) {
        return t('common.unavailable');
    }
    if (store.character_settings.is_saving) {
        return t('panel.character.saving');
    }
    if (store.character_settings.has_pending_save) {
        return t('panel.character.pendingSave');
    }
    return t('panel.character.noPendingSave');
});

const status_message = computed(() => {
    switch (store.character_settings.status) {
        case 'loading':
            return t('panel.character.status.loading');
        case 'unbound':
            return t('panel.character.status.unbound');
        case 'error':
            return t('panel.character.status.error');
        case 'ready':
            if (!store.character_settings.is_valid) {
                return t('panel.character.status.invalid');
            }
            if (store.character_settings.entry_uid === null) {
                return t('panel.character.status.willCreate');
            }
            return t('panel.character.status.disabledStillActive');
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
    return value ? t('common.enabled') : t('common.disabled');
}

function format_update_method(value: '随AI输出' | '额外模型解析'): string {
    return value === '随AI输出'
        ? t('panel.update.method.aiOutput')
        : t('panel.update.method.extraModel');
}

function format_rule(value: string): string {
    return value.trim() === '' ? t('common.notSet') : value;
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
