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
                <div>
                    <strong>变量更新方式</strong>
                    <i
                        class="fa-solid fa-circle-question fa-sm note-link-span"
                        style="cursor: pointer"
                        @click="showHelp"
                    ></i>
                </div>
                <select id="mvu_update_method" v-model="settings.更新方式" class="text_pole">
                    <option value="随AI输出">随AI输出</option>
                    <option value="额外模型解析">额外模型解析</option>
                </select>

                <template v-if="settings.更新方式 === '额外模型解析'">
                    <select
                        id="mvu_extra_model_source"
                        v-model="settings.额外模型解析配置.模型来源"
                        class="text_pole"
                    >
                        <option value="与插头相同">与插头相同</option>
                        <option value="自定义">自定义</option>
                    </select>

                    <template v-if="settings.额外模型解析配置.模型来源 === '自定义'">
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
                </template>
            </div>

            <hr />

            <div class="flex-container flexFlowColumn">
                <div><strong>修复按钮</strong></div>
                <div class="flex-container flex">
                    <div
                        v-for="button in buttons"
                        :key="button.name"
                        class="menu_button menu_button_icon interactable"
                        tabindex="0"
                        role="button"
                        @click="button.function"
                    >
                        {{ button.name }}
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { buttons } from '@/button';
import { useSettingsStore } from '@/settings';
import { storeToRefs } from 'pinia';

const { settings } = storeToRefs(useSettingsStore());

function showHelp() {
    SillyTavern.callGenericPopup(
        `<p>为了让剧情模型更专注于剧情，你可以选择变量更新的方式：</p>
        <ul>
        <li><strong>随AI输出</strong>：名字中有 <code>[mvu_update]</code> 的条目将会正常发给 AI，因此 AI 将会在回复时输出变量更新分析及更新命令，进而更新变量。</li>
        <li><strong>额外模型解析</strong>：名字中有 <code>[mvu_update]</code> 的条目不会发给 AI。在 AI 回复完成后，MVU 将会只使用名字中有 <code>[mvu_update]</code> 的条目调用额外模型专门解析变量更新。</li>
        <li><strong>工具调用（待完成）</strong>：名字中有 <code>[mvu_update]</code> 的条目将作为工具调用的提示词发给 AI，因此 AI 将会通过工具调用来更新变量。</li>
        </ul>
        <hr/>
        <p>如果要使用除<q>随AI输出</q>以外的方式，则需要作者适配世界书，添加带有 <code>[mvu_update]</code> 的条目；如果作者没有适配，则依旧会使用<q>随AI输出</q>的方式。<br>
        具体地，MVU 变量框架的提示词分为：</p>
        <ul>
        <li><strong>变量列表</strong>：让 AI 知道有什么变量，如 <code>null</code>、<code>&lt;%= getvar('stat_data') _%&gt;</code> 等。</li>
        <li><strong>变量更新规则</strong>：让 AI 知道变量该如何更新，如<code>药物依赖度应该每分钟增加1点</code>等。</li>
        <li><strong>输出规则</strong>：让 AI 知道该输出什么来表达变量发生变化，如提示词中要求输出的<code>&lt;UpdateVariable&gt;</code>块。</li>
        </ul>
        <p>作者需要做的，是给<q>变量更新规则</q>和<q>输出规则</q>条目的名字添加 <code>[mvu_update]</code>。</p>`,
        SillyTavern.POPUP_TYPE.TEXT,
        '',
        { allowHorizontalScrolling: true, leftAlign: true }
    );
}
</script>
