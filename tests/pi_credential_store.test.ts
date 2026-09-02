import {
    createPiCredentialStore,
    getPiCredentialStore,
} from '@/function/update/pi/credential_store';
import { useDataStore } from '@/store';
import type { Credential, OAuthCredential } from '@/function/update/pi/pi_gateway';
import { createPinia, setActivePinia } from 'pinia';

function oauth(access: string, extra: Record<string, unknown> = {}): OAuthCredential {
    return {
        type: 'oauth',
        access,
        refresh: `refresh-${access}`,
        expires: 1_900_000_000_000,
        ...extra,
    };
}

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

describe('pi CredentialStore', () => {
    beforeEach(() => {
        (globalThis as any).SillyTavern.extensionSettings = {};
    });

    test('strictly exposes valid OAuth credentials while preserving provider-specific fields', async () => {
        const credentials = useDataStore().settings.额外模型解析配置.pi.credentials;
        credentials.openai = oauth('access-openai', { accountId: 'account-1' });
        credentials.anthropic = {
            type: 'oauth',
            access: '',
            refresh: 'refresh-anthropic',
            expires: 1_900_000_000_000,
        };
        credentials.google = {
            type: 'oauth',
            access: 'access-google',
            refresh: 'refresh-google',
            expires: Number.POSITIVE_INFINITY,
        };
        credentials.future = { type: 'future-auth', opaque: true };

        const store = createPiCredentialStore();
        await expect(store.read('openai')).resolves.toEqual(
            oauth('access-openai', { accountId: 'account-1' })
        );
        await expect(store.read('anthropic')).resolves.toBeUndefined();
        await expect(store.read('google')).resolves.toBeUndefined();
        await expect(store.read('missing')).resolves.toBeUndefined();

        const read = (await store.read('openai')) as OAuthCredential;
        read.access = 'mutated-outside-store';
        await expect(store.read('openai')).resolves.toMatchObject({ access: 'access-openai' });
        expect(credentials.future).toEqual({ type: 'future-auth', opaque: true });
    });

    test('lists metadata only and never treats the legacy API key as a stored credential', async () => {
        const settings = useDataStore().settings.额外模型解析配置;
        settings.密钥 = 'legacy-api-key-secret';
        settings.pi.credentials.openai = oauth('access-secret');
        settings.pi.credentials.anthropic = {
            type: 'api_key',
            key: 'must-not-be-exposed',
        };

        const listed = await createPiCredentialStore().list();

        expect(listed).toEqual([{ providerId: 'openai', type: 'oauth' }]);
        expect(JSON.stringify(listed)).not.toContain('access-secret');
        expect(JSON.stringify(listed)).not.toContain('legacy-api-key-secret');
        expect(JSON.stringify(listed)).not.toContain('must-not-be-exposed');
    });

    test('serializes refreshes for one provider while allowing other providers to progress', async () => {
        const settings = useDataStore().settings.额外模型解析配置.pi;
        settings.credentials.openai = oauth('old');
        const store = createPiCredentialStore();
        const releaseFirst = deferred();
        const firstStarted = deferred();
        const secondStarted = deferred();
        const anthropicStarted = deferred();

        const first = store.modify('openai', async current => {
            expect(current).toMatchObject({ access: 'old' });
            firstStarted.resolve();
            await releaseFirst.promise;
            return oauth('first-refresh');
        });
        await firstStarted.promise;

        const secondCallback = jest.fn(async (current: Credential | undefined) => {
            secondStarted.resolve();
            expect(current).toMatchObject({ access: 'first-refresh' });
            return oauth('second-refresh');
        });
        const second = store.modify('openai', secondCallback);
        const otherProvider = store.modify('anthropic', async current => {
            expect(current).toBeUndefined();
            anthropicStarted.resolve();
            return oauth('anthropic');
        });

        await anthropicStarted.promise;
        expect(secondCallback).not.toHaveBeenCalled();
        expect(settings.credentials.openai).toMatchObject({ access: 'old' });
        await expect(otherProvider).resolves.toMatchObject({ access: 'anthropic' });

        releaseFirst.resolve();
        await expect(first).resolves.toMatchObject({ access: 'first-refresh' });
        await secondStarted.promise;
        await expect(second).resolves.toMatchObject({ access: 'second-refresh' });
        await expect(store.read('openai')).resolves.toMatchObject({ access: 'second-refresh' });
    });

    test('serializes delete behind an active modify', async () => {
        const credentials = useDataStore().settings.额外模型解析配置.pi.credentials;
        credentials.openai = oauth('old');
        const store = createPiCredentialStore();
        const started = deferred();
        const release = deferred();

        const refresh = store.modify('openai', async () => {
            started.resolve();
            await release.promise;
            return oauth('refreshed');
        });
        await started.promise;
        const deletion = store.delete('openai');

        expect(credentials.openai).toMatchObject({ access: 'old' });
        release.resolve();
        await refresh;
        await deletion;
        expect(credentials.openai).toBeUndefined();
    });

    test('returning undefined leaves the credential unchanged and invalid replacements are rejected', async () => {
        const credentials = useDataStore().settings.额外模型解析配置.pi.credentials;
        credentials.openai = oauth('old');
        const store = createPiCredentialStore();

        await expect(store.modify('openai', async () => undefined)).resolves.toMatchObject({
            access: 'old',
        });
        expect(credentials.openai).toMatchObject({ access: 'old' });

        const apiKey: Credential = { type: 'api_key', key: 'must-not-be-stored' };
        await expect(store.modify('openai', async () => apiKey)).rejects.toThrow(
            'only persists valid OAuth credentials'
        );
        expect(credentials.openai).toMatchObject({ access: 'old' });
        expect(JSON.stringify(credentials.openai)).not.toContain('must-not-be-stored');
    });

    test('honors cancellation before operations and while queued without overwriting credentials', async () => {
        const credentials = useDataStore().settings.额外模型解析配置.pi.credentials;
        credentials.openai = oauth('old');
        const store = createPiCredentialStore();
        const alreadyAborted = new AbortController();
        alreadyAborted.abort();

        await expect(store.read('openai', { signal: alreadyAborted.signal })).rejects.toMatchObject(
            {
                name: 'AbortError',
            }
        );
        await expect(store.list({ signal: alreadyAborted.signal })).rejects.toMatchObject({
            name: 'AbortError',
        });
        await expect(
            store.modify('openai', async () => oauth('forbidden'), {
                signal: alreadyAborted.signal,
            })
        ).rejects.toMatchObject({ name: 'AbortError' });
        await expect(
            store.delete('openai', { signal: alreadyAborted.signal })
        ).rejects.toMatchObject({ name: 'AbortError' });

        const release = deferred();
        const started = deferred();
        const first = store.modify('openai', async () => {
            started.resolve();
            await release.promise;
            return oauth('first');
        });
        await started.promise;

        const queuedController = new AbortController();
        const queuedFn = jest.fn(async () => oauth('cancelled'));
        const queued = store.modify('openai', queuedFn, { signal: queuedController.signal });
        queuedController.abort();
        await expect(queued).rejects.toMatchObject({ name: 'AbortError' });

        release.resolve();
        await first;
        await store.modify('openai', async current => current);
        expect(queuedFn).not.toHaveBeenCalled();
        await expect(store.read('openai')).resolves.toMatchObject({ access: 'first' });
    });

    test('aborting an active modify rejects promptly and prevents its eventual write', async () => {
        const credentials = useDataStore().settings.额外模型解析配置.pi.credentials;
        credentials.openai = oauth('old');
        const store = createPiCredentialStore();
        const controller = new AbortController();
        const started = deferred();
        const release = deferred();

        const modification = store.modify(
            'openai',
            async () => {
                started.resolve();
                await release.promise;
                return oauth('must-not-win');
            },
            { signal: controller.signal }
        );
        await started.promise;
        controller.abort();
        await expect(modification).rejects.toMatchObject({ name: 'AbortError' });
        expect(credentials.openai).toMatchObject({ access: 'old' });

        release.resolve();
        await store.modify('openai', async current => current);
        await expect(store.read('openai')).resolves.toMatchObject({ access: 'old' });
    });

    test('the shared singleton resolves the active Pinia store for each operation', async () => {
        const singleton = getPiCredentialStore();
        useDataStore().settings.额外模型解析配置.pi.credentials.openai = oauth('first-pinia');
        await expect(singleton.read('openai')).resolves.toMatchObject({ access: 'first-pinia' });

        setActivePinia(createPinia());
        (globalThis as any).SillyTavern.extensionSettings = {};
        useDataStore().settings.额外模型解析配置.pi.credentials.openai = oauth('second-pinia');

        await expect(singleton.read('openai')).resolves.toMatchObject({ access: 'second-pinia' });
    });
});
