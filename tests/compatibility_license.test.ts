import { OPEN_SOURCE_LICENSES } from '@/panel/open_source_licenses';
import fs from 'node:fs';
import path from 'node:path';

const EXPECTED_RUNTIME_PACKAGES = [
    '@anthropic-ai/sdk',
    '@earendil-works/pi-ai',
    '@google/genai',
    '@vue/devtools-api',
    '@vue/devtools-kit',
    '@vue/devtools-shared',
    'compare-versions',
    'css-loader',
    'fast-json-patch',
    'json5',
    'klona',
    'lodash',
    'mathjs',
    'openai',
    'p-retry',
    'partial-json',
    'pinia',
    'retry',
    'vue',
    'vue-i18n',
    'vue-loader',
    'vue-style-loader',
    'yaml',
    'zod',
] as const;

describe('compatibility LICENSE notice', () => {
    test('lists the runtime, bundled provider, and emitted loader dependencies', () => {
        expect(OPEN_SOURCE_LICENSES.map(component => component.packageName).sort()).toEqual(
            [...EXPECTED_RUNTIME_PACKAGES].sort()
        );
    });

    test('matches the installed package versions and declared licenses', () => {
        for (const component of OPEN_SOURCE_LICENSES) {
            const package_json_path = path.join(
                process.cwd(),
                'node_modules',
                ...component.packageName.split('/'),
                'package.json'
            );
            const metadata = JSON.parse(fs.readFileSync(package_json_path, 'utf8')) as {
                version?: string;
                license?: string;
            };

            expect({
                packageName: component.packageName,
                version: component.version,
                license: component.license,
            }).toEqual({
                packageName: component.packageName,
                version: metadata.version,
                license: metadata.license,
            });
            expect(component.projectUrl).toMatch(/^https:\/\//);
        }
    });

    test('covers every package emitted into the production source map', () => {
        const source_map = JSON.parse(
            fs.readFileSync(path.join(process.cwd(), 'artifact/bundle.js.map'), 'utf8')
        ) as { sources?: string[] };
        const bundled_packages = new Set<string>();

        for (const source of source_map.sources ?? []) {
            const marker_index = source.lastIndexOf('node_modules/');
            if (marker_index < 0) {
                continue;
            }
            const segments = source.slice(marker_index + 'node_modules/'.length).split('/');
            bundled_packages.add(
                segments[0].startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0]
            );
        }

        const listed_packages = new Set<string>(
            OPEN_SOURCE_LICENSES.map(component => component.packageName)
        );
        expect([...bundled_packages].filter(name => !listed_packages.has(name)).sort()).toEqual([]);
    });

    test('renders auditable package names while keeping the internal source name out of copy', () => {
        const component = fs.readFileSync(
            path.join(process.cwd(), 'src/panel/Compatibility.vue'),
            'utf8'
        );

        expect(component).toContain('v-for="component in OPEN_SOURCE_LICENSES"');
        expect(component).toContain("t('panel.compatibility.license')");
        expect(component).toContain('{{ component.displayName ?? component.packageName }}');
        expect(component).toContain('<template #title-suffix>');
        expect(component).toContain('<HelpIcon :help="license_help" />');
        expect(component).toContain("t('panel.compatibility.licenseIntro')");
        expect(component).toContain("t('panel.compatibility.licenseDetails')");
        expect(component).not.toContain('mvu-license-note');
        expect(OPEN_SOURCE_LICENSES).toContainEqual(
            expect.objectContaining({
                packageName: '@earendil-works/pi-ai',
                displayName: 'Earendil Works AI',
                license: 'MIT',
            })
        );
    });
});
