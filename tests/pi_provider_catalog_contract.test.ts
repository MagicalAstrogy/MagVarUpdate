/**
 * 测试场景：使用真实 Pi 模型目录核对全部 34 个预置服务商与运行时注册表的对应关系。
 */
const { execFileSync } = jest.requireActual(
    'node:child_process'
) as typeof import('node:child_process');
const { join } = jest.requireActual('node:path') as typeof import('node:path');

// 真实目录契约：服务商标识、模型所属协议和注册信息必须匹配。
describe('Pi preset provider catalog contract', () => {
    test('Argon catalogs send supported thinking levels through the Google proxy adapter', () => {
        const script = String.raw`
            import assert from 'node:assert/strict';
            import { getPiCatalogModels } from './src/function/update/pi/provider_registry.ts';
            import { createGoogleProxyAwareApi } from './src/function/update/pi/google_proxy_adapter.ts';
            import { googleGenerativeAIApi, normalizeContext } from './src/function/update/pi/pi_gateway.ts';
            globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
            const api = createGoogleProxyAwareApi(googleGenerativeAIApi());
            const context = normalizeContext({
                messages: [{ role: 'user', content: 'hello', timestamp: 0 }],
            });
            for (const [provider, id, baseUrl] of [
                ['google', 'gemini-4-argon', 'https://generativelanguage.googleapis.com/v1beta'],
                ['opencode', 'gemini-4-argon', 'https://opencode.ai/inference/v1'],
                ['opencode-go', 'gemini-4-argon-contributor', 'https://opencode.ai/inference/go/v1'],
            ]) {
                const model = getPiCatalogModels(provider).find(model => model.id === id);
                assert.ok(model, provider + ': missing Argon catalog entry');
                assert.equal(model.api, 'google-generative-ai');
                assert.equal(model.baseUrl, baseUrl);
                for (const [reasoning, expected] of [
                    [undefined, 'LOW'], ['off', 'LOW'], ['minimal', 'LOW'],
                    ['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'],
                    ['xhigh', 'HIGH'], ['max', 'HIGH'],
                ]) {
                    const requests = [];
                    const result = await api.streamSimple(model, context, {
                        apiKey: 'test-key', reasoning, maxRetries: 0,
                        fetch: async (url, init) => {
                            requests.push({ url: String(url), body: JSON.parse(init.body) });
                            const chunk = { candidates: [{
                                content: { role: 'model', parts: [{ text: 'ok' }] },
                                finishReason: 'STOP',
                            }] };
                            return new Response('data: ' + JSON.stringify(chunk) + '\n\n', {
                                headers: { 'content-type': 'text/event-stream' },
                            });
                        },
                    }).result();
                    assert.equal(result.stopReason, 'stop', result.errorMessage);
                    assert.equal(requests.length, 1);
                    assert.equal(requests[0].url, baseUrl + '/models/' + id + ':streamGenerateContent?alt=sse');
                    const thinking = requests[0].body.generationConfig.thinkingConfig;
                    assert.equal(thinking.thinkingLevel, expected, provider + '/' + reasoning);
                    assert.equal('thinkingBudget' in thinking, false);
                }
            }
        `;
        execFileSync(
            process.execPath,
            [
                '--experimental-strip-types',
                '--loader',
                join(process.cwd(), 'tests/helpers/typescript-extension-loader.mjs'),
                '--input-type=module',
                '--eval',
                script,
            ],
            { cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe', timeout: 30_000 }
        );
    });

    test('all 34 real catalogs match the real provider registry', () => {
        const script = String.raw`
            const {
                getPiCatalogModels,
                listPiProviderDefinitions,
            } = await import('./src/function/update/pi/provider_registry.ts');
            const { getPiProviderApiBaseUrl } = await import(
                './src/function/update/pi/provider_target.ts'
            );

            const definitions = listPiProviderDefinitions();
            if (definitions.length !== 34) {
                throw new Error(
                    'Expected 34 Pi provider definitions, received ' + definitions.length
                );
            }
            if (new Set(definitions.map(definition => definition.key)).size !== 34) {
                throw new Error('Pi provider registry contains duplicate keys');
            }

            for (const definition of definitions) {
                const catalog = getPiCatalogModels(definition.key);
                if (catalog.length === 0) {
                    throw new Error(definition.key + ': catalog must not be empty');
                }
                for (const model of catalog) {
                    if (model.provider !== definition.providerId) {
                        throw new Error(
                            definition.key + '/' + model.id + ': provider mismatch (' +
                            model.provider + ' !== ' + definition.providerId + ')'
                        );
                    }
                    if (!definition.allowedApis.includes(model.api)) {
                        throw new Error(
                            definition.key + '/' + model.id + ': unregistered API ' + model.api
                        );
                    }
                    const expectedBaseUrl = getPiProviderApiBaseUrl(definition, model.api);
                    if (model.baseUrl !== expectedBaseUrl) {
                        throw new Error(
                            definition.key + '/' + model.id + ': base URL mismatch (' +
                            model.baseUrl + ' !== ' + expectedBaseUrl + ')'
                        );
                    }
                }
            }
        `;

        expect(() =>
            execFileSync(
                process.execPath,
                [
                    '--experimental-strip-types',
                    '--loader',
                    join(process.cwd(), 'tests/helpers/typescript-extension-loader.mjs'),
                    '--input-type=module',
                    '--eval',
                    script,
                ],
                { cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe' }
            )
        ).not.toThrow();
    });
});
