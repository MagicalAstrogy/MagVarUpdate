/** 真实 Google API 回归：仅设置 GEMINI_API_KEY 时运行，默认无需凭据即可跳过。 */
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const apiKey = process.env.GEMINI_API_KEY?.trim() ?? '';
const liveTest = apiKey ? test : test.skip;

/** 子进程失败也只展示脱敏后的输出，防止 SDK 错误或 HTTP 响应回显密钥。 */
function redact(value: string): string {
    return value
        .replaceAll(apiKey, '<credential-redacted>')
        .replace(/AIza[A-Za-z0-9_-]+/g, '<credential-redacted>')
        .slice(0, 4000);
}

describe('Google proxy adapter with GEMINI_API_KEY', () => {
    liveTest.each(['stream', 'non-stream', 'tool', 'json'])(
        '%s uses the real Google SDK and API through the injected fetch',
        async scenario => {
            let stdout: string;
            try {
                ({ stdout } = await execFileAsync(
                    process.execPath,
                    [resolve(__dirname, 'live/pi_google_proxy_adapter_live.mjs'), scenario],
                    {
                        encoding: 'utf8',
                        timeout: 40_000,
                        maxBuffer: 1024 * 1024,
                        env: { ...process.env, GEMINI_API_KEY: apiKey },
                    }
                ));
            } catch (error) {
                const failure = error as Error & { stderr?: string; stdout?: string };
                throw new Error(redact(failure.stderr || failure.message));
            }
            expect(stdout.includes(apiKey)).toBe(false);
            expect(JSON.parse(stdout)).toMatchObject({ scenario, passed: true, requests: 1 });
        },
        45_000
    );
});
