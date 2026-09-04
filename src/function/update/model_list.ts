import { getPiCredentialStore } from '@/function/update/pi/credential_store';
import { parsePiCustomHeaders } from '@/function/update/pi/config_parser';
import { getBrowserOAuthAuth } from '@/function/update/pi/oauth';
import {
    createModels,
    createProvider,
    type Api,
    type AuthContext,
    type OAuthCredential,
} from '@/function/update/pi/pi_gateway';
import {
    createPiApiImplementations,
    getPiCatalogModels,
    getPiProviderDefinition,
    isPiCatalogModelApiCompatible,
    OPENAI_CODEX_ADAPTER_CLIENT_VERSION,
    shouldUsePiCorsProxy,
    type PiAuthType,
    type PiProviderDefinition,
    type PiProviderKey,
    type PiWireApi,
} from '@/function/update/pi/provider_registry';
import {
    getPiProviderApiBaseUrl,
    normalizePiApiBaseEndpoint,
} from '@/function/update/pi/provider_target';
import {
    assertSillyTavernProxyAvailable,
    createSillyTavernProxyFetch,
    PiProxyUnavailableError,
} from '@/function/update/pi/sillytavern_proxy';
import { normalizeBaseURL } from '@/util';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ModelListFetchDependencies {
    fetch?: FetchLike;
    sillyTavernRequestHeaders?: () => HeadersInit;
}

export interface PiModelListOAuthCredential {
    accessToken: string;
    accountId?: string;
    expiresAt: number;
}

export interface FetchPiModelListInput {
    provider: string;
    api: string;
    authType: string;
    endpoint: string;
    apiKey?: string;
    customHeaders?: string;
    useProxy?: boolean;
    oauthCredential?: PiModelListOAuthCredential;
    signal?: AbortSignal;
}

export class ModelListFetchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ModelListFetchError';
    }
}

const BROWSER_AUTH_CONTEXT: AuthContext = Object.freeze({
    env: async () => undefined,
    fileExists: async () => false,
});
const MAX_MODEL_LIST_PAGES = 100;

type OpenAIModelDiscoveryDefinition = Readonly<{
    baseUrl: string;
    headers?: Readonly<Record<string, string>>;
}>;

/**
 * Providers whose generation protocol is not also their model-list protocol. These endpoints all
 * expose the OpenAI `{ data: [{ id }] }` shape and therefore use the same SillyTavern discovery
 * bridge as the Custom source, regardless of the selected generation API.
 */
const OPENAI_MODEL_DISCOVERY: Readonly<
    Partial<Record<PiProviderKey, OpenAIModelDiscoveryDefinition>>
> = Object.freeze({
    fireworks: Object.freeze({ baseUrl: 'https://api.fireworks.ai/inference/v1' }),
    'github-copilot': Object.freeze({
        baseUrl: 'https://api.individual.githubcopilot.com',
        headers: Object.freeze({
            'User-Agent': 'GitHubCopilotChat/0.35.0',
            'Editor-Version': 'vscode/1.107.0',
            'Editor-Plugin-Version': 'copilot-chat/0.35.0',
            'Copilot-Integration-Id': 'vscode-chat',
            'X-GitHub-Api-Version': '2026-06-01',
        }),
    }),
    opencode: Object.freeze({ baseUrl: 'https://opencode.ai/zen/v1' }),
    'opencode-go': Object.freeze({ baseUrl: 'https://opencode.ai/zen/go/v1' }),
    'vercel-ai-gateway': Object.freeze({ baseUrl: 'https://ai-gateway.vercel.sh/v1' }),
});

type NullableHeaders = Record<string, string | null>;

function getFetch(dependencies: ModelListFetchDependencies): FetchLike {
    const fetch_impl = dependencies.fetch ?? globalThis.fetch;
    if (typeof fetch_impl !== 'function') {
        throw new ModelListFetchError('The browser Fetch API is unavailable.');
    }
    return fetch_impl.bind(globalThis) as FetchLike;
}

function normalizeModelIds(values: readonly unknown[]): string[] {
    return [...new Set(values.flatMap(value => (typeof value === 'string' ? [value.trim()] : [])))]
        .filter(Boolean)
        .sort();
}

/**
 * Shared `/models` routes may return IDs belonging to several generation protocols. Drop only a
 * known catalog ID that is incompatible with the active protocol; retain unknown IDs so newly
 * published models remain manually usable with an explicit context window.
 */
