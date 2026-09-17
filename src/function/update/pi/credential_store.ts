import { useDataStore } from '@/store';
import { resolvePiCredentialReferences, type PiCredentialReferences } from './credential_refs';
import type {
    AuthOperationOptions,
    Credential,
    CredentialInfo,
    CredentialStore,
    OAuthCredential,
} from './pi_gateway';

/** 按凭证编号排队执行的凭证操作，进入队列前不提前读取或修改凭证。 */
type CredentialTask<T> = () => Promise<T>;

/** 复制 OAuth 凭证，避免调用方修改持久化对象本身。 */
function cloneOAuthCredential(credential: OAuthCredential): OAuthCredential {
    return { ...credential };
}

/**
 * 从宽松保存的设置中读取符合 Pi 契约的 OAuth 凭证。
 * 未知字段可以保留，但缺失或无效的 access、refresh 和 expires 不进入运行时。
 */
function readOAuthCredential(value: unknown): OAuthCredential | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }

    const candidate = value as Record<string, unknown>;
    if (
        candidate.type !== 'oauth' ||
        typeof candidate.access !== 'string' ||
        candidate.access.trim().length === 0 ||
        typeof candidate.refresh !== 'string' ||
        candidate.refresh.trim().length === 0 ||
        typeof candidate.expires !== 'number' ||
        !Number.isFinite(candidate.expires)
    ) {
        return undefined;
    }

    return cloneOAuthCredential(candidate as OAuthCredential);
}

/** 所有捕获同一设置仓库的适配器共用真实凭证编号的队列。 */
const storeChains = new WeakMap<object, Map<string, Promise<void>>>();
/** 登录和解绑的代次按所属连接记录，阻止已经退出的待完成登录重新绑定。 */
const bindingGenerations = new WeakMap<object, Map<string, number>>();

type DataStore = ReturnType<typeof useDataStore>;
type CredentialStoreHooks = {
    beforeWrite?: (providerId: string, credentialId: string) => void;
    /** 返回 false 时仅解除绑定，保留其他方案仍使用的集中凭证。 */
    beforeDelete?: (providerId: string, credentialId: string | undefined) => boolean;
};

/** 在读取或写入凭证前检查调用方是否已取消操作。 */
function throwIfAborted(options?: AuthOperationOptions): void {
    options?.signal?.throwIfAborted();
}

/** 取消时立即结束调用方等待，同时允许内部串行任务安全收尾。 */
function raceWithAbort<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal === undefined) {
        return task;
    }

    if (signal.aborted) {
        return Promise.reject(signal.reason);
    }
    return new Promise<T>((resolve, reject) => {
        /** 解除取消监听并使用原始取消原因拒绝等待中的调用。 */
        const onAbort = () => {
            signal.removeEventListener('abort', onAbort);
            reject(signal.reason);
        };
        signal.addEventListener('abort', onAbort, { once: true });

        task.then(
            value => {
                signal.removeEventListener('abort', onAbort);
                resolve(value);
            },
            error => {
                signal.removeEventListener('abort', onAbort);
                reject(error);
            }
        );
    });
}

/**
 * 创建基于设置持久化的 OAuth 凭证仓库。
 * 同一凭证编号的修改和删除串行执行，写入前复查取消状态，避免刷新覆盖登出或新凭证。
 */
