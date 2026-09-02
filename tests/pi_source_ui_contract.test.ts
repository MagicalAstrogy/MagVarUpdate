import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';

const { readFileSync } = jest.requireActual('node:fs') as typeof import('node:fs');
const { resolve } = jest.requireActual('node:path') as typeof import('node:path');
const filename = resolve(process.cwd(), 'src/panel/update/Source.vue');
const source = readFileSync(filename, 'utf8');
const modelSelectFilename = resolve(process.cwd(), 'src/panel/component/ModelSelect.vue');
const modelSelectSource = readFileSync(modelSelectFilename, 'utf8');

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

    test('compiles the shared model selector SFC template and script', () => {
        const parsed = parse(modelSelectSource, { filename: modelSelectFilename });
        expect(parsed.errors).toEqual([]);
        expect(parsed.descriptor.template).not.toBeNull();

        const script = compileScript(parsed.descriptor, { id: 'model-select-contract' });
        const template = compileTemplate({
            id: 'model-select-contract',
            filename: modelSelectFilename,
            source: parsed.descriptor.template!.content,
            compilerOptions: { bindingMetadata: script.bindings },
        });
        expect(template.errors).toEqual([]);
    });

    test('uses the shared fetchable model selector for both Custom and More sources', () => {
        expect(source).toContain('v-model="store.settings.额外模型解析配置.模型名称"');
        expect(source).toContain(':load-models="loadCustomModels"');
        expect(source).toContain(':reset-key="custom_model_list_revision"');

        expect(source).toContain('v-model="store.settings.额外模型解析配置.pi.model"');
        expect(source).toContain(':catalog-models="pi_catalog_model_options"');
        expect(source).toContain(':load-models="loadPiModels"');
        expect(source).toContain(':reset-key="pi_model_list_revision"');
        expect(source).toContain(':disabled="Boolean(pi_configuration_error) || oauthBusy"');

        expect(source).toContain('fetchOpenAICompatibleModelList(');
        expect(source).toContain('fetchPiModelList(');
        expect(source).toContain('resolvePiModelListOAuthCredential(');
    });

    test('cancels stale model-list requests and preserves manual model entry', () => {
        expect(modelSelectSource).toContain(
            'const model = defineModel<string>({ required: true });'
        );
        expect(modelSelectSource).toContain('props.loadModels(controller.signal)');
        expect(modelSelectSource).toContain('generation !== request_generation');
        expect(modelSelectSource).toContain('request_controller?.abort();');
        expect(modelSelectSource).toContain('watch(() => props.resetKey, resetFetchedModels);');
        expect(modelSelectSource).toContain('onBeforeUnmount(cancelActiveRequest);');
        expect(modelSelectSource).toContain('if (value) {');
        expect(modelSelectSource).toContain('model.value = value;');
    });

    test('routes supplementary More-source explanations through HelpIcon suffixes', () => {
        expect(source).toContain("import HelpIcon from '@/panel/component/HelpIcon.vue';");
        expect(source).toContain('<HelpIcon :help="t(\'panel.source.pi.endpointHelp\')" />');
        expect(source).toContain(
            '<HelpIcon v-if="pi_capability_summary" :help="pi_capability_summary" />'
        );
        expect(source).toContain('<HelpIcon :help="t(\'panel.source.pi.oauth.callbackHelp\')" />');
        expect(source).toContain(':help="t(\'panel.source.pi.customOverridesSwitchHelp\')"');
        expect(source).toContain(
            '<HelpIcon v-if="pi_context_window_help" :help="pi_context_window_help" />'
        );
        for (const key of ['customHeadersHelp', 'customIncludeBodyHelp', 'customExcludeBodyHelp']) {
            expect(source).toContain(`<HelpIcon :help="t('panel.source.pi.${key}')" />`);
        }

        expect(source).not.toContain('<small class="mvu-note">');
        expect(source).not.toContain('<div v-if="pi_capability_summary" class="mvu-note">');
        expect(source).not.toContain(
            '<div class="mvu-note">{{ t(\'panel.source.pi.oauth.callbackHelp\') }}</div>'
        );
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
        expect(source).toContain('@change="normalizePiEndpointInput"');
        expect(source).toContain('normalizePiApiBaseEndpoint(');
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