function filterDiscoveredModelIds(
    definition: PiProviderDefinition,
    api: PiWireApi,
    model_ids: readonly string[]
): string[] {
    const catalog_by_id = new Map(
        getPiCatalogModels(definition.key).map(model => [model.id, model] as const)
    );
    return model_ids.filter(model_id => {
        const catalog_model = catalog_by_id.get(model_id);
        return (
            catalog_model === undefined ||
            isPiCatalogModelApiCompatible(definition, catalog_model, api)
        );
    });
}

function requireRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ModelListFetchError('The model-list response is not a JSON object.');
    }
    return value as Record<string, unknown>;
}

function requireArray(value: unknown): unknown[] {
    if (!Array.isArray(value)) {
        throw new ModelListFetchError('The model-list response does not contain a model array.');
    }
    return value;
}

function readStringField(value: unknown, ...fields: string[]): string | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    for (const field of fields) {
        if (typeof record[field] === 'string') {
            return record[field];
        }
    }
    return undefined;
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
    if (!response.ok) {
        throw new ModelListFetchError(
            `The model-list request failed with HTTP ${response.status || 'error'}.`
        );
    }
    try {
        return requireRecord(await response.json());
    } catch (error) {
        if (error instanceof ModelListFetchError) {
            throw error;
        }
        throw new ModelListFetchError('The model-list response is not valid JSON.');
    }
}

