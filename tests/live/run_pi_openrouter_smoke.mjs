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
const redact = value =>
    value
        .replaceAll(apiKey, '<credential-redacted>')
        .replace(/sk-[A-Za-z0-9_-]{12,}/g, '<credential-redacted>');

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