export function createPiCredentialStore(
    credentialIds?: PiCredentialReferences,
    dataStore: DataStore = useDataStore(),
    hooks: CredentialStoreHooks = {}
): CredentialStore {
    const references = credentialIds === undefined ? undefined : { ...credentialIds };
    const getPersistedCredentials = () => dataStore.settings.额外模型解析配置.pi.credentials;
    const resolveId = (providerId: string) =>
        references === undefined ? providerId : references[providerId];
    const chains = storeChains.get(dataStore) ?? new Map<string, Promise<void>>();
    storeChains.set(dataStore, chains);

    /** 按凭证编号串行安排凭证修改；前序失败不阻塞后续任务，取消后也保持队列顺序。 */
    const enqueue = <T>(
        providerId: string,
        task: CredentialTask<T>,
        options?: AuthOperationOptions
    ): Promise<T> => {
        const previous = chains.get(providerId) ?? Promise.resolve();
        const queued = (async () => {
            throwIfAborted(options);
            await previous.catch(() => undefined);
            throwIfAborted(options);
            return task();
        })();
        const tail = queued.then(
            () => undefined,
            () => undefined
        );
        chains.set(providerId, tail);
        void tail.then(() => {
            if (chains.get(providerId) === tail) {
                chains.delete(providerId);
            }
        });

        return raceWithAbort(queued, options?.signal);
    };

    return {
        /** 读取并返回有效凭证的副本，忽略仓库中无法识别的记录。 */
        async read(
            providerId: string,
            options?: AuthOperationOptions
        ): Promise<Credential | undefined> {
            throwIfAborted(options);
            const credentialId = resolveId(providerId);
            const credential =
                credentialId === undefined
                    ? undefined
                    : readOAuthCredential(getPersistedCredentials()[credentialId]);
            return credential === undefined ? undefined : cloneOAuthCredential(credential);
        },

        /** 列出有效 OAuth 凭证的服务商和类型，不向列表调用方暴露令牌内容。 */
        async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
            throwIfAborted(options);
            const ids =
                references ??
                Object.fromEntries(Object.keys(getPersistedCredentials()).map(id => [id, id]));
            return Object.entries(ids).flatMap(([providerId, credentialId]) =>
                readOAuthCredential(getPersistedCredentials()[credentialId]) === undefined
                    ? []
                    : [{ providerId, type: 'oauth' as const }]
            );
        },

        /** 在凭证队列内读取、更新并保存凭证，提交前再次检查取消信号。 */
        modify(
            providerId: string,
            fn: (current: Credential | undefined) => Promise<Credential | undefined>,
            options?: AuthOperationOptions
        ): Promise<Credential | undefined> {
            const credentialId = resolveId(providerId);
            if (credentialId === undefined) {
                return Promise.reject(new Error('No OAuth credential is bound to this connection'));
            }
            return enqueue(
                credentialId,
                async () => {
                    const current = readOAuthCredential(getPersistedCredentials()[credentialId]);
                    const next = await fn(
                        current === undefined ? undefined : cloneOAuthCredential(current)
                    );
                    throwIfAborted(options);

                    if (next === undefined) {
                        return current === undefined ? undefined : cloneOAuthCredential(current);
                    }

                    const oauth = readOAuthCredential(next);
                    if (oauth === undefined) {
                        throw new TypeError(
                            'More source credential store only persists valid OAuth credentials'
                        );
                    }

                    const persisted = cloneOAuthCredential(oauth);
                    hooks.beforeWrite?.(providerId, credentialId);
                    getPersistedCredentials()[credentialId] = persisted;
                    return cloneOAuthCredential(persisted);
                },
                options
            );
        },

        /** 在同一凭证队列中删除凭证，与自动或手动刷新保持确定的先后顺序。 */
        delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
            const credentialId = resolveId(providerId);
            if (credentialId === undefined) {
                return Promise.resolve().then(() => {
                    throwIfAborted(options);
                    hooks.beforeDelete?.(providerId, undefined);
                });
            }
            return enqueue(
                credentialId,
                async () => {
                    throwIfAborted(options);
                    if (hooks.beforeDelete?.(providerId, credentialId) !== false) {
                        delete getPersistedCredentials()[credentialId];
                    }
                },
                options
            );
        },
    };
}

