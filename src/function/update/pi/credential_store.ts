import { useDataStore } from '@/store';
import type {
    AuthOperationOptions,
    Credential,
    CredentialInfo,
    CredentialStore,
    OAuthCredential,
} from './pi_gateway';

/** 按服务商排队执行的凭证操作，进入队列前不提前读取或修改凭证。 */
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

/** 每次操作重新获取当前 Pinia 仓库中的凭证表，避免缓存过期的响应式引用。 */
function getPersistedCredentials(): Record<string, unknown> {
    return useDataStore().settings.额外模型解析配置.pi.credentials;
}

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
 * 同一服务商的修改和删除串行执行，写入前复查取消状态，避免刷新覆盖登出或新凭证。
 */
export function createPiCredentialStore(): CredentialStore {
    const chains = new Map<string, Promise<void>>();

    /** 按服务商串行安排凭证修改；前序失败不阻塞后续任务，取消后也保持队列顺序。 */
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
            const credential = readOAuthCredential(getPersistedCredentials()[providerId]);
            return credential === undefined ? undefined : cloneOAuthCredential(credential);
        },

        /** 列出有效 OAuth 凭证的服务商和类型，不向列表调用方暴露令牌内容。 */
        async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
            throwIfAborted(options);
            return Object.entries(getPersistedCredentials()).flatMap(([providerId, value]) =>
                readOAuthCredential(value) === undefined
                    ? []
                    : [{ providerId, type: 'oauth' as const }]
            );
        },

        /** 在服务商队列内读取、更新并保存凭证，提交前再次检查取消信号。 */
        modify(
            providerId: string,
            fn: (current: Credential | undefined) => Promise<Credential | undefined>,
            options?: AuthOperationOptions
        ): Promise<Credential | undefined> {
            return enqueue(
                providerId,
                async () => {
                    const current = readOAuthCredential(getPersistedCredentials()[providerId]);
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
                    getPersistedCredentials()[providerId] = persisted;
                    return cloneOAuthCredential(persisted);
                },
                options
            );
        },

        /** 在同一服务商队列中删除凭证，与自动或手动刷新保持确定的先后顺序。 */
        delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
            return enqueue(
                providerId,
                async () => {
                    throwIfAborted(options);
                    delete getPersistedCredentials()[providerId];
                },
                options
            );
        },
    };
}

let credentialStore: CredentialStore | undefined;

/** 返回运行时共用的凭证仓库；具体 Pinia 设置在每次操作时重新解析。 */
export function getPiCredentialStore(): CredentialStore {
    credentialStore ??= createPiCredentialStore();
    return credentialStore;
}
