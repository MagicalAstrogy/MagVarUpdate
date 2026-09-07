/**
 * 测试场景：在隔离 Node ESM 进程中使用真实 Pi 解析器验证非流式传输；全部 HTTP 请求在本地模拟。
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// 完整传输回归：协议映射、代理组合、错误终态和取消都由独立进程中的真实适配器验证。
test('non-streaming transport works with the real Pi adapters, proxy, errors and cancellation', () => {
    // Pi 仅提供 ESM，在隔离 Node 进程中配合原生 Fetch 验证真实解析器。
    // 所有 HTTP 请求都在本地模拟，包括 Google SDK 的传输。
    const result = spawnSync(
        process.execPath,
        [resolve(__dirname, 'fixtures/pi_non_streaming_transport.mjs')],
        { encoding: 'utf8', timeout: 30_000 }
    );
    if (result.error || result.status !== 0) {
        throw new Error(result.error?.message ?? result.stderr ?? result.stdout);
    }
    expect(result.stdout).toContain('All non-streaming transport checks passed');
}, 35_000);
