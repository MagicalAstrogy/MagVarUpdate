import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';
import { Server } from 'socket.io';
import TerserPlugin from 'terser-webpack-plugin';
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin';
import webpack from 'webpack';
import semver from 'semver';
//const require = createRequire(import.meta.url);

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. 读取整个项目 package.json
const projectPkg = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')
);

// 拿到 range，比如 '^12.4.1'、'~11.8.0'、'>=12.0.0 <13.0.0' 等
const rawJson5 = projectPkg.dependencies?.json5 || projectPkg.devDependencies?.json5 || '';
//const rawMathjs = projectPkg.dependencies?.mathjs || projectPkg.devDependencies?.mathjs || '';

// semver.minVersion 返回一个 SemVer 对象，取 .version 属性就是最小满足版本
const JSON5_VERSION = semver.minVersion(rawJson5)?.version || rawJson5.replace(/^[^\d]*/, '');
//const MATHJS_VERSION = semver.minVersion(rawMathjs)?.version || rawMathjs.replace(/^[^\d]*/, '');


let io: Server;
function watch_it(compiler: webpack.Compiler) {
    if (compiler.options.watch) {
        if (!io) {
            const port = 6621;
            io = new Server(port, { cors: { origin: '*' } });
            console.info(`[Listener] 已启动酒馆监听服务, 正在监听: http://0.0.0.0:${port}`);
            io.on('connect', socket => {
                console.info(`[Listener] 成功连接到酒馆网页 '${socket.id}', 初始化推送...`);
                socket.on('disconnect', reason => {
                    console.info(`[Listener] 与酒馆网页 '${socket.id}' 断开连接: ${reason}`);
                });
            });
        }

        compiler.hooks.done.tap('updater', () => {
            console.info('\n[Listener] 检测到完成编译, 推送更新事件...');
            io.emit('iframe_updated');
        });
    }
}

function config(_env: any, argv: any) {
    const is_production = argv.mode === 'production';
    return {
        experiments: {
            outputModule: true,
        },
        devtool: argv.mode === 'production' ? 'source-map' : 'source-map',
        entry: path.join(__dirname, 'src/main.ts'),
        target: 'browserslist',
        output: {
            filename: `bundle.js`,
            path: path.join(__dirname, 'artifact'),
            chunkFilename: `bundle.[contenthash].chunk.js`,
            asyncChunks: true,
            chunkLoading: 'import',
            clean: true,
            publicPath: '',
            library: {
                type: 'module',
            },
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    loader: 'ts-loader',
                    options: {
                        transpileOnly: true,
                    },
                    exclude: /node_modules/,
                },
            ],
        },
        resolve: {
            extensions: ['.ts', '.js'],
            plugins: [
                new TsconfigPathsPlugin({
                    extensions: ['.ts', '.js'],
                    configFile: path.join(__dirname, 'tsconfig.json'),
                }),
            ],
            alias: {},
        },
        plugins: [{ apply: watch_it }],
        optimization: {
            minimize: true,
            minimizer: [
                is_production
                    ? new TerserPlugin({ terserOptions: { format: { quote_style: 1 } } })
                    : new TerserPlugin({
                          extractComments: false,
                          terserOptions: {
                              format: { beautify: true, indent_level: 2 },
                              compress: false,
                              mangle: false, // 如需保留变量名，也可关掉混淆
                          },
                      }),
            ],
            splitChunks: {
                chunks: 'async',
                minSize: 20000,
                minChunks: 1,
                maxAsyncRequests: 30,
                maxInitialRequests: 30,
                cacheGroups: {
                    vendor: {
                        name: 'vendor',
                        test: /[\\/]node_modules[\\/]/,
                        priority: -10,
                    },
                    default: {
                        name: 'default',
                        minChunks: 2,
                        priority: -20,
                        reuseExistingChunk: true,
                    },
                },
            },
        },
        externals: [
            ({ context, request }: { context: string; request: string }, callback: (err?: Error | null, result?: string) => void) => {
                if (
                    !context ||
                    !request ||
                    request.startsWith('@') ||
                    request.startsWith('.') ||
                    request.startsWith('/')
                ) {
                    return callback();
                }

                if (fs.existsSync(path.join(context, request))) {
                    return callback();
                }

                if (fs.existsSync(request)) {
                    return callback();
                }

                const builtin = {
                    lodash: '_',
                    toastr: 'toastr',
                    yaml: 'YAML',
                    jquery: '$',
                };
                if (request in builtin) {
                    return callback(null, 'var ' + builtin[request as keyof typeof builtin]);
                }
                // 4. 对 json5 专门处理
                if (request === 'json5') {
                    const url = `https://fastly.jsdelivr.net/npm/json5@${JSON5_VERSION}/dist/index.min.mjs`;
                    return callback(null, `module-import ${url}`);
                }
                if (request === 'mathjs') {
                    // 使用 ESM 入口，让浏览器当作 Module 加载
                    //const url = `https://fastly.jsdelivr.net/npm/mathjs@${MATHJS_VERSION}/lib/esm/index.js`;
                    //return callback(null, `module-import ${url}`);
                    return callback();
                }
                return callback(null, 'module-import https://fastly.jsdelivr.net/npm/' + request);
            },
        ],
    };
}

export default config;
