import { tr } from '@/i18n';
import {
    getPiProviderTargetDefinition,
    resolvePiApiKeyScope,
} from '@/function/update/pi/provider_target';
import { klona } from 'klona';

export type ExtraModelApiProfileBackend = 'custom' | 'pi';

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

export type ExtraModelApiProfile = {
    [key: string]: unknown;
    名称: string;
    backend?: ExtraModelApiProfileBackend;
    api地址: string;
    密钥: string;
    模型名称: string;
    pi?: ExtraModelPiConnectionFields;
};

export type ExtraModelApiProfileFields = {
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

function normalizeExtraModelApiProfileName(name: string): string {
    return name.trim();
}

/** Canonical persisted form for profile context windows; undefined means fail closed. */
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

function getExtraModelApiProfileBackend(
    config: ExtraModelApiProfileFields
): ExtraModelApiProfileBackend {
    return config.模型来源 === '更多' ? 'pi' : 'custom';
}

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

function hasValidPiApiKeyTarget(
    pi: ExtraModelPiConnectionFields | ExtraModelPiSettings | undefined
): boolean {
    return hasConfiguredPiConnectionSnapshot(pi) && resolvePiConnectionApiKeyScope(pi) !== '';
}

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
        ...(backend === 'pi' && pi_snapshot !== undefined ? { pi: pi_snapshot } : {}),
    };
}

export function applyExtraModelApiProfile(
    config: ExtraModelApiProfileFields,
    profile: ExtraModelApiProfile
): ExtraModelApiProfileFields {
    const normalized_profile = normalizeExtraModelApiProfile(profile);
    const result: ExtraModelApiProfileFields = {
        ...config,
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

export function removeExtraModelApiProfile(
    profiles: ExtraModelApiProfile[],
    profile_name: string
): ExtraModelApiProfile[] {
    const normalized_name = normalizeExtraModelApiProfileName(profile_name);
    return normalizeExtraModelApiProfileList(profiles).filter(
        profile => profile.名称 !== normalized_name
    );
}

export function hasExtraModelApiProfile(
    profiles: ExtraModelApiProfile[],
    profile_name: string
): boolean {
    const normalized_name = normalizeExtraModelApiProfileName(profile_name);
    return normalizeExtraModelApiProfileList(profiles).some(
        profile => profile.名称 === normalized_name
    );
}

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

export function migrateExtraModelApiProfiles<T extends ExtraModelApiProfileFields>(config: T): T {
    let migrated = {
        ...config,
        api方案列表: normalizeExtraModelApiProfileList(config.api方案列表),
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
