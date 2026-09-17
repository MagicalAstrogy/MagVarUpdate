/**
 * 测试场景：编译并静态检查 Source 与 ModelSelect 组件，验证模型发现、受控切换、帮助提示、代理和 OAuth 操作绑定。
 */
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';

const { readFileSync } = jest.requireActual('node:fs') as typeof import('node:fs');
const { resolve } = jest.requireActual('node:path') as typeof import('node:path');
const filename = resolve(process.cwd(), 'src/panel/update/Source.vue');
const source = readFileSync(filename, 'utf8');
const modelSelectFilename = resolve(process.cwd(), 'src/panel/component/ModelSelect.vue');
const modelSelectSource = readFileSync(modelSelectFilename, 'utf8');

// 界面契约：组件可编译，持久化配置可查看和清除，异步列表与认证操作不会串到新连接。
describe('Pi Source UI contract', () => {
    // 组件编译与模型选择：共享选择器支持手填模型，并取消目标变化后的过时请求。
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
        expect(source).toContain('resolvePiSourceContextWindow(');
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

    // 说明与配置归属：帮助内容通过 HelpIcon 展示，自定义覆盖可编辑，密钥切换受控。
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
        expect(source).toContain('<HelpIcon :help="t(\'panel.source.pi.proxy.help\')" />');
        expect(source).toContain(
            '<HelpIcon :help="t(\'panel.source.pi.proxy.notEnabledHelp\')" />'
        );

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

    // 代理与 OAuth：正确标注代理来源、探测不可用状态，并绑定刷新和登出的发起界面。
    test('labels and controls routes that use the SillyTavern CORS proxy', () => {
        expect(source).toContain("import Checkbox from '@/panel/component/Checkbox.vue';");
        expect(source).toContain('v-if="show_pi_custom_endpoint_proxy"');
        expect(source).toContain('v-model="store.settings.额外模型解析配置.pi.useProxy"');
        expect(source).toContain('return use_proxy ? `${label} (Proxy)` : label;');
        expect(source).toContain('shouldUsePiCorsProxy(');
        expect(source).toContain('listPiSourceChoices');
        expect(source).toContain('useProxy: pi.useProxy');
        expect(source).toContain('store.settings.额外模型解析配置.pi.useProxy,');
    });

    test('probes and warns when a selected proxy route is unavailable', () => {
        expect(source).toContain('probeSillyTavernProxy()');
        expect(source).toContain('getSillyTavernProxyStatus()');
        expect(source).toContain('v-if="show_pi_proxy_warning" class="mvu-warning"');
        expect(source).toContain("t('panel.source.pi.proxy.notEnabled')");
        expect(source).toContain("pi_proxy_status.value === 'disabled'");
        expect(source).toContain("pi_proxy_status.value === 'unavailable'");
        expect(source).toContain(
            "(error as Error & { code?: unknown }).code === 'proxy_unavailable'"
        );
    });

    test('keeps credential refresh and logout bound to the initiating UI context', () => {
        const refresh = source.slice(
            source.indexOf('async function refreshOAuthCredentials'),
            source.indexOf('async function logoutOAuth')
        );
        const logout = source.slice(
            source.indexOf('async function logoutOAuth'),
            source.indexOf('async function copyOAuthAuthorizationUrl')
        );

        expect(refresh.indexOf('captureOAuthUiContext(provider)')).toBeLessThan(
            refresh.indexOf('await refreshPiOAuth')
        );
        expect(refresh.indexOf('await refreshPiOAuth')).toBeLessThan(
            refresh.indexOf('isOAuthUiContextCurrent(operation_context)')
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
