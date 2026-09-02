import { useDataStore } from '@/store';
import type {
    AuthOperationOptions,
    Credential,
    CredentialInfo,
    CredentialStore,
    OAuthCredential,
} from './pi_gateway';

type CredentialTask<T> = () => Promise<T>;

function cloneOAuthCredential(credential: OAuthCredential): OAuthCredential {
    return { ...credential };
}

/**
 * The settings schema intentionally accepts unknown persisted values so a newer MVU version does
 * not destroy credentials it cannot understand. The runtime boundary is stricter: only canonical
 * OAuth credentials are ever exposed to pi-ai.
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

function getPersistedCredentials(): Record<string, unknown> {
    return useDataStore().settings.额外模型解析配置.pi.credentials;
}

function throwIfAborted(options?: AuthOperationOptions): void {
    options?.signal?.throwIfAborted();
}

/** Reject promptly on cancellation while allowing the serialized task to settle safely. */
function raceWithAbort<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal === undefined) {
        return task;
    }

    if (signal.aborted) {
        return Promise.reject(signal.reason);
    }
    return new Promise<T>((resolve, reject) => {
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

export function createPiCredentialStore(): CredentialStore {
    const chains = new Map<string, Promise<void>>();

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
        async read(
            providerId: string,
            options?: AuthOperationOptions
        ): Promise<Credential | undefined> {
            throwIfAborted(options);
            const credential = readOAuthCredential(getPersistedCredentials()[providerId]);
            return credential === undefined ? undefined : cloneOAuthCredential(credential);
        },

        async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
            throwIfAborted(options);
            return Object.entries(getPersistedCredentials()).flatMap(([providerId, value]) =>
                readOAuthCredential(value) === undefined
                    ? []
                    : [{ providerId, type: 'oauth' as const }]
            );
        },

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
                            'MVU pi CredentialStore only persists valid OAuth credentials'
                        );
                    }

                    const persisted = cloneOAuthCredential(oauth);
                    getPersistedCredentials()[providerId] = persisted;
                    return cloneOAuthCredential(persisted);
                },
                options
            );
        },

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

/** Shared runtime store. It resolves the active Pinia store anew for every operation. */
export function getPiCredentialStore(): CredentialStore {
    credentialStore ??= createPiCredentialStore();
    return credentialStore;
}
