/** 在隔离酒馆与真实浏览器中验证本地配置的 Pi API；密钥只用于本次测试。 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

if (!process.env.GEMINI_API_KEY?.trim()) {
    const keyFile = resolve('GEMINI_KEY_FILE.txt');
    if (existsSync(keyFile)) {
        const source = readFileSync(keyFile, 'utf8').trim();
        const configured = parseEnv(source).GEMINI_API_KEY?.trim();
        const keys = [...new Set(source.match(/AIza[A-Za-z0-9_-]+/g) ?? [])];
        if (configured) process.env.GEMINI_API_KEY = configured;
        else if (/^[A-Za-z0-9_.-]+$/.test(source)) process.env.GEMINI_API_KEY = source;
        else if (keys.length === 1) process.env.GEMINI_API_KEY = keys[0];
    }
}
const { livePiCases, isLivePiCaseEnabled } = await import('./pi_live_cases.ts');
if (livePiCases.some(isLivePiCaseEnabled)) {
    process.env.MVU_PI_ST_CONFIGURED_LIVE_SMOKE = '1';
    await import('./run_pi_st_capture_smoke.mjs');
} else {
    process.stdout.write(
        JSON.stringify({ ok: true, skipped: true, reason: 'No configured live API credentials' }) +
            '\n'
    );
}
