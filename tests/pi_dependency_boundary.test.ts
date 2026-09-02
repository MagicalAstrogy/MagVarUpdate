const { readFileSync } = jest.requireActual('node:fs') as {
    readFileSync(path: string, encoding: 'utf8'): string;
};

const PI_ROOT = '@earendil-works/pi-ai';
const ALLOWED_PI_IMPORTS = [
    PI_ROOT,
    `${PI_ROOT}/providers/openai.models`,
    `${PI_ROOT}/providers/anthropic.models`,
    `${PI_ROOT}/providers/google.models`,
    `${PI_ROOT}/providers/openai-codex.models`,
    `${PI_ROOT}/api/openai-responses.lazy`,
    `${PI_ROOT}/api/openai-completions.lazy`,
    `${PI_ROOT}/api/anthropic-messages.lazy`,
    `${PI_ROOT}/api/google-generative-ai.lazy`,
    `${PI_ROOT}/api/openai-codex-responses.lazy`,
] as const;

const LOCAL_PI_SDK_DEPENDENCIES = [
    'openai',
    '@anthropic-ai/sdk',
    '@google/genai',
    'partial-json',
    'p-retry',
    'retry',
    'klona',
] as const;

function readWorkspaceFile(relative_path: string): string {
    return readFileSync(`${process.cwd()}/${relative_path}`, 'utf8');
}

type WebpackSourceMap = {
    sources: string[];
    sourcesContent?: Array<string | null>;
};

function hasLocalModuleSource(source_map: WebpackSourceMap, specifier: string): boolean {
    return source_map.sources.some(source => source.includes(`/node_modules/${specifier}/`));
}

describe('pi dependency boundary', () => {
    test('gateway imports only the audited pi runtime entry points', () => {
        const source = readWorkspaceFile('src/function/update/pi/pi_gateway.ts');
        const imports = new Set(
            Array.from(source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g), match => match[1]).filter(
                specifier => specifier.startsWith(PI_ROOT)
            )
        );

        expect([...imports].sort()).toEqual([...ALLOWED_PI_IMPORTS].sort());
        expect(source).not.toContain('providers/all');
        expect(source).not.toMatch(
            /@earendil-works\/pi-ai\/providers\/(?:openai|openai-codex|anthropic|google)['"]/
        );
        expect(source).not.toContain('/oauth');
    });

    test('webpack bundles every audited pi entry point locally', () => {
        const webpack_source = readWorkspaceFile('webpack.config.ts');

        for (const specifier of ALLOWED_PI_IMPORTS) {
            expect(webpack_source).toContain(`'${specifier}'`);
        }
        for (const specifier of LOCAL_PI_SDK_DEPENDENCIES) {
            expect(webpack_source).toContain(`'${specifier}'`);
        }
        expect(webpack_source).toContain('BUNDLED_PI_AI_MODULES.has(request)');
    });

    test('committed artifact keeps the audited SDK dependency graph out of CDN externals', () => {
        const bundle = readWorkspaceFile('artifact/bundle.js');
        const source_map = JSON.parse(
            readWorkspaceFile('artifact/bundle.js.map')
        ) as WebpackSourceMap;

        for (const specifier of LOCAL_PI_SDK_DEPENDENCIES) {
            expect(hasLocalModuleSource(source_map, specifier)).toBe(true);
            expect(bundle).not.toContain(`https://testingcf.jsdelivr.net/npm/${specifier}/+esm`);
        }

        const p_retry_index = source_map.sources.findIndex(source =>
            source.includes('/node_modules/p-retry/index.js')
        );
        expect(p_retry_index).toBeGreaterThanOrEqual(0);
        expect(source_map.sourcesContent?.[p_retry_index]).toMatch(/require\(['"]retry['"]\)/);
        expect(hasLocalModuleSource(source_map, 'retry')).toBe(true);
    });
});