/** 捕获操作发起时所属的方案及活动连接，回调提交前复核原引用。 */
function captureBinding(dataStore: DataStore) {
    const config = dataStore.settings.额外模型解析配置;
    const profileName = config.当前api方案;
    const profile = config.api方案列表.find(
        item => item.名称 === profileName && item.backend === 'pi'
    );
    const activeReferences = resolvePiCredentialReferences(config.pi, config.pi.credentials);
    const profileReferences =
        profile?.pi === undefined
            ? undefined
            : resolvePiCredentialReferences(profile.pi, config.pi.credentials);
    const source = config.模型来源;
    const provider = config.pi.provider;
    const authType = config.pi.authType;
    const generations = bindingGenerations.get(dataStore) ?? new Map<string, number>();
    bindingGenerations.set(dataStore, generations);
    const scope = JSON.stringify([profileName, source, provider, authType]);
    const observedGenerations = new Map(generations);

    /** 仅修改发起操作时的所属方案；活动连接只有仍绑定原值时才同步更新。 */
    const replace = (providerId: string, nextId: string | undefined) => {
        const generationKey = `${scope}:${providerId}`;
        const generation = observedGenerations.get(generationKey) ?? 0;
        if ((generations.get(generationKey) ?? 0) !== generation) {
            throw new Error('The OAuth connection was changed by another authentication operation');
        }
        const current = dataStore.settings.额外模型解析配置;
        const target =
            profileReferences === undefined
                ? undefined
                : current.api方案列表.find(
                      item => item.名称 === profileName && item.backend === 'pi'
                  );
        const isActive =
            current.当前api方案 === profileName &&
            current.模型来源 === source &&
            current.pi.provider === provider &&
            current.pi.authType === authType;
        const currentRefs = resolvePiCredentialReferences(current.pi, current.pi.credentials);
        const targetRefs =
            target?.pi === undefined
                ? undefined
                : resolvePiCredentialReferences(target.pi, current.pi.credentials);
        if (isActive && currentRefs[providerId] !== activeReferences[providerId]) {
            throw new Error('The active OAuth credential changed while authentication was pending');
        }
        if (profileReferences !== undefined) {
            if (!target?.pi || targetRefs?.[providerId] !== profileReferences[providerId]) {
                throw new Error('The OAuth profile changed while authentication was pending');
            }
        } else if (!isActive || currentRefs[providerId] !== activeReferences[providerId]) {
            throw new Error('The OAuth connection changed while authentication was pending');
        }
        const updated = (refs: PiCredentialReferences) => {
            const result = { ...refs };
            if (nextId === undefined) delete result[providerId];
            else result[providerId] = nextId;
            return result;
        };
        generations.set(generationKey, generation + 1);
        if (target?.pi && targetRefs) target.pi.credentialIds = updated(targetRefs);
        if (isActive && currentRefs[providerId] === activeReferences[providerId]) {
            current.pi.credentialIds = updated(currentRefs);
        }
    };
    return { references: activeReferences, replace };
}

/** 是否仍有方案或活动连接引用该凭证；未迁移的旧方案也参与引用检查。 */
function isCredentialReferenced(dataStore: DataStore, credentialId: string): boolean {
    const config = dataStore.settings.额外模型解析配置;
    const connections = [
        config.pi,
        ...config.api方案列表.flatMap(profile =>
            profile.backend === 'pi' && profile.pi ? [profile.pi] : []
        ),
    ];
    return connections.some(pi =>
        Object.values(resolvePiCredentialReferences(pi, config.pi.credentials)).includes(
            credentialId
        )
    );
}

/** 捕获当前连接的凭证引用；随后切换方案不会改变此对象读写的账号。 */
export function getPiCredentialStore(pi?: { credentialIds?: unknown }): CredentialStore {
    const dataStore = useDataStore();
    const settings = dataStore.settings.额外模型解析配置.pi;
    const references = resolvePiCredentialReferences(pi ?? settings, settings.credentials);
    return createPiCredentialStore(references, dataStore);
}

/** 捕获退出登录的所属方案，仅解绑该方案，最后一个引用消失后才删除集中凭证。 */
export function createPiOAuthLogoutStore(): CredentialStore {
    const dataStore = useDataStore();
    const binding = captureBinding(dataStore);
    return createPiCredentialStore(binding.references, dataStore, {
        beforeDelete(providerId, credentialId) {
            binding.replace(providerId, undefined);
            return credentialId !== undefined && !isCredentialReferenced(dataStore, credentialId);
        },
    });
}

/** 为登录结果分配全新记录，成功提交时才绑定原方案，避免覆盖其他账号或失败时丢失旧登录态。 */
export function createPiOAuthLoginStore(providerId: string, nonce: string): CredentialStore {
    const dataStore = useDataStore();
    const binding = captureBinding(dataStore);
    const id = `oauth:${encodeURIComponent(providerId)}:${nonce}`;
    return createPiCredentialStore({ [providerId]: id }, dataStore, {
        beforeWrite(writtenProvider, credentialId) {
            binding.replace(writtenProvider, credentialId);
        },
    });
}