function appendPath(base_url: string, path: string): string {
    return `${base_url.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function parseModelListCustomHeaders(value: string | undefined): NullableHeaders | undefined {
    try {
        return parsePiCustomHeaders(value ?? '');
    } catch {
        throw new ModelListFetchError('The custom model-list request headers are invalid.');
    }
}

/** Merge headers case-insensitively; later sources override or remove earlier values. */
function mergeModelListHeaders(
    ...sources: readonly (Readonly<NullableHeaders> | undefined)[]
): Record<string, string> {
    const merged = new Map<string, { name: string; value: string }>();
    for (const source of sources) {
        for (const [raw_name, value] of Object.entries(source ?? {})) {
            const name = raw_name.trim();
            if (!name) {
                continue;
            }
            const key = name.toLowerCase();
            if (value === null) {
                merged.delete(key);
            } else {
                merged.set(key, { name, value });
            }
        }
    }
    return Object.fromEntries([...merged.values()].map(({ name, value }) => [name, value]));
}

/** The same SillyTavern OpenAI-compatible discovery path used by the Custom source. */
async function fetchSillyTavernOpenAIModelList(
    base_url: string,
    api_key: string,
    signal: AbortSignal | undefined,
    dependencies: ModelListFetchDependencies = {},
    custom_headers?: NullableHeaders
): Promise<string[]> {
    if (!base_url) {
        return [];
    }

    const body =
        custom_headers === undefined
            ? {
                  reverse_proxy: base_url,
                  proxy_password: api_key,
                  chat_completion_source: 'openai',
              }
            : {
                  custom_url: base_url,
                  custom_include_headers: JSON.stringify(
                      mergeModelListHeaders(custom_headers, {
                          Authorization: `Bearer ${api_key}`,
                      })
                  ),
                  chat_completion_source: 'custom',
              };
    const response = await getFetch(dependencies)('/api/backends/chat-completions/status', {
        method: 'POST',
        headers: dependencies.sillyTavernRequestHeaders?.() ?? {},
        body: JSON.stringify(body),
        cache: 'no-cache',
        signal,
    });
    const json = await readJsonResponse(response);
    return normalizeModelIds(
        requireArray(json.data).map(model => readStringField(model, 'id', 'name'))
    );
}

/** Preserve the legacy Custom-source behavior that infers an omitted `/v1` base path. */
export function fetchOpenAICompatibleModelList(
    base_url: string,
    api_key: string,
    signal: AbortSignal | undefined,
    dependencies: ModelListFetchDependencies = {}
): Promise<string[]> {
    return fetchSillyTavernOpenAIModelList(
        normalizeBaseURL(base_url),
        api_key,
        signal,
        dependencies
    );
}

function validatePiModelListTarget(input: FetchPiModelListInput): {
    definition: PiProviderDefinition;
    api: PiWireApi;
    authType: PiAuthType;
    baseUrl: string;
    useCorsProxy: boolean;
} {
    const definition = getPiProviderDefinition(input.provider);
    if (!definition) {
        throw new ModelListFetchError('The selected model provider is unknown.');
    }
    if (!definition.allowedApis.includes(input.api as PiWireApi)) {
        throw new ModelListFetchError('The selected provider does not support this API protocol.');
    }
    if (!definition.allowedAuthTypes.includes(input.authType as PiAuthType)) {
        throw new ModelListFetchError(
            'The selected provider does not support this authentication method.'
        );
    }
    if (input.authType === 'oauth' && input.endpoint.trim() !== '') {
        throw new ModelListFetchError('OAuth model discovery cannot use a custom endpoint.');
    }
    if (input.endpoint.trim() !== '' && !definition.allowCustomEndpoint) {
        throw new ModelListFetchError('This provider does not allow a custom endpoint.');
    }

    const api = input.api as PiWireApi;
    return {
        definition,
        api,
        authType: input.authType as PiAuthType,
        baseUrl: normalizePiApiBaseEndpoint(
            api,
            input.endpoint.trim() || getPiProviderApiBaseUrl(definition, api)
        ),
        useCorsProxy: shouldUsePiCorsProxy(definition, api, input.endpoint, input.useProxy),
    };
}

function authHeaders(input: FetchPiModelListInput): Record<string, string> {
    if (input.authType === 'oauth') {
        const access_token = input.oauthCredential?.accessToken.trim();
        if (!access_token) {
            throw new ModelListFetchError('Sign in before fetching the model list.');
        }
        return { Authorization: `Bearer ${access_token}` };
    }
    return input.apiKey?.trim() ? { 'x-api-key': input.apiKey.trim() } : {};
}

async function fetchAnthropicModelList(
    input: FetchPiModelListInput,
    base_url: string,
    dependencies: ModelListFetchDependencies,
    custom_headers: NullableHeaders | undefined
): Promise<string[]> {
    const fetch_impl = getFetch(dependencies);
    const ids: unknown[] = [];
    let after_id = '';

    for (let page = 0; page < MAX_MODEL_LIST_PAGES; page += 1) {
        input.signal?.throwIfAborted();
        const url = new URL(appendPath(base_url, 'v1/models'));
        url.searchParams.set('limit', '100');
        if (after_id) {
            url.searchParams.set('after_id', after_id);
        }
        const response = await fetch_impl(url, {
            method: 'GET',
            headers: mergeModelListHeaders(
                {
                    Accept: 'application/json',
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true',
                    ...(input.authType === 'oauth'
                        ? {
                              'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
                              'x-app': 'cli',
                          }
                        : {}),
                },
                custom_headers,
                authHeaders(input)
            ),
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            signal: input.signal,
        });
        const json = await readJsonResponse(response);
        const page_models = requireArray(json.data);
        ids.push(...page_models.map(model => readStringField(model, 'id', 'name')));

        if (json.has_more !== true) {
            return normalizeModelIds(ids);
        }
        const next_after_id = readStringField(json, 'last_id')?.trim();
        if (!next_after_id || next_after_id === after_id) {
            throw new ModelListFetchError('The Anthropic model list returned invalid pagination.');
        }
        after_id = next_after_id;
    }

    throw new ModelListFetchError('The Anthropic model list exceeded the pagination limit.');
}

async function fetchGoogleModelList(
    input: FetchPiModelListInput,
    base_url: string,
    dependencies: ModelListFetchDependencies,
    custom_headers: NullableHeaders | undefined
): Promise<string[]> {
    const fetch_impl = getFetch(dependencies);
    const ids: unknown[] = [];
    let page_token = '';

    for (let page = 0; page < MAX_MODEL_LIST_PAGES; page += 1) {
        input.signal?.throwIfAborted();
        const url = new URL(appendPath(base_url, 'models'));
        url.searchParams.set('pageSize', '1000');
        if (page_token) {
            url.searchParams.set('pageToken', page_token);
        }
        const response = await fetch_impl(url, {
            method: 'GET',
            headers: mergeModelListHeaders(
                { Accept: 'application/json' },
                custom_headers,
                input.apiKey?.trim() ? { 'x-goog-api-key': input.apiKey.trim() } : undefined
            ),
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            signal: input.signal,
        });
        const json = await readJsonResponse(response);
        const page_models = requireArray(json.models);
        ids.push(
            ...page_models.flatMap(model => {
                if (typeof model !== 'object' || model === null || Array.isArray(model)) {
                    return [];
                }
                const methods = (model as Record<string, unknown>).supportedGenerationMethods;
                if (Array.isArray(methods) && !methods.includes('generateContent')) {
                    return [];
                }
                const name = readStringField(model, 'name');
                return name ? [name.trim().replace(/^models\//, '')] : [];
            })
        );

        const next_page_token =
            typeof json.nextPageToken === 'string' ? json.nextPageToken.trim() : '';
        if (!next_page_token) {
            return normalizeModelIds(ids);
        }
        if (next_page_token === page_token) {
            throw new ModelListFetchError('The Google model list returned invalid pagination.');
        }
        page_token = next_page_token;
    }

    throw new ModelListFetchError('The Google model list exceeded the pagination limit.');
}

/** Fetch the Mistral catalog directly; its conversations base omits `/v1`. */
async function fetchMistralModelList(
    input: FetchPiModelListInput,
    base_url: string,
    dependencies: ModelListFetchDependencies,
    custom_headers: NullableHeaders | undefined
): Promise<string[]> {
    const api_key = input.apiKey?.trim();
    const response = await getFetch(dependencies)(new URL(appendPath(base_url, 'v1/models')), {
        method: 'GET',
        headers: mergeModelListHeaders(
            { Accept: 'application/json' },
            custom_headers,
            api_key ? { Authorization: `Bearer ${api_key}` } : undefined
        ),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: input.signal,
    });
    const json = await readJsonResponse(response);
    return normalizeModelIds(
        requireArray(json.data).map(model => readStringField(model, 'id', 'name'))
    );
}

async function fetchCodexModelList(
    input: FetchPiModelListInput,
    base_url: string,
    dependencies: ModelListFetchDependencies,
    custom_headers: NullableHeaders | undefined
): Promise<string[]> {
    const { accessToken: access_token, accountId: account_id } =
        requireCodexModelListCredential(input);

    const url = new URL(appendPath(base_url, 'codex/models'));
    url.searchParams.set('client_version', OPENAI_CODEX_ADAPTER_CLIENT_VERSION);
    const response = await getFetch(dependencies)(url, {
        method: 'GET',
        headers: mergeModelListHeaders({ Accept: 'application/json' }, custom_headers, {
            Authorization: `Bearer ${access_token}`,
            'chatgpt-account-id': account_id,
            originator: 'pi',
        }),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: input.signal,
    });
    const json = await readJsonResponse(response);
    return normalizeModelIds(
        requireArray(json.models).flatMap(model => {
            if (typeof model !== 'object' || model === null || Array.isArray(model)) {
                return [];
            }
            const record = model as Record<string, unknown>;
            // ChatGPT OAuth uses the subscription catalog: the picker exposes only entries marked
            // `list`. `supported_in_api` describes a different API-key surface and can be false for
            // models that remain valid on the Codex subscription backend.
            if (record.visibility !== 'list') {
                return [];
            }
            return [readStringField(record, 'slug', 'id', 'name')];
        })
    );
}

function requireCodexModelListCredential(input: FetchPiModelListInput): {
    accessToken: string;
    accountId: string;
} {
    const access_token = input.oauthCredential?.accessToken.trim();
    const account_id = input.oauthCredential?.accountId?.trim();
    if (!access_token || !account_id) {
        throw new ModelListFetchError('Sign in to OpenAI Codex before fetching the model list.');
    }
    return { accessToken: access_token, accountId: account_id };
}

function isOpenRouter(base_url: string): boolean {
    return new URL(base_url).hostname.toLowerCase() === 'openrouter.ai';
}

/** Fetch provider-visible model IDs for the active More-source connection. */
export async function fetchPiModelList(
    input: FetchPiModelListInput,
    dependencies: ModelListFetchDependencies = {}
): Promise<string[]> {
    try {
        const target = validatePiModelListTarget(input);
        const custom_headers = parseModelListCustomHeaders(input.customHeaders);
        if (target.definition.key === 'openai-codex') {
            requireCodexModelListCredential(input);
        }
        if (target.useCorsProxy) {
            await assertSillyTavernProxyAvailable({
                fetch: dependencies.fetch,
                signal: input.signal,
                force: true,
            });
        }
        const provider_dependencies: ModelListFetchDependencies = target.useCorsProxy
            ? {
                  ...dependencies,
                  fetch: createSillyTavernProxyFetch({
                      baseUrl: target.baseUrl,
                      ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
                  }),
              }
            : dependencies;
        let model_ids: string[];
        if (target.definition.key === 'openai-codex') {
            model_ids = await fetchCodexModelList(
                input,
                target.baseUrl,
                provider_dependencies,
                custom_headers
            );
        } else if (OPENAI_MODEL_DISCOVERY[target.definition.key]) {
            const discovery = OPENAI_MODEL_DISCOVERY[target.definition.key]!;
            model_ids = await fetchSillyTavernOpenAIModelList(
                discovery.baseUrl,
                input.apiKey ?? '',
                input.signal,
                dependencies,
                discovery.headers
                    ? mergeModelListHeaders(discovery.headers, custom_headers)
                    : custom_headers
            );
        } else if (target.definition.key === 'anthropic' && isOpenRouter(target.baseUrl)) {
            // Keep the existing convenience for an Anthropic source pointed at OpenRouter: its
            // catalog is exposed through OpenRouter's OpenAI-compatible `/models` route.
            const openrouter_base_url = `${new URL(target.baseUrl).origin}/api/v1`;
            model_ids = await fetchSillyTavernOpenAIModelList(
                openrouter_base_url,
                input.apiKey ?? '',
                input.signal,
                dependencies,
                custom_headers
            );
        } else {
            switch (target.api) {
                case 'openai-responses':
                case 'openai-completions':
                    model_ids = await fetchSillyTavernOpenAIModelList(
                        target.baseUrl,
                        input.apiKey ?? '',
                        input.signal,
                        dependencies,
                        custom_headers
                    );
                    break;
                case 'anthropic-messages':
                    model_ids = await fetchAnthropicModelList(
                        input,
                        target.baseUrl,
                        provider_dependencies,
                        custom_headers
                    );
                    break;
                case 'google-generative-ai':
                    model_ids = await fetchGoogleModelList(
                        input,
                        target.baseUrl,
                        provider_dependencies,
                        custom_headers
                    );
                    break;
                case 'mistral-conversations':
                    model_ids = await fetchMistralModelList(
                        input,
                        target.baseUrl,
                        provider_dependencies,
                        custom_headers
                    );
                    break;
                default:
                    // Provider validation currently makes this reachable only if another provider
                    // is registered for the Codex wire API without its OAuth discovery contract.
                    throw new ModelListFetchError('The selected model-list route is unavailable.');
            }
        }
        return filterDiscoveredModelIds(target.definition, target.api, model_ids);
    } catch (error) {
        if (
            input.signal?.aborted ||
            error instanceof ModelListFetchError ||
            error instanceof PiProxyUnavailableError
        ) {
            throw error;
        }
        throw new ModelListFetchError('The model-list request could not be completed.');
    }
}

/** Resolve and refresh the stored OAuth credential through the same pi auth machinery as requests. */
export async function resolvePiModelListOAuthCredential(
    definition: PiProviderDefinition,
    signal?: AbortSignal
): Promise<PiModelListOAuthCredential> {
    const credential_store = getPiCredentialStore();
    try {
        signal?.throwIfAborted();
        const models = createModels({
            credentials: credential_store,
            authContext: BROWSER_AUTH_CONTEXT,
        });
        models.setProvider(
            createProvider<Api>({
                id: definition.providerId,
                name: definition.displayName.en,
                baseUrl: definition.defaultBaseUrl,
                auth: { oauth: getBrowserOAuthAuth(definition.providerId) },
                models: getPiCatalogModels(definition.key),
                api: createPiApiImplementations(definition),
            })
        );
        // getAuth owns refresh serialization and persists the post-refresh credential. Read once
        // afterwards so access token, account ID, and expiry all come from the same snapshot even
        // if the user logs into another account concurrently.
        await models.getAuth(definition.providerId, { signal });
        signal?.throwIfAborted();
        const stored = await credential_store.read(definition.providerId, { signal });
        signal?.throwIfAborted();
        const oauth = stored?.type === 'oauth' ? (stored as OAuthCredential) : undefined;
        const access_token = oauth?.access.trim();
        if (!oauth || !access_token) {
            throw new ModelListFetchError('Sign in before fetching the model list.');
        }
        const account_id = typeof oauth?.accountId === 'string' ? oauth.accountId.trim() : '';
        return {
            accessToken: access_token,
            ...(account_id ? { accountId: account_id } : {}),
            expiresAt: oauth.expires,
        };
    } catch (error) {
        if (signal?.aborted || error instanceof ModelListFetchError) {
            throw error;
        }
        throw new ModelListFetchError('The saved OAuth credential could not be resolved.');
    }
}
