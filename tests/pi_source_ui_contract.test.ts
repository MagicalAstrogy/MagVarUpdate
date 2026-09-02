import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';

const { readFileSync } = jest.requireActual('node:fs') as typeof import('node:fs');
const { resolve } = jest.requireActual('node:path') as typeof import('node:path');
const filename = resolve(process.cwd(), 'src/panel/update/Source.vue');
const source = readFileSync(filename, 'utf8');

describe('Pi Source UI contract', () => {
    test('compiles the Source SFC template and script', () => {
        const parsed = parse(source, { filename });
        expect(parsed.errors).toEqual([]);
        expect(parsed.descriptor.template).not.toBeNull();

        const script = compileScript(parsed.descriptor, { id: 'pi-source-contract' });
        const template = compileTemplate({
            id: 'pi-source-contract',
            filename,
            source: parsed.descriptor.template!.content,
            compilerOptions: { bindingMetadata: script.bindings },
        });
        expect(template.errors).toEqual([]);
    });

    test('keeps all persisted request overrides inspectable and clearable', () => {
        for (const field of ['customHeaders', 'customIncludeBody', 'customExcludeBody']) {
            expect(source).toContain(`v-model="store.settings.额外模型解析配置.pi.${field}"`);
            expect(source).toContain(`@click="store.settings.额外模型解析配置.pi.${field} = ''"`);
        }
        expect(source.match(/<textarea/g)).toHaveLength(3);
        expect(source).toContain("t('panel.source.pi.customOverridesSwitchHelp')");
    });

    test('uses controlled source and endpoint transitions for secret isolation', () => {
        expect(source).not.toContain('v-model="store.settings.额外模型解析配置.模型来源"');
        expect(source).not.toContain('v-model="store.settings.额外模型解析配置.pi.endpoint"');
        expect(source).toContain('@update:model-value="selectModelSource"');
        expect(source).toContain('@input="selectPiEndpoint"');
        expect(source).toContain('applyPiConnectionTransition(() =>');
        expect(source).toContain("pi.authType === 'api_key'");
    });

    test('uses a Pi API field label key that cannot collide with nested API option keys', () => {
        expect(source).toContain("t('panel.source.pi.apiLabel')");
        expect(source).not.toContain("t('panel.source.pi.api')");
    });

    test('captures and revalidates OAuth UI context around confirmation awaits', () => {
        const begin = source.slice(
            source.indexOf('async function beginOAuthLogin'),
            source.indexOf('async function completeOAuthLogin')
        );
        const logout = source.slice(
            source.indexOf('async function logoutOAuth'),
            source.indexOf('async function copyOAuthAuthorizationUrl')
        );

        expect(begin.indexOf('captureOAuthUiContext(provider)')).toBeLessThan(
            begin.indexOf('await SillyTavern.callGenericPopup')
        );
        expect(begin.indexOf('await SillyTavern.callGenericPopup')).toBeLessThan(
            begin.indexOf('!isOAuthUiContextCurrent(confirmation_context)')
        );
        expect(logout.indexOf('captureOAuthUiContext(provider)')).toBeLessThan(
            logout.indexOf('await SillyTavern.callGenericPopup')
        );
        expect(logout.indexOf('await SillyTavern.callGenericPopup')).toBeLessThan(
            logout.indexOf('!isOAuthUiContextCurrent(confirmation_context)')
        );
        expect(source).toContain('oauthComponentMounted = false;');
    });
});
