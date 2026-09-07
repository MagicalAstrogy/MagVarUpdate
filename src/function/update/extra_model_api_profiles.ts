import { tr } from '@/i18n';
import {
    getPiProviderTargetDefinition,
    resolvePiApiKeyScope,
} from '@/function/update/pi/provider_target';
import { klona } from 'klona';

export type ExtraModelApiProfileBackend = 'custom' | 'pi';

export type ExtraModelApiRequestFields = {
    破限方案: '使用内置破限' | '使用当前预设' | '使用其他预设';
    其他预设名称: string;
    随机头部: boolean;
    应答格式: '聊天消息' | '工具调用' | '格式化输出' | '格式化输出(v4兼容)';
    关闭thinking: boolean;
    兼容假流式: boolean;
};

const API_REQUEST_FIELDS = [
    '破限方案',
    '其他预设名称',
    '随机头部',
    '应答格式',
    '关闭thinking',
    '兼容假流式',
] as const satisfies readonly (keyof ExtraModelApiRequestFields)[];

/** 提取已配置的请求选项，保留缺失字段，供方案保存和旧方案补全使用。 */
function extractApiRequestFields(
    config: Partial<ExtraModelApiRequestFields>
): Partial<ExtraModelApiRequestFields> {
    return Object.fromEntries(
        API_REQUEST_FIELDS.filter(field => config[field] !== undefined).map(field => [
            field,
            config[field],
        ])
    );
}

export type ExtraModelPiConnectionFields = {
    [key: string]: unknown;
    provider: string;
    api: string;
    authType: string;
    endpoint: string;
    useProxy: boolean;
    model: string;
    contextWindow: number | string;
    customHeaders: string;
    customIncludeBody: string;
    customExcludeBody: string;
};

export type ExtraModelPiSettings = ExtraModelPiConnectionFields & {
    credentials: Record<string, unknown>;
    apiKeys?: Record<string, string>;
};

export type ExtraModelApiProfile = Partial<ExtraModelApiRequestFields> & {
    [key: string]: unknown;
    名称: string;
    backend?: ExtraModelApiProfileBackend;
    api地址: string;
    密钥: string;
    模型名称: string;
    pi?: ExtraModelPiConnectionFields;
};

export type ExtraModelApiProfileFields = Partial<ExtraModelApiRequestFields> & {
    模型来源?: '与插头相同' | '自定义' | '更多';
    api地址: string;
    密钥: string;
    customApiKey?: string;
    模型名称: string;
    pi?: ExtraModelPiSettings;
    api方案列表: ExtraModelApiProfile[];
    当前api方案: string;
};

export const DEFAULT_EXTRA_MODEL_API_PROFILE_NAME = '默认';

/** 统一方案名两端空白，避免查找、去重和保存使用不同的名称。 */
function normalizeExtraModelApiProfileName(name: string): string {
    return name.trim();
}

/**
 * 将方案中的上下文窗口规范为非负整数，0 表示使用目录值。
 * 返回 undefined 表示配置无效，调用方不得将其当作目录默认值。
 */
