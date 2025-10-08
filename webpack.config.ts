import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import child_process from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import RemarkHTML from 'remark-html';
import { Server } from 'socket.io';
import TerserPlugin from 'terser-webpack-plugin';
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin';
import { VueLoaderPlugin } from 'vue-loader';
import webpack from 'webpack';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let io: Server;
function watch_it(compiler: webpack.Compiler) {
    if (compiler.options.watch) {
        if (!io) {
            const port = 6621;
            io = new Server(port, { cors: { origin: '*' } });
            console.info(`[Listener] 已启动酒馆监听服务, 正在监听: http://0.0.0.0:${port}`);
            io.on('connect', socket => {
                console.info(`[Listener] 成功连接到酒馆网页 '${socket.id}', 初始化推送...`);
                io.emit('iframe_updated');
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

function config(_env: any, argv: any): webpack.Configuration {
    // 获取构建时常量
    const buildDate = new Date().toISOString();
    let commitId = 'unknown';
    try {
        commitId = child_process
            .execSync('git rev-parse --short HEAD', { encoding: 'utf-8' })
            .trim();
    } catch (error) {
        console.warn('无法获取 Git commit ID:', error);
    }

    return {
        experiments: {
            outputModule: true,
        },
        devtool: argv.mode === 'production' ? 'source-map' : 'eval-source-map',
        watchOptions: {
            ignored: ['**/dist', '**/node_modules'],
        },
        entry: path.join(__dirname, 'src/main.ts'),
        target: 'browserslist',
        output: {
            devtoolNamespace: 'tavern_helper_template',
            devtoolModuleFilenameTemplate: info => {
                const resource_path = decodeURIComponent(info.resourcePath.replace(/^\.\//, ''));
                const is_direct = info.allLoaders === '';
                const is_vue_script =
                    resource_path.match(/\.vue$/) &&
                    info.query.match(/\btype=script\b/) &&
                    !info.allLoaders.match(/\bts-loader\b/);

                return `${is_direct === true ? 'src' : 'webpack'}://${info.namespace}/${resource_path}${is_direct || is_vue_script ? '' : '?' + info.hash}`;
            },
            filename: `bundle.js`,
            path: path.join(__dirname, 'artifact'),
            chunkFilename: `bundle.[contenthash].chunk.js`,
            asyncChunks: true,
            clean: true,
            publicPath: '',
            library: {
                type: 'module',
            },
        },
        module: {
            rules: [
                {
                    test: /\.vue$/,
                    use: 'vue-loader',
                    exclude: /node_modules/,
                },
                {
                    oneOf: [
                        {
                            test: /\.tsx?$/,
                            loader: 'ts-loader',
                            options: {
                                transpileOnly: true,
                                onlyCompileBundledFiles: true,
                                compilerOptions: {
                                    noUnusedLocals: false,
                                    noUnusedParameters: false,
                                },
                            },
                            resourceQuery: /raw/,
                            type: 'asset/source',
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.(sa|sc)ss$/,
                            use: ['postcss-loader', 'sass-loader'],
                            resourceQuery: /raw/,
                            type: 'asset/source',
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.css$/,
                            use: ['postcss-loader'],
                            resourceQuery: /raw/,
                            type: 'asset/source',
                            exclude: /node_modules/,
                        },
                        {
                            resourceQuery: /raw/,
                            type: 'asset/source',
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.md$/,
                            use: [
                                {
                                    loader: 'html-loader',
                                },
                                {
                                    loader: 'remark-loader',
                                    options: {
                                        remarkOptions: {
                                            plugins: [RemarkHTML],
                                        },
                                    },
                                },
                            ],
                        },
                        {
                            test: /\.tsx?$/,
                            loader: 'ts-loader',
                            options: {
                                transpileOnly: true,
                                onlyCompileBundledFiles: true,
                                compilerOptions: {
                                    noUnusedLocals: false,
                                    noUnusedParameters: false,
                                },
                            },
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.html?$/,
                            use: 'html-loader',
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.vue\.s(a|c)ss$/,
                            use: [
                                { loader: 'vue-style-loader', options: { ssrId: true } },
                                { loader: 'css-loader', options: { url: false } },
                                'postcss-loader',
                                'sass-loader',
                            ],
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.vue\.css$/,
                            use: [
                                { loader: 'vue-style-loader', options: { ssrId: true } },
                                { loader: 'css-loader', options: { url: false } },
                                'postcss-loader',
                            ],
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.s(a|c)ss$/,
                            use: [
                                'style-loader',
                                { loader: 'css-loader', options: { url: false } },
                                'postcss-loader',
                                'sass-loader',
                            ],
                            exclude: /node_modules/,
                        },
                        {
                            test: /\.css$/,
                            use: [
                                'style-loader',
                                { loader: 'css-loader', options: { url: false } },
                                'postcss-loader',
                            ],
                            exclude: /node_modules/,
                        },
                    ],
                },
            ],
        },
        resolve: {
            extensions: ['.ts', '.js', '.tsx', '.jsx', '.css'],
            plugins: [
                new TsconfigPathsPlugin({
                    extensions: ['.ts', '.js', '.tsx', '.jsx'],
                    configFile: path.join(__dirname, 'tsconfig.json'),
                }),
            ],
            alias: {},
        },
        plugins: [
            new MiniCssExtractPlugin(),
            { apply: watch_it },
            new VueLoaderPlugin(),
            new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
            new webpack.DefinePlugin({
                __BUILD_DATE__: JSON.stringify(buildDate),
                __COMMIT_ID__: JSON.stringify(commitId),
            }),
        ],
        optimization: {
            minimize: true,
            minimizer: [
                argv.mode === 'production'
                    ? new TerserPlugin({
                          terserOptions: {
                              format: { quote_style: 1 },
                              mangle: { reserved: ['_', 'toastr', 'YAML', '$', 'z'] },
                          },
                      })
                    : new TerserPlugin({
                          extractComments: false,
                          terserOptions: {
                              format: { beautify: true, indent_level: 2 },
                              compress: false,
                              mangle: false,
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
        externals: ({ context, request }, callback) => {
            if (!context || !request) {
                return callback();
            }

            if (
                request.startsWith('@') ||
                request.startsWith('-') ||
                request.startsWith('.') ||
                request.startsWith('/') ||
                request.startsWith('!') ||
                request.startsWith('http') ||
                path.isAbsolute(request) ||
                fs.existsSync(path.join(context, request)) ||
                fs.existsSync(request)
            ) {
                return callback();
            }

            const builtin = ['vue3-pixi', 'vue-demi'];
            if (builtin.includes(request)) {
                return callback();
            }
            const global = {
                jquery: '$',
                lodash: '_',
                toastr: 'toastr',
                vue: 'Vue',
                'vue-router': 'VueRouter',
                yaml: 'YAML',
                zod: 'z',
                'pixi.js': 'PIXI',
            };
            if (request in global) {
                return callback(null, 'var ' + global[request as keyof typeof global]);
            }
            const cdn = {
                sass: 'https://jspm.dev/sass',
            };
            return callback(
                null,
                'module-import ' +
                    (cdn[request as keyof typeof cdn] ??
                        `https://testingcf.jsdelivr.net/npm/${request}/+esm`)
            );
        },
    };
}

export default config;
