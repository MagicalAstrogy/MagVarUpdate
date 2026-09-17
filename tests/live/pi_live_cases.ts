/** 真实链路配置：专用 env 文件保存地址和密钥，测试不修改酒馆账号或方案。 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

export type LivePiCase = {
    name: string;
    provider: 'openai' | 'anthropic' | 'google';
    api: 'openai-responses' | 'openai-completions' | 'anthropic-messages' | 'google-generative-ai';
    endpoint: string;
    apiKey: string;
    model: string;
};

const envFile = resolve(process.env.MVU_PI_API_SETTINGS_FILE || 'api_settings.env');
const fileValues = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
const values = { ...fileValues, ...process.env };
export const liveProxyUrl = values.MVU_PI_ST_URL?.trim() ?? '';

/** 环境变量优先于本地文件；没有完整地址和密钥的协议只跳过其自己的真实测试。 */
export const livePiCases: LivePiCase[] = [
    { prefix: 'RESPONSES', provider: 'openai', api: 'openai-responses' },
    { prefix: 'ANTHROPICS', provider: 'anthropic', api: 'anthropic-messages' },
    { prefix: 'OPENAI', provider: 'openai', api: 'openai-completions' },
].map(({ prefix, provider, api }) => {
    const endpoint = values[`${prefix}_API_URL`]?.trim() ?? '';
    let openRouter = false;
    try {
        openRouter = new URL(endpoint).hostname === 'openrouter.ai';
    } catch {
        // 已填写但无效的地址由生产预检报错，不静默改用其他地址。
    }
    return {
        name: prefix,
        provider,
        api,
        endpoint,
        apiKey: values[`${prefix}_API_TOKEN`]?.trim() ?? '',
        // 当前 OpenRouter 方案已经配置此模型；其他地址可使用 *_API_MODEL 覆盖。
        model:
            values[`${prefix}_API_MODEL`]?.trim() ||
            (openRouter
                ? 'openai/gpt-4.1-mini'
                : provider === 'anthropic'
                  ? 'claude-haiku-4-5'
                  : 'gpt-4.1-mini'),
    } as LivePiCase;
});

livePiCases.push({
    name: 'GOOGLE',
    provider: 'google',
    api: 'google-generative-ai',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: values.GEMINI_API_KEY?.trim() ?? '',
    model: values.MVU_PI_GOOGLE_MODEL?.trim() || 'gemini-flash-lite-latest',
});

/** 协议自己的地址和密钥决定是否运行；酒馆 URL 只用于额外的代理场景。 */
export function isLivePiCaseEnabled(testCase: LivePiCase): boolean {
    return Boolean(testCase.endpoint && testCase.apiKey);
}

/** 日志与报告统一移除所有测试凭证，不打印请求头或完整错误对象。 */
export function redactLivePiOutput(value: unknown): string {
    let output = String(value);
    for (const secret of new Set(livePiCases.map(testCase => testCase.apiKey).filter(Boolean))) {
        output = output.replaceAll(secret, '<credential-redacted>');
    }
    return output
        .replace(/AIza[A-Za-z0-9_-]+/g, '<credential-redacted>')
        .replace(/sk-[A-Za-z0-9_-]{12,}/g, '<credential-redacted>');
}