export function normalizeExtraModelPiProfileContextWindow(value: unknown): number | undefined {
    if (typeof value === 'number') {
        return Number.isInteger(value) && value >= 0 ? value : undefined;
    }
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    if (trimmed === '') {
        return 0;
    }
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** 根据当前模型来源确定方案保存的是自定义连接还是 Pi 连接。 */
function getExtraModelApiProfileBackend(
    config: ExtraModelApiProfileFields
): ExtraModelApiProfileBackend {
    return config.模型来源 === '更多' ? 'pi' : 'custom';
}

/**
 * 生成脱离响应式代理的连接快照，并规范连接标识与上下文窗口。
 * 快照不包含 OAuth 凭证或按目标缓存的 API Key，避免方案复制这些共享状态。
 */
function clonePiConnectionFields(
    pi: ExtraModelPiConnectionFields | ExtraModelPiSettings | undefined
): ExtraModelPiConnectionFields | undefined {
    if (pi === undefined) {
        return undefined;
    }

    // Settings and profile entries normally arrive as Vue/Pinia reactive proxies. Native
    // structuredClone rejects proxies with DataCloneError, while klona traverses them into
    // detached plain objects and still preserves unknown forward-compatible fields.
    const cloned = klona(pi);
    delete cloned.credentials;
    delete cloned.apiKeys;
    // Runtime resolution treats surrounding whitespace on connection identifiers as insignificant.
    // Persist the same canonical representation so profile validation, the Source form, dirty
    // checks, and runtime resolution cannot disagree about a target after import.
    for (const field of ['provider', 'api', 'authType', 'endpoint', 'model'] as const) {
        if (typeof cloned[field] === 'string') {
            cloned[field] = cloned[field].trim();
        }
    }
    // Profiles saved before this option existed, and malformed imported values, must retain the
    // direct-transport default rather than becoming enabled through truthiness coercion.
    cloned.useProxy = cloned.useProxy === true;
    const context_window = normalizeExtraModelPiProfileContextWindow(cloned.contextWindow);
    if (context_window !== undefined) {
        cloned.contextWindow = context_window;
    }
    return cloned;
}

/** 仅为完整且受支持的 API Key 目标解析密钥缓存位置；无效连接返回空字符串。 */
function resolvePiConnectionApiKeyScope(
    pi: ExtraModelPiConnectionFields | ExtraModelPiSettings | undefined
): string {
    if (
        pi === undefined ||
        typeof pi.provider !== 'string' ||
        typeof pi.api !== 'string' ||
        typeof pi.authType !== 'string' ||
        typeof pi.endpoint !== 'string'
    ) {
        return '';
    }

    return resolvePiApiKeyScope(
        getPiProviderTargetDefinition(pi.provider.trim()),
        pi.api.trim(),
        pi.authType.trim(),
        pi.endpoint
    );
}

/** 检查导入快照是否具备全部连接字段及合法类型，避免用默认值补成可发送连接。 */
function hasCompletePiConnectionSnapshot(
    pi: ExtraModelPiConnectionFields | ExtraModelPiSettings | undefined
): pi is ExtraModelPiConnectionFields | ExtraModelPiSettings {
    return (
        pi !== undefined &&
        typeof pi.provider === 'string' &&
        typeof pi.api === 'string' &&
        typeof pi.authType === 'string' &&
        (pi.authType.trim() === 'api_key' || pi.authType.trim() === 'oauth') &&
        typeof pi.endpoint === 'string' &&
        typeof pi.useProxy === 'boolean' &&
        typeof pi.model === 'string' &&
        typeof pi.contextWindow === 'number' &&
        Number.isInteger(pi.contextWindow) &&
        pi.contextWindow >= 0 &&
        typeof pi.customHeaders === 'string' &&
        typeof pi.customIncludeBody === 'string' &&
        typeof pi.customExcludeBody === 'string'
    );
}

/** 在结构完整的基础上检查服务商、协议和模型是否已填写。 */
function hasConfiguredPiConnectionSnapshot(
    pi: ExtraModelPiConnectionFields | ExtraModelPiSettings | undefined
): pi is ExtraModelPiConnectionFields | ExtraModelPiSettings {
    return (
        hasCompletePiConnectionSnapshot(pi) &&
        pi.provider.trim().length > 0 &&
        pi.api.trim().length > 0 &&
        pi.model.trim().length > 0
    );
}

/** 判断连接能否归属到有效的 API Key 目标，作为保留方案密钥的条件。 */
function hasValidPiApiKeyTarget(
    pi: ExtraModelPiConnectionFields | ExtraModelPiSettings | undefined
): boolean {
    return hasConfiguredPiConnectionSnapshot(pi) && resolvePiConnectionApiKeyScope(pi) !== '';
}

/** 规范单个方案的名称、后端和连接快照，并清除不属于当前认证方式的密钥。 */
function normalizeExtraModelApiProfile(profile: ExtraModelApiProfile): ExtraModelApiProfile {
    const cloned = klona(profile);
    delete cloned.customApiKey;
    cloned.名称 = normalizeExtraModelApiProfileName(cloned.名称);
    const backend: ExtraModelApiProfileBackend = cloned.backend === 'pi' ? 'pi' : 'custom';
    cloned.backend = backend;

    if (backend === 'pi' && cloned.pi !== undefined) {
        cloned.pi = clonePiConnectionFields(cloned.pi);
    } else {
        delete cloned.pi;
    }
    if (backend === 'pi') {
        // These legacy top-level fields belong to the hidden Custom source. Pi owns its endpoint
        // and model inside `pi`, so importing or saving them here must never overwrite that cache.
        cloned.api地址 = '';
        cloned.模型名称 = '';

        // A profile-level key has wire meaning only for a registry-backed, normalizable API-key
        // target. OAuth and malformed/future targets retain metadata but never a dormant secret.
        if (!hasValidPiApiKeyTarget(cloned.pi)) {
            cloned.密钥 = '';
        }
    }
    return cloned;
}

/** 规范方案列表，剔除空名称和重复名称，同名方案只保留首次出现的条目。 */
function normalizeExtraModelApiProfileList(
    profiles: ExtraModelApiProfile[]
): ExtraModelApiProfile[] {
    const names = new Set<string>();
    const normalized_profiles: ExtraModelApiProfile[] = [];
    for (const profile of profiles) {
        const normalized_profile = normalizeExtraModelApiProfile(profile);
        if (normalized_profile.名称 === '' || names.has(normalized_profile.名称)) {
            continue;
        }
        names.add(normalized_profile.名称);
        normalized_profiles.push(normalized_profile);
    }
    return normalized_profiles;
}

/** 将方案连接合并到运行设置，同时保留当前凭证仓库和目标密钥缓存。 */
function mergePiConnectionFields(
    current: ExtraModelPiSettings | undefined,
    profile: ExtraModelPiConnectionFields
): ExtraModelPiSettings {
    const current_clone = current === undefined ? undefined : klona(current);
    const profile_clone = clonePiConnectionFields(profile)!;
    return {
        ...current_clone,
        ...profile_clone,
        credentials: klona(current_clone?.credentials ?? {}),
        apiKeys: klona(current_clone?.apiKeys ?? {}),
    } as ExtraModelPiSettings;
}

/** 清空可发送的连接字段，保留共享凭证和密钥缓存，等待用户重新配置。 */
function clearPiConnectionFields(pi: ExtraModelPiSettings): ExtraModelPiSettings {
    const cloned = klona(pi);
    return {
        ...cloned,
        provider: '',
        api: '',
        authType: 'api_key',
        endpoint: '',
        useProxy: false,
        model: '',
        contextWindow: 0,
        credentials: klona(cloned.credentials),
        apiKeys: klona(cloned.apiKeys ?? {}),
        customHeaders: '',
        customIncludeBody: '',
        customExcludeBody: '',
    };
}

/** 从当前设置提取可保存的连接和请求选项；Pi 方案必须先通过完整性校验。 */
export function extractExtraModelApiProfileFields(
    config: ExtraModelApiProfileFields
): ExtraModelApiProfile {
    const backend = getExtraModelApiProfileBackend(config);
    const pi_snapshot = backend === 'pi' ? clonePiConnectionFields(config.pi) : undefined;
    if (backend === 'pi' && !hasConfiguredPiConnectionSnapshot(pi_snapshot)) {
        throw new Error(tr('runtime.apiProfile.piConfigRequired'));
    }
    return {
        名称:
            normalizeExtraModelApiProfileName(config.当前api方案) ||
            DEFAULT_EXTRA_MODEL_API_PROFILE_NAME,
        backend,
        api地址: backend === 'pi' ? '' : config.api地址,
        密钥: backend === 'pi' && !hasValidPiApiKeyTarget(pi_snapshot) ? '' : config.密钥,
        模型名称: backend === 'pi' ? '' : config.模型名称,
        ...extractApiRequestFields(config),
        ...(backend === 'pi' && pi_snapshot !== undefined ? { pi: pi_snapshot } : {}),
    };
}

/**
 * 应用方案的连接及请求选项，并切换到相应模型来源。
 * 无效 Pi 快照会清空活动连接，不能借用其他来源的密钥继续发送。
 */
export function applyExtraModelApiProfile(
    config: ExtraModelApiProfileFields,
    profile: ExtraModelApiProfile
): ExtraModelApiProfileFields {
    const normalized_profile = normalizeExtraModelApiProfile(profile);
    const result: ExtraModelApiProfileFields = {
        ...config,
        ...extractApiRequestFields(normalized_profile),
        模型来源: normalized_profile.backend === 'pi' ? '更多' : '自定义',
        密钥: normalized_profile.密钥,
        当前api方案: normalized_profile.名称,
        ...(normalized_profile.backend === 'custom'
            ? {
                  api地址: normalized_profile.api地址,
                  模型名称: normalized_profile.模型名称,
              }
            : {}),
    };
    if (normalized_profile.backend === 'pi') {
        if (hasConfiguredPiConnectionSnapshot(normalized_profile.pi)) {
            result.pi = mergePiConnectionFields(config.pi, normalized_profile.pi);
        } else {
            // Never combine a malformed Pi profile's key with the previously active provider,
            // endpoint, or model. Preserve credentials, but disable the connection until the
            // user repairs and saves a complete snapshot.
            result.密钥 = '';
            if (config.pi !== undefined) {
                result.pi = clearPiConnectionFields(config.pi);
            }
        }
    }
    return result;
}

/** 按规范化名称新增或更新方案，更新时保留已有条目的其他字段。 */
export function upsertExtraModelApiProfile(
    profiles: ExtraModelApiProfile[],
    profile: ExtraModelApiProfile
): ExtraModelApiProfile[] {
    const normalized_name = normalizeExtraModelApiProfileName(profile.名称);
    if (!normalized_name) {
        throw new Error(tr('runtime.apiProfile.nameRequired'));
    }

    const normalized_profiles = normalizeExtraModelApiProfileList(profiles);
    const next_profile = {
        ...normalizeExtraModelApiProfile(profile),
        名称: normalized_name,
    };
    const existing_index = normalized_profiles.findIndex(item => item.名称 === normalized_name);
    if (existing_index === -1) {
        return [...normalized_profiles, next_profile];
    }

    const next_profiles = [...normalized_profiles];
    next_profiles[existing_index] = normalizeExtraModelApiProfile({
        ...normalized_profiles[existing_index],
        ...next_profile,
    });
    return next_profiles;
}

/** 返回删除指定方案后的规范化列表，不直接修改原列表。 */
export function removeExtraModelApiProfile(
    profiles: ExtraModelApiProfile[],
    profile_name: string
): ExtraModelApiProfile[] {
    const normalized_name = normalizeExtraModelApiProfileName(profile_name);
    return normalizeExtraModelApiProfileList(profiles).filter(
        profile => profile.名称 !== normalized_name
    );
}

/** 按规范化名称检查方案是否存在，供保存和删除操作校验。 */
export function hasExtraModelApiProfile(
    profiles: ExtraModelApiProfile[],
    profile_name: string
): boolean {
    const normalized_name = normalizeExtraModelApiProfileName(profile_name);
    return normalizeExtraModelApiProfileList(profiles).some(
        profile => profile.名称 === normalized_name
    );
}

/** 比较活动方案与当前连接、密钥及请求选项，判断是否存在未保存修改。 */
export function isActiveExtraModelApiProfileDirty(config: ExtraModelApiProfileFields): boolean {
    const active_name = normalizeExtraModelApiProfileName(config.当前api方案);
    if (!active_name) {
        return false;
    }

    const profile = normalizeExtraModelApiProfileList(config.api方案列表).find(
        item => item.名称 === active_name
    );
    if (!profile) {
        return false;
    }

    const normalized_profile = normalizeExtraModelApiProfile(profile);
    const backend = getExtraModelApiProfileBackend(config);
    if (normalized_profile.backend !== backend || normalized_profile.密钥 !== config.密钥) {
        return true;
    }

    if (
        API_REQUEST_FIELDS.some(
            field =>
                normalized_profile[field] !== undefined &&
                normalized_profile[field] !== config[field]
        )
    ) {
        return true;
    }

    if (
        backend === 'custom' &&
        (normalized_profile.api地址 !== config.api地址 ||
            normalized_profile.模型名称 !== config.模型名称)
    ) {
        return true;
    }

    return (
        backend === 'pi' && !_.isEqual(normalized_profile.pi, clonePiConnectionFields(config.pi))
    );
}

/** 解除方案绑定并清空活动连接；使用 Pi 时保留隐藏的自定义连接字段。 */
export function clearUnboundExtraModelApiProfileFields(
    config: ExtraModelApiProfileFields
): ExtraModelApiProfileFields {
    const preserve_hidden_custom_fields = config.模型来源 === '更多';
    return {
        ...config,
        当前api方案: '',
        api地址: preserve_hidden_custom_fields ? config.api地址 : '',
        密钥: '',
        模型名称: preserve_hidden_custom_fields ? config.模型名称 : '',
        ...(config.模型来源 === '更多' && config.pi !== undefined
            ? { pi: clearPiConnectionFields(config.pi) }
            : {}),
    };
}

/** 校正活动方案引用，使列表、当前名称和连接状态保持一致。 */
export function reconcileExtraModelApiProfileSelection<T extends ExtraModelApiProfileFields>(
    config: T
): T {
    const normalized_config = {
        ...config,
        api方案列表: normalizeExtraModelApiProfileList(config.api方案列表),
        当前api方案: normalizeExtraModelApiProfileName(config.当前api方案),
    } as T;
    const active_name = normalized_config.当前api方案;
    if (!active_name) {
        return normalized_config;
    }

    if (hasExtraModelApiProfile(normalized_config.api方案列表, active_name)) {
        return normalized_config;
    }

    if (normalized_config.api方案列表.length === 0) {
        return {
            ...normalized_config,
            当前api方案: '',
        };
    }

    return applyExtraModelApiProfile(
        {
            ...normalized_config,
            api方案列表: normalized_config.api方案列表,
        },
        normalized_config.api方案列表[0]
    ) as T;
}

/** 删除指定的活动方案，并同步清理方案选择及相关连接字段。 */
export function deleteActiveExtraModelApiProfile(
    config: ExtraModelApiProfileFields,
    profile_name: string
): ExtraModelApiProfileFields {
    const normalized_name = normalizeExtraModelApiProfileName(profile_name);
    if (
        normalized_name === '' ||
        normalized_name !== normalizeExtraModelApiProfileName(config.当前api方案) ||
        !hasExtraModelApiProfile(config.api方案列表, normalized_name)
    ) {
        return config;
    }

    const remaining = removeExtraModelApiProfile(config.api方案列表, profile_name);
    if (remaining.length === 0) {
        return {
            ...clearUnboundExtraModelApiProfileFields(config),
            api方案列表: [],
        };
    }

    return applyExtraModelApiProfile(
        {
            ...config,
            api方案列表: remaining,
        },
        remaining[0]
    );
}

export type ExtraModelApiProfileDeletionConfirmation = 'discard_unsaved_changes' | 'delete_profile';

/**
 * 有未保存修改时先确认丢弃，再确认删除，任一步取消都返回 null。
 * 删除前再次核对活动方案，避免等待弹窗期间误删用户新选中的方案。
 */
export async function deleteActiveExtraModelApiProfileWithConfirmation(
    config: ExtraModelApiProfileFields,
    profile_name: string,
    confirm: (confirmation: ExtraModelApiProfileDeletionConfirmation) => Promise<boolean>
): Promise<ExtraModelApiProfileFields | null> {
    const normalized_name = normalizeExtraModelApiProfileName(profile_name);
    if (
        normalized_name === '' ||
        normalized_name !== normalizeExtraModelApiProfileName(config.当前api方案) ||
        !hasExtraModelApiProfile(config.api方案列表, normalized_name)
    ) {
        return config;
    }

    if (isActiveExtraModelApiProfileDirty(config) && !(await confirm('discard_unsaved_changes'))) {
        return null;
    }

    if (!(await confirm('delete_profile'))) {
        return null;
    }

    return deleteActiveExtraModelApiProfile(config, profile_name);
}

/**
 * 补全方案中缺失的请求选项，并校正方案选择与密钥归属。
 * 不完整的 Pi 快照保持不可发送，不能从遗留自定义字段推导出 Pi 连接。
 */
export function migrateExtraModelApiProfiles<T extends ExtraModelApiProfileFields>(config: T): T {
    let migrated = {
        ...config,
        // Old profiles only stored connection fields. Copy the current request options into
        // every profile once; saved per-profile values must survive subsequent loads/imports.
        api方案列表: normalizeExtraModelApiProfileList(
            config.api方案列表.map(profile => ({
                ...profile,
                ...extractApiRequestFields(config),
                ...extractApiRequestFields(profile),
            }))
        ),
        当前api方案: normalizeExtraModelApiProfileName(config.当前api方案),
    } as T;

    // The shared root key has wire meaning only for a registry-backed, normalizable API-key target.
    // Clear stale imported values even when there is no active profile (and before legacy-profile
    // detection), while retaining the source-specific Custom/API-key caches and OAuth store.
    if (
        migrated.模型来源 === '更多' &&
        resolvePiConnectionApiKeyScope(migrated.pi) === '' &&
        migrated.密钥 !== ''
    ) {
        migrated = {
            ...migrated,
            密钥: '',
        } as T;
    }

    const active_profile = migrated.api方案列表.find(
        profile => profile.名称 === migrated.当前api方案
    );
    if (active_profile?.backend === 'pi' && !hasConfiguredPiConnectionSnapshot(active_profile.pi)) {
        migrated = applyExtraModelApiProfile(migrated, active_profile) as T;
    }

    if (migrated.api方案列表.length === 0) {
        const has_legacy_custom_api =
            migrated.api地址.trim().length > 0 ||
            migrated.密钥.trim().length > 0 ||
            migrated.模型名称.trim().length > 0;
        if (has_legacy_custom_api) {
            // A newly selected but not yet configured Pi source may still carry legacy root
            // Custom fields. Do not turn those unrelated fields into a sendable Pi profile.
            if (
                getExtraModelApiProfileBackend(migrated) === 'pi' &&
                !hasConfiguredPiConnectionSnapshot(migrated.pi)
            ) {
                return reconcileExtraModelApiProfileSelection(migrated);
            }
            const profile = extractExtraModelApiProfileFields(migrated);
            migrated = {
                ...migrated,
                api方案列表: [
                    {
                        ...profile,
                        名称: DEFAULT_EXTRA_MODEL_API_PROFILE_NAME,
                    },
                ],
                当前api方案: migrated.当前api方案 || DEFAULT_EXTRA_MODEL_API_PROFILE_NAME,
            };
        }
    }

    return reconcileExtraModelApiProfileSelection(migrated);
}

/** 按名称查找并应用方案；不存在时抛出可展示的配置错误。 */
export function selectExtraModelApiProfile(
    config: ExtraModelApiProfileFields,
    profile_name: string
): ExtraModelApiProfileFields {
    const normalized_name = normalizeExtraModelApiProfileName(profile_name);
    const normalized_profiles = normalizeExtraModelApiProfileList(config.api方案列表);
    const profile = normalized_profiles.find(item => item.名称 === normalized_name);
    if (!profile) {
        throw new Error(
            tr('runtime.apiProfile.notFound', {
                name: normalized_name,
            })
        );
    }
    return applyExtraModelApiProfile(
        {
            ...config,
            api方案列表: normalized_profiles,
        },
        profile
    );
}

/** 保存当前连接和请求选项，支持更新活动方案或指定名称，并防止覆盖其他同名方案。 */
export function saveCurrentExtraModelApiProfile(
    config: ExtraModelApiProfileFields,
    profile_name?: string
): ExtraModelApiProfileFields {
    const target_name = normalizeExtraModelApiProfileName(profile_name ?? config.当前api方案);
    if (!target_name) {
        throw new Error(tr('runtime.apiProfile.selectOrEnterName'));
    }

    if (
        hasExtraModelApiProfile(config.api方案列表, target_name) &&
        normalizeExtraModelApiProfileName(config.当前api方案) !== target_name
    ) {
        throw new Error(
            tr('runtime.apiProfile.alreadyExists', {
                name: target_name,
            })
        );
    }

    const normalized_profiles = normalizeExtraModelApiProfileList(config.api方案列表);
    const source_profile = normalized_profiles.find(
        item => item.名称 === normalizeExtraModelApiProfileName(config.当前api方案)
    );
    const normalized_source_profile =
        source_profile === undefined ? undefined : normalizeExtraModelApiProfile(source_profile);
    const profile: ExtraModelApiProfile = {
        ...normalized_source_profile,
        ...extractExtraModelApiProfileFields(config),
        名称: target_name,
    };
    if (profile.backend !== 'pi') {
        delete profile.pi;
    }
    return applyExtraModelApiProfile(
        {
            ...config,
            api方案列表: upsertExtraModelApiProfile(normalized_profiles, profile),
        },
        profile
    );
}

/** 校验新名称不为空且未占用，再将当前配置另存为独立方案。 */
export function saveAsNewExtraModelApiProfile(
    config: ExtraModelApiProfileFields,
    profile_name: string
): ExtraModelApiProfileFields {
    const target_name = normalizeExtraModelApiProfileName(profile_name);
    if (!target_name) {
        throw new Error(tr('runtime.apiProfile.enterNewName'));
    }
    if (hasExtraModelApiProfile(config.api方案列表, target_name)) {
        throw new Error(
            tr('runtime.apiProfile.alreadyExists', {
                name: target_name,
            })
        );
    }
    return saveCurrentExtraModelApiProfile(config, target_name);
}
