<template>
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>MVU 变量框架</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>

        <div class="inline-drawer-content">
            <div class="flex-container flexFlowColumn">
                <div><strong>通知设置</strong></div>
                <label class="checkbox_label" for="mvu_notification_error">
                    <input
                        id="mvu_notification_error"
                        v-model="settings.通知.变量更新出错"
                        type="checkbox"
                    />
                    <span>变量更新出错时通知</span>
                </label>
            </div>

            <hr />

            <div class="flex-container flexFlowColumn">
                <div><strong>变量更新方式</strong></div>
                <select id="mvu_update_method" v-model="settings.更新方式" class="text_pole">
                    <option value="随AI输出">随AI输出</option>
                    <option value="额外模型解析">额外模型解析</option>
                </select>

                <template v-if="settings.更新方式 === '额外模型解析'">
                    <div class="flex-container flexFlowColumn">
                        <label for="mvu_api_url">API 地址</label>
                        <input
                            id="mvu_api_url"
                            v-model="settings.额外模型解析配置.api地址"
                            type="text"
                            class="text_pole"
                            placeholder="http://localhost:1234/v1"
                        />
                    </div>

                    <div class="flex-container flexFlowColumn">
                        <label for="mvu_api_key">API 密钥</label>
                        <input
                            id="mvu_api_key"
                            v-model="settings.额外模型解析配置.密钥"
                            type="password"
                            class="text_pole"
                            placeholder="留空表示无需密钥"
                        />
                    </div>

                    <div class="flex-container flexFlowColumn">
                        <label for="mvu_model_name">模型名称</label>
                        <input
                            id="mvu_model_name"
                            v-model="settings.额外模型解析配置.模型名称"
                            type="text"
                            class="text_pole"
                            placeholder="gemini-2.5-flash"
                        />
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useSettingsStore } from '@/settings';
import { storeToRefs } from 'pinia';

const { settings } = storeToRefs(useSettingsStore());
</script>
