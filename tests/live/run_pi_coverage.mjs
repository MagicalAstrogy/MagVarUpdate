/** 合并普通回归与可选真实链路的源码覆盖率，输出 update/pi 的前后对比。 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';

// Istanbul 这三个包使用 CommonJS，Node 22 无法稳定推断其命名导出。
const require = createRequire(import.meta.url);
const { createCoverageMap } = require('istanbul-lib-coverage');
const { createContext } = require('istanbul-lib-report');
const { create: createReport } = require('istanbul-reports');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const envPath = resolve(root, process.env.MVU_PI_API_SETTINGS_FILE || 'api_settings.env');
const fileValues = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {};
const secrets = [
    ...new Set(
        Object.entries({ ...fileValues, ...process.env })
            .filter(
                ([name, value]) =>
                    value && (name.endsWith('_API_TOKEN') || name === 'GEMINI_API_KEY')
            )
            .map(([, value]) => value)
    ),
];
const unitDir = join(root, 'coverage/pi-unit');
const liveDir = join(root, 'coverage/pi-live');
const combinedDir = join(root, 'coverage/pi-combined');

/** 即使 SDK 或测试进程失败，也只透出经过逐行脱敏的日志。 */
function redact(value) {
    let output = String(value);
    for (const secret of secrets) output = output.replaceAll(secret, '<credential-redacted>');
    return output
        .replace(/AIza[A-Za-z0-9_-]+/g, '<credential-redacted>')
        .replace(/sk-[A-Za-z0-9_-]{12,}/g, '<credential-redacted>');
}

/** 保留实时进度和退出状态；测试失败会使总命令失败，不能靠合并报告掩盖失败。 */
function run(args, env = process.env) {
    return new Promise((resolveRun, rejectRun) => {
        const child = spawn(process.execPath, args, {
            cwd: root,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        for (const stream of [child.stdout, child.stderr]) {
            createInterface({ input: stream }).on('line', line => {
                process.stdout.write(`${redact(line)}\n`);
            });
        }
        child.once('error', rejectRun);
        child.once('close', (code, signal) => {
            if (code === 0) resolveRun();
            else rejectRun(new Error(`Coverage test process failed (${signal ?? code})`));
        });
    });
}

/** 两种 Jest 配置均生成映射回原始 TypeScript 的 Istanbul JSON，按文件与源码位置合并。 */
function mergeCoverage() {
    const unitResults = JSON.parse(readFileSync(join(unitDir, 'test-results.json'), 'utf8'));
    const liveResults = JSON.parse(readFileSync(join(liveDir, 'test-results.json'), 'utf8'));
    if (!unitResults.success || !liveResults.success) {
        throw new Error('Coverage merge requires successful unit and live test reports');
    }
    const unit = createCoverageMap(
        JSON.parse(readFileSync(join(unitDir, 'coverage-final.json'), 'utf8'))
    );
    const live = createCoverageMap(
        JSON.parse(readFileSync(join(liveDir, 'coverage-final.json'), 'utf8'))
    );
    const combined = createCoverageMap(JSON.parse(JSON.stringify(unit.toJSON())));
    combined.merge(live);
    mkdirSync(combinedDir, { recursive: true });
    const context = createContext({ dir: combinedDir, coverageMap: combined });
    for (const kind of ['json', 'json-summary', 'text', 'html', 'lcovonly']) {
        createReport(kind).execute(context);
    }
    const rows = combined
        .files()
        .sort()
        .map(filename => {
            const before = unit.files().includes(filename)
                ? unit.fileCoverageFor(filename).toSummary().toJSON()
                : undefined;
            const after = combined.fileCoverageFor(filename).toSummary().toJSON();
            return { file: basename(filename), before, after };
        });
    const report = {
        tests: {
            unitPassed: unitResults.numPassedTests,
            livePassed: liveResults.numPassedTests,
            liveSkipped: liveResults.numPendingTests,
        },
        before: unit.getCoverageSummary().toJSON(),
        after: combined.getCoverageSummary().toJSON(),
        files: rows,
    };
    writeFileSync(join(combinedDir, 'comparison.json'), JSON.stringify(report, null, 2));
    const markdown = [
        '# update/pi 覆盖率对比',
        '',
        '普通回归基线与真实链路合并后的覆盖率。真实场景及 HTTP 结果见 `../pi-live/requests.json`。',
        '',
        `ESM 链路测试（含发送前拒绝检查）：${liveResults.numPassedTests} 项通过，${liveResults.numPendingTests} 项跳过。`,
        '',
        '| 文件 | 基线行覆盖率 | 合并行覆盖率 | 基线分支覆盖率 | 合并分支覆盖率 |',
        '| --- | ---: | ---: | ---: | ---: |',
        ...rows.map(
            row =>
                `| ${row.file} | ${row.before?.lines.pct ?? 0}% | ${row.after.lines.pct}% | ${row.before?.branches.pct ?? 0}% | ${row.after.branches.pct}% |`
        ),
        '',
    ].join('\n');
    writeFileSync(join(combinedDir, 'comparison.md'), markdown);
    process.stdout.write(
        `Combined Pi line coverage: ${report.before.lines.pct}% -> ${report.after.lines.pct}%\n`
    );
    process.stdout.write('Report: coverage/pi-combined/index.html\n');
}

try {
    if (!process.argv.includes('--merge-only')) {
        // 基线不重复调用已单独验证的 Google live 文件，也不把纯网络请求计作单测基线。
        const unitEnv = { ...process.env };
        delete unitEnv.GEMINI_API_KEY;
        await run(
            [
                'node_modules/jest/bin/jest.js',
                '--runInBand',
                '--silent',
                '--coverage',
                '--testPathIgnorePatterns=\\.live\\.test\\.ts$',
                '--collectCoverageFrom=src/function/update/pi/**/*.ts',
                `--coverageDirectory=${unitDir}`,
                '--coverageReporters=json',
                '--coverageReporters=json-summary',
                '--json',
                `--outputFile=${join(unitDir, 'test-results.json')}`,
            ],
            unitEnv
        );
        await run([
            '--experimental-vm-modules',
            'node_modules/jest/bin/jest.js',
            '--config=jest.pi-live.config.cjs',
            '--runInBand',
            '--coverage',
            '--json',
            `--outputFile=${join(liveDir, 'test-results.json')}`,
        ]);
    }
    mergeCoverage();
} catch (error) {
    process.stderr.write(`${redact(error instanceof Error ? error.message : error)}\n`);
    process.exitCode = 1;
}
