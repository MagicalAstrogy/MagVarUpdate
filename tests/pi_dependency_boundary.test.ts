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

const EXTERNAL_PI_SDK_DEPENDENCIES = [
    PI_ROOT,
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
        expect(source).not.toMatch(/@earendil-works\/pi-ai\/providers\/[\w-]+['"]/);
        expect(source).not.toContain('/oauth');
    });

    test('loads Pi entry points and Google SDK through versioned browser ESM', () => {
        const manifest = JSON.parse(readWorkspaceFile('package.json')) as {
            dependencies: Record<string, string>;
        };
        const bundle = readWorkspaceFile('artifact/bundle.js');
        const cdn = 'https://testingcf.jsdelivr.net/npm/';
        for (const specifier of ALLOWED_PI_IMPORTS) {
            expect(bundle).toContain(
                `${cdn}${PI_ROOT}@${manifest.dependencies[PI_ROOT]}${specifier.slice(PI_ROOT.length)}/+esm`
            );
        }
        expect(bundle).toContain(
            `${cdn}@google/genai@${manifest.dependencies['@google/genai']}/+esm`
        );
        expect(bundle).not.toContain(`${cdn}${PI_ROOT}/`);
        expect(bundle).not.toContain(`${cdn}@google/genai/`);
        for (const name of [PI_ROOT, '@google/genai']) {
            const installed = JSON.parse(readWorkspaceFile(`node_modules/${name}/package.json`));
            expect(manifest.dependencies[name]).toBe(installed.version);
        }
    });

    test('does not embed third-party Pi or provider SDK code in the MVU artifact', () => {
        const source_map = JSON.parse(
            readWorkspaceFile('artifact/bundle.js.map')
        ) as WebpackSourceMap;
        for (const specifier of EXTERNAL_PI_SDK_DEPENDENCIES) {
            expect(hasLocalModuleSource(source_map, specifier)).toBe(false);
        }
        // The project-owned routing and transport adapters still belong to MVU.
        expect(
            source_map.sources.some(source => source.includes('/src/function/update/pi/runtime.ts'))
        ).toBe(true);
        expect(
            source_map.sources.some(source =>
                source.includes('/src/function/update/pi/non_streaming_fetch.ts')
            )
        ).toBe(true);
    });
});
