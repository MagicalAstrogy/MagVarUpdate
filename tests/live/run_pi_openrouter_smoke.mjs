/**
 * 测试场景：读取本地测试凭证，构建隔离的 Node 测试入口并运行真实 OpenRouter 多协议冒烟测试。
 * 输出经过凭证替换后再展示，临时编译目录在结束时删除。
 */
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpackPackage from 'webpack';
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const webpack = webpackPackage;
const tokenFile = path.join(workspaceRoot, 'test_token.md');
const rawTokenFile = fs.readFileSync(tokenFile, 'utf8');
const credentials = [...rawTokenFile.matchAll(/sk-[A-Za-z0-9_-]{12,}/g)].map(match => match[0]);
const apiKey = credentials[0];
if (!apiKey || credentials.some(credential => credential !== apiKey)) {
    throw new Error('test_token.md must contain one consistent test credential');
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mvu-pi-live-'));
/** 输出处理：隐藏测试凭证后再返回进程输出，避免联调日志带出秘密。 */
const redact = value =>
    value
        .replaceAll(apiKey, '<credential-redacted>')
        .replace(/sk-[A-Za-z0-9_-]{12,}/g, '<credential-redacted>');

/** 构建准备：将真实 OpenRouter 测试入口编译到临时目录，供独立 Node 进程执行。 */
function compileHarness() {
    return new Promise((resolve, reject) => {
        const compiler = webpack({
            mode: 'development',
            devtool: false,
            context: workspaceRoot,
            entry: path.join(workspaceRoot, 'tests/live/pi_openrouter_smoke.ts'),
            target: 'node',
            externalsPresets: { node: true },
            output: {
                path: temporaryRoot,
                filename: 'pi_openrouter_smoke.cjs',
                chunkFilename: '[name].pi-live.cjs',
                clean: true,
            },
            module: {
                rules: [
                    {
                        test: /\.ts$/,
                        exclude: /node_modules/,
                        use: {
                            loader: 'ts-loader',
                            options: { transpileOnly: true },
                        },
                    },
                ],
            },
            resolve: {
                extensions: ['.ts', '.js'],
                plugins: [
                    new TsconfigPathsPlugin({
                        configFile: path.join(workspaceRoot, 'tsconfig.json'),
                    }),
                ],
            },
            optimization: { minimize: false },
        });
        compiler.run((error, stats) => {
            compiler.close(() => undefined);
            if (error) {
                reject(error);
                return;
            }
            if (stats?.hasErrors()) {
                reject(new Error(stats.toString({ all: false, errors: true })));
                return;
            }
            resolve();
        });
    });
}

try {
    await compileHarness();
    const result = childProcess.spawnSync(
        process.execPath,
        [path.join(temporaryRoot, 'pi_openrouter_smoke.cjs')],
        {
            cwd: workspaceRoot,
            encoding: 'utf8',
            env: {
                ...process.env,
                MVU_PI_OPENROUTER_API_KEY: apiKey,
                NODE_NO_WARNINGS: '1',
            },
            timeout: 360_000,
            maxBuffer: 1024 * 1024,
        }
    );
    if (result.stdout) {
        process.stdout.write(redact(result.stdout));
    }
    if (result.stderr) {
        process.stderr.write(redact(result.stderr));
    }
    if (result.error) {
        throw result.error;
    }
    process.exitCode = result.status ?? 1;
} finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
