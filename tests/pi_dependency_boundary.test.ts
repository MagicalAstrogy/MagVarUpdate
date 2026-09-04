const { readFileSync } = jest.requireActual('node:fs') as {
    readFileSync(path: string, encoding: 'utf8'): string;
};

const PI_ROOT = '@earendil-works/pi-ai';
const ALLOWED_PI_IMPORTS = [
    PI_ROOT,
    `${PI_ROOT}/providers/ant-ling.models`,
    `${PI_ROOT}/providers/anthropic.models`,
    `${PI_ROOT}/providers/baseten.models`,
    `${PI_ROOT}/providers/cerebras.models`,
    `${PI_ROOT}/providers/deepseek.models`,
    `${PI_ROOT}/providers/fireworks.models`,
    `${PI_ROOT}/providers/github-copilot.models`,
    `${PI_ROOT}/providers/google.models`,
    `${PI_ROOT}/providers/groq.models`,
    `${PI_ROOT}/providers/huggingface.models`,
    `${PI_ROOT}/providers/kimi-coding.models`,
    `${PI_ROOT}/providers/minimax.models`,
    `${PI_ROOT}/providers/minimax-cn.models`,
    `${PI_ROOT}/providers/mistral.models`,
    `${PI_ROOT}/providers/moonshotai.models`,
    `${PI_ROOT}/providers/moonshotai-cn.models`,
    `${PI_ROOT}/providers/nvidia.models`,
    `${PI_ROOT}/providers/openai.models`,
    `${PI_ROOT}/providers/openai-codex.models`,
    `${PI_ROOT}/providers/opencode.models`,
    `${PI_ROOT}/providers/opencode-go.models`,
    `${PI_ROOT}/providers/openrouter.models`,
    `${PI_ROOT}/providers/qwen-token-plan.models`,
    `${PI_ROOT}/providers/qwen-token-plan-cn.models`,
    `${PI_ROOT}/providers/qwen-token-plan-individual.models`,
    `${PI_ROOT}/providers/together.models`,
    `${PI_ROOT}/providers/vercel-ai-gateway.models`,
    `${PI_ROOT}/providers/xai.models`,
    `${PI_ROOT}/providers/xiaomi.models`,
    `${PI_ROOT}/providers/xiaomi-token-plan-ams.models`,
    `${PI_ROOT}/providers/xiaomi-token-plan-cn.models`,
    `${PI_ROOT}/providers/xiaomi-token-plan-sgp.models`,
    `${PI_ROOT}/providers/zai.models`,
    `${PI_ROOT}/providers/zai-coding-cn.models`,
    `${PI_ROOT}/api/openai-responses.lazy`,
    `${PI_ROOT}/api/openai-completions.lazy`,
    `${PI_ROOT}/api/anthropic-messages.lazy`,
    `${PI_ROOT}/api/google-generative-ai.lazy`,
    `${PI_ROOT}/api/google-shared`,
    `${PI_ROOT}/api/simple-options`,
    `${PI_ROOT}/api/mistral-conversations.lazy`,
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

const EXCLUDED_PI_PROVIDER_FACTORIES = [
    'all',
    'amazon-bedrock',
    'azure-openai-responses',
    'cloudflare-ai-gateway',
    'cloudflare-workers-ai',
    'google-vertex',
    'radius',
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
        expect(source).not.toMatch(/@earendil-works\/pi-ai\/providers\/[\w-]+['"]/);
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

        const expected_catalog_sources = ALLOWED_PI_IMPORTS.filter(specifier =>
            specifier.startsWith(`${PI_ROOT}/providers/`)
        )
            .map(specifier => `${specifier.slice(`${PI_ROOT}/providers/`.length)}.js`)
            .sort();
        const bundled_provider_sources = source_map.sources.flatMap(source => {
            const match = /\/pi-ai\/dist\/providers\/([^/]+\.js)$/.exec(source);
            return match ? [match[1]] : [];
        });
        expect(bundled_provider_sources.sort()).toEqual(expected_catalog_sources);
        for (const provider of EXCLUDED_PI_PROVIDER_FACTORIES) {
            expect(source_map.sources).not.toEqual(
                expect.arrayContaining([expect.stringMatching(`/providers/${provider}\\.js$`)])
            );
        }
    });
});
