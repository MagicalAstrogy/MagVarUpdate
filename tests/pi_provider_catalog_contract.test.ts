/**
 * 测试场景：使用真实 Pi 模型目录核对全部 34 个预置服务商与运行时注册表的对应关系。
 */
const { execFileSync } = jest.requireActual(
    'node:child_process'
) as typeof import('node:child_process');
const { join } = jest.requireActual('node:path') as typeof import('node:path');

// 真实目录契约：服务商标识、模型所属协议和注册信息必须匹配。
describe('Pi preset provider catalog contract', () => {
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
