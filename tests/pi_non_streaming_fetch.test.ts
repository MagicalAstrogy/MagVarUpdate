import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('non-streaming transport works with the real Pi adapters, proxy, errors and cancellation', () => {
    // Pi is ESM-only; exercise its actual parsers with native Fetch APIs in an isolated Node
    // process. Every HTTP request is mocked locally, including the Google SDK transport.
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
