import { is_jest_environment } from '@/util';
import { defineStore } from 'pinia';
import { ref, toRaw, watch } from 'vue';
import * as z from 'zod';

export const Settings = z
    .object({
        通知: z
            .object({
                MVU框架加载成功: z.boolean().default(true),
                变量初始化成功: z.boolean().default(true),
                变量更新出错: z.boolean().default(false),
                额外模型解析中: z.boolean().default(true),
            })
            .prefault({}),
        更新方式: z.enum(['随AI输出', '额外模型解析']).default('随AI输出'),
        额外模型解析配置: z
            .object({
                破限方案: z.enum(['使用内置破限', '使用当前预设']).default('使用内置破限'),
                使用函数调用: z.boolean().default(false),
                兼容假流式: z.boolean().default(false),

                启用自动请求: z.boolean().default(true),
                请求方式: z
                    .enum([
                        '依次请求，失败后重试',
                        '同时请求多次',
                        '先请求一次, 失败后再同时请求多次',
                    ])
                    .default('依次请求，失败后重试'),
                请求次数: z.number().default(3),

                模型来源: z.enum(['与插头相同', '自定义']).default('与插头相同'),
                api地址: z.string().default('http://localhost:1234/v1'),
                密钥: z.string().default(''),
                模型名称: z.string().default('gemini-2.5-flash-nothinking'),
                温度: z.coerce
                    .number()
                    .default(1)
                    .transform(value => _.clamp(value, 0, 2)),
                频率惩罚: z.coerce
                    .number()
                    .default(0.0)
                    .transform(value => _.clamp(value, -2, 2)),
                存在惩罚: z.coerce
                    .number()
                    .default(0.0)
                    .transform(value => _.clamp(value, -2, 2)),
                top_p: z.coerce
                    .number()
                    .default(1)
                    .transform(value => _.clamp(value, 0, 1)),
                最大回复token数: z.coerce
                    .number()
                    .default(4096)
                    .transform(value => Math.max(0, value)),
            })
            .prefault({}),
        自动清理变量: z
            .object({
                启用: z.boolean().default(true),
                快照保留间隔: z.number().default(50),
                要保留变量的最近楼层数: z.number().default(20),
                触发恢复变量的最近楼层数: z.number().default(10),
            })
            .prefault({}),
        兼容性: z
            .object({
                更新到聊天变量: z.boolean().default(false),
                显示老旧功能: z.boolean().default(false),
            })
            .prefault({}),
        internal: z
            .object({
                已提醒更新了配置界面: z.boolean().default(false),
                已提醒自动清理旧变量功能: z.boolean().default(false),
                已提醒更新了API温度等配置: z.boolean().default(false),
                已默认开启自动清理旧变量功能: z.boolean().default(false),
                已提醒内置破限: z.boolean().default(false),
                已提醒额外模型同时请求: z.boolean().default(false),
                已开启默认不兼容假流式: z.boolean().default(false),
            })
            .prefault({}),
        debug: z
            .object({
                首次额外请求必失败: z.boolean().default(false),
            })
            .prefault({}),
    })
    .prefault({});

const Runtimes = z
    .object({
        unsupported_warnings: z.string().default(''),
        is_during_extra_analysis: z.boolean().default(false),
        is_function_call_enabled: z.boolean().default(false),
    })
    .prefault({});

type LooseSettings = Record<string, unknown>;

function migrateSettings(raw: unknown): LooseSettings {
    if (!raw || typeof raw !== 'object') {
        return {};
    }

    const legacy = raw as LooseSettings;
    const migrated = _.cloneDeep(legacy) as LooseSettings;

    if (
        _.has(legacy, '自动触发额外模型解析') &&
        !_.has(migrated, '额外模型解析配置.启用自动请求')
    ) {
        _.set(migrated, '额外模型解析配置.启用自动请求', _.get(legacy, '自动触发额外模型解析'));
    }

    if (
        _.has(legacy, '额外模型解析配置.发送预设') &&
        !_.has(migrated, '额外模型解析配置.破限方案')
    ) {
        const sendPreset = _.get(legacy, '额外模型解析配置.发送预设');
        if (typeof sendPreset === 'boolean') {
            _.set(
                migrated,
                '额外模型解析配置.破限方案',
                sendPreset ? '使用当前预设' : '使用内置破限'
            );
        }
    }

    if (_.has(legacy, '更新到聊天变量') && !_.has(migrated, '兼容性.更新到聊天变量')) {
        _.set(migrated, '兼容性.更新到聊天变量', _.get(legacy, '更新到聊天变量'));
    }

    if (_.has(legacy, 'legacy.显示老旧功能') && !_.has(migrated, '兼容性.显示老旧功能')) {
        _.set(migrated, '兼容性.显示老旧功能', _.get(legacy, 'legacy.显示老旧功能'));
    }

    if (_.has(legacy, 'auto_cleanup.启用') && !_.has(migrated, '自动清理变量.启用')) {
        _.set(migrated, '自动清理变量.启用', _.get(legacy, 'auto_cleanup.启用'));
    }

    if (_.has(legacy, '快照保留间隔') && !_.has(migrated, '自动清理变量.快照保留间隔')) {
        _.set(migrated, '自动清理变量.快照保留间隔', _.get(legacy, '快照保留间隔'));
    }

    if (
        _.has(legacy, 'auto_cleanup.要保留变量的最近楼层数') &&
        !_.has(migrated, '自动清理变量.要保留变量的最近楼层数')
    ) {
        _.set(
            migrated,
            '自动清理变量.要保留变量的最近楼层数',
            _.get(legacy, 'auto_cleanup.要保留变量的最近楼层数')
        );
    }

    if (
        _.has(legacy, 'auto_cleanup.触发恢复变量的最近楼层数') &&
        !_.has(migrated, '自动清理变量.触发恢复变量的最近楼层数')
    ) {
        _.set(
            migrated,
            '自动清理变量.触发恢复变量的最近楼层数',
            _.get(legacy, 'auto_cleanup.触发恢复变量的最近楼层数')
        );
    }

    return migrated;
}

export const useDataStore = defineStore('data', () => {
    const settings = ref(
        Settings.parse(migrateSettings(_.get(SillyTavern.extensionSettings, 'mvu_settings', {})))
    );
    watch(
        settings,
        new_settings => {
            _.set(SillyTavern.extensionSettings, 'mvu_settings', toRaw(new_settings));
            if (!is_jest_environment) SillyTavern.saveSettingsDebounced();
        },
        { deep: true }
    );

    const runtimes = ref(Runtimes.parse({}));
    watch(
        () => runtimes.value.is_during_extra_analysis,
        new_value => insertOrAssignVariables({ extra_analysis: new_value }, { type: 'global' }),
        { immediate: true }
    );
    const resetRuntimes = () => {
        runtimes.value = Runtimes.parse({});
    };

    return { settings, runtimes, resetRuntimes };
});
