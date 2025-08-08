import path from 'node:path';
import url from 'node:url';
import { Server } from 'socket.io';
import TerserPlugin from 'terser-webpack-plugin';
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin';
import webpack from 'webpack';
//const require = createRequire(import.meta.url);

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
        externalsType: 'var',
        externals: [/^_$/i, /^(jquery|\$)$/i, /^jqueryui$/i, /^toastr$/i, /^yaml$/i],
    };
}

export default config;
