<template>
    <Section :label="t('panel.compatibility.section')">
        <template #content>
            <Checkbox v-model="store.settings.兼容性.更新到聊天变量">
                <span>{{ t('panel.compatibility.updateChatVariables') }}</span>
                <HelpIcon :help="t('panel.compatibility.updateChatVariablesHelp')" />
                <OverrideBadge
                    v-if="store.has_character_settings_override('兼容性.更新到聊天变量')"
                    :value="update_chat_variables_override_label"
                />
            </Checkbox>

            <Checkbox v-model="store.settings.兼容性.显示老旧功能">
                <span>{{ t('panel.compatibility.showLegacy') }}</span>
            </Checkbox>

            <Checkbox v-model="store.settings.兼容性.sendas不视为user消息">
                <span>{{ t('panel.compatibility.sendasNotUser') }}</span>
                <HelpIcon :help="sandas_message_help" />
                <OverrideBadge
                    v-if="store.has_character_settings_override('兼容性.sendas不视为user消息')"
                    :value="sendas_not_user_override_label"
                />
            </Checkbox>

            <Detail :title="t('panel.compatibility.license')">
                <template #title-suffix>
                    <HelpIcon :help="license_help" />
                </template>
                <div class="mvu-license-table-wrap">
                    <table class="mvu-license-table">
                        <thead>
                            <tr>
                                <th scope="col">
                                    {{ t('panel.compatibility.licenseComponent') }}
                                </th>
                                <th scope="col">
                                    {{ t('panel.compatibility.licenseIdentifier') }}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="component in OPEN_SOURCE_LICENSES"
                                :key="component.packageName"
                            >
                                <td>
                                    <a
                                        :href="component.projectUrl"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        {{ component.displayName ?? component.packageName }}
                                    </a>
                                </td>
                                <td>{{ component.license }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </Detail>
        </template>
    </Section>
</template>

<script setup lang="ts">
import Checkbox from '@/panel/component/Checkbox.vue';
import Detail from '@/panel/component/Detail.vue';
import { useMvuI18n } from '@/i18n';
import HelpIcon from '@/panel/component/HelpIcon.vue';
import OverrideBadge from '@/panel/component/OverrideBadge.vue';
import { OPEN_SOURCE_LICENSES } from '@/panel/open_source_licenses';
import Section from '@/panel/component/Section.vue';
import sandas_message_help_en from '@/panel/compatibility_sandas_message.en.md';
import sandas_message_help_zh_cn from '@/panel/compatibility_sandas_message.zh-CN.md';
import { useDataStore } from '@/store';
import { computed } from 'vue';

const store = useDataStore();
const { locale, t } = useMvuI18n();
const sandas_message_help = computed(() =>
    locale.value === 'zh-CN' ? sandas_message_help_zh_cn : sandas_message_help_en
);
const license_help = computed(
    () => `${t('panel.compatibility.licenseIntro')}\n\n${t('panel.compatibility.licenseDetails')}`
);

function format_boolean(value: boolean): string {
    return t(value ? 'common.enabled' : 'common.disabled');
}

const update_chat_variables_override_label = computed(() =>
    format_boolean(store.effective_settings.兼容性.更新到聊天变量)
);
const sendas_not_user_override_label = computed(() =>
    format_boolean(store.effective_settings.兼容性.sendas不视为user消息)
);
</script>

<style scoped>
.mvu-license-table-wrap {
    max-height: 18rem;
    overflow: auto;
    border: 1px solid var(--SmartThemeBorderColor, rgba(45, 45, 45, 1));
    border-radius: 6px;
}

.mvu-license-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9em;
}

.mvu-license-table th,
.mvu-license-table td {
    padding: 0.35rem 0.5rem;
    text-align: start;
    vertical-align: top;
    border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(45, 45, 45, 0.45));
}

.mvu-license-table th:last-child,
.mvu-license-table td:last-child {
    width: 7.5rem;
    white-space: nowrap;
}

.mvu-license-table tbody tr:last-child td {
    border-bottom: 0;
}

.mvu-license-table a {
    overflow-wrap: anywhere;
}
</style>
