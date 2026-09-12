/**
 * 测试场景：验证设置中的 OAuth 凭证读取与拷贝、按服务商串行修改、取消写入以及切换 Pinia 仓库。
 */
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

// 凭证仓库契约：只暴露合法 OAuth 凭证，同一服务商修改有序，不同服务商可独立推进。
describe('pi CredentialStore', () => {
    beforeEach(() => {
        (globalThis as any).SillyTavern.extensionSettings = {};
    });

    // 读取与列表：保留服务商扩展字段，列表只暴露元数据，不使用遗留 API Key 充当 OAuth 凭证。
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

    // 串行修改：刷新和删除共享服务商队列，无效更新不能覆盖已有凭证。
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

    // 取消与活动仓库：等待或执行中取消都阻止迟到写入，共享实例每次读取当前 Pinia。
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

    test('a captured store keeps its original Pinia and references after either changes', async () => {
        const firstPi = useDataStore().settings.额外模型解析配置.pi;
        firstPi.credentialIds = { openai: 'oauth:openai:first' };
        firstPi.credentials['oauth:openai:first'] = oauth('first-pinia');
        const captured = getPiCredentialStore();

        setActivePinia(createPinia());
        (globalThis as any).SillyTavern.extensionSettings = {};
        const secondPi = useDataStore().settings.额外模型解析配置.pi;
        secondPi.credentialIds = { openai: 'oauth:openai:second' };
        secondPi.credentials['oauth:openai:second'] = oauth('second-pinia');

        await expect(captured.read('openai')).resolves.toMatchObject({ access: 'first-pinia' });
        await expect(getPiCredentialStore().read('openai')).resolves.toMatchObject({
            access: 'second-pinia',
        });
        await captured.modify('openai', async () => oauth('first-refreshed'));
        expect(firstPi.credentials['oauth:openai:first']).toMatchObject({
            access: 'first-refreshed',
        });
        expect(secondPi.credentials['oauth:openai:second']).toMatchObject({
            access: 'second-pinia',
        });
    });

    test('different adapters share one credential queue while same-provider accounts remain independent', async () => {
        const pi = useDataStore().settings.额外模型解析配置.pi;
        pi.credentials['oauth:anthropic:shared'] = oauth('shared');
        pi.credentials['oauth:anthropic:other'] = oauth('other');
        const refs = { credentialIds: { anthropic: 'oauth:anthropic:shared' } };
        const first = getPiCredentialStore(refs);
        const alias = getPiCredentialStore(refs);
        const other = getPiCredentialStore({
            credentialIds: { anthropic: 'oauth:anthropic:other' },
        });
        const started = deferred();
        const release = deferred();
        const pending = first.modify('anthropic', async () => {
            started.resolve();
            await release.promise;
            return oauth('rotated-once');
        });
        await started.promise;
        const queuedFn = jest.fn(async (current: Credential | undefined) => {
            expect(current).toMatchObject({ access: 'rotated-once' });
            return undefined;
        });
        const queued = alias.modify('anthropic', queuedFn);
        await expect(
            other.modify('anthropic', async () => oauth('independent'))
        ).resolves.toMatchObject({ access: 'independent' });
        expect(queuedFn).not.toHaveBeenCalled();
        release.resolve();
        await pending;
        await queued;
        expect(Object.keys(pi.credentials)).toEqual([
            'oauth:anthropic:shared',
            'oauth:anthropic:other',
        ]);
        await expect(alias.list()).resolves.toEqual([{ providerId: 'anthropic', type: 'oauth' }]);
    });

    test('an explicitly empty or foreign-provider reference cannot inherit a legacy credential', async () => {
        const pi = useDataStore().settings.额外模型解析配置.pi;
        pi.credentials.anthropic = oauth('legacy');
        pi.credentials['oauth:openai-codex:account'] = oauth('foreign');
        await expect(getPiCredentialStore({}).read('anthropic')).resolves.toMatchObject({
            access: 'legacy',
        });
        await expect(
            getPiCredentialStore({ credentialIds: {} }).read('anthropic')
        ).resolves.toBeUndefined();
        await expect(
            getPiCredentialStore({
                credentialIds: { anthropic: 'oauth:openai-codex:account' },
            }).read('anthropic')
        ).resolves.toBeUndefined();
    });
});
