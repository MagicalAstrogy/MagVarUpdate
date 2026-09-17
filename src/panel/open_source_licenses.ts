/** 兼容性面板使用的依赖许可信息，保留包版本以便与安装结果核对。 */
export type OpenSourceLicense = Readonly<{
    /** 保留准确包名，便于对照 yarn.lock 审核。 */
    packageName: string;
    /** 内部技术包名不适合作为产品文案时使用的展示名称。 */
    displayName?: string;
    version: string;
    license: string;
    projectUrl: string;
}>;

/**
 * 收录 MVU 直接使用的运行时依赖、ESM 服务商依赖及产物中实际包含的加载器运行库。
 * 仅供构建或测试使用的工具不进入面板清单。
 */
export const OPEN_SOURCE_LICENSES = [
    {
        packageName: '@anthropic-ai/sdk',
        version: '0.123.0',
        license: 'MIT',
        projectUrl: 'https://github.com/anthropics/anthropic-sdk-typescript',
    },
    {
        packageName: '@earendil-works/pi-ai',
        displayName: 'Earendil Works AI',
        version: '0.85.1',
        license: 'MIT',
        projectUrl: 'https://github.com/earendil-works/pi',
    },
    {
        packageName: '@google/genai',
        version: '2.21.0',
        license: 'Apache-2.0',
        projectUrl: 'https://github.com/googleapis/js-genai',
    },
    {
        packageName: '@vue/devtools-api',
        version: '7.7.7',
        license: 'MIT',
        projectUrl: 'https://github.com/vuejs/devtools',
    },
    {
        packageName: '@vue/devtools-kit',
        version: '7.7.7',
        license: 'MIT',
        projectUrl: 'https://github.com/vuejs/devtools',
    },
    {
        packageName: '@vue/devtools-shared',
        version: '7.7.7',
        license: 'MIT',
        projectUrl: 'https://github.com/vuejs/devtools',
    },
    {
        packageName: 'compare-versions',
        version: '6.1.1',
        license: 'MIT',
        projectUrl: 'https://github.com/omichelsen/compare-versions',
    },
    {
        packageName: 'css-loader',
        version: '7.1.2',
        license: 'MIT',
        projectUrl: 'https://github.com/webpack-contrib/css-loader',
    },
    {
        packageName: 'fast-json-patch',
        version: '3.1.1',
        license: 'MIT',
        projectUrl: 'https://github.com/Starcounter-Jack/JSON-Patch',
    },
    {
        packageName: 'json5',
        version: '2.2.3',
        license: 'MIT',
        projectUrl: 'https://github.com/json5/json5',
    },
    {
        packageName: 'klona',
        version: '2.0.6',
        license: 'MIT',
        projectUrl: 'https://github.com/lukeed/klona',
    },
    {
        packageName: 'lodash',
        version: '4.17.21',
        license: 'MIT',
        projectUrl: 'https://github.com/lodash/lodash',
    },
    {
        packageName: 'mathjs',
        version: '12.4.3',
        license: 'Apache-2.0',
        projectUrl: 'https://github.com/josdejong/mathjs',
    },
    {
        packageName: 'openai',
        version: '6.40.0',
        license: 'Apache-2.0',
        projectUrl: 'https://github.com/openai/openai-node',
    },
    {
        packageName: 'p-retry',
        version: '4.6.2',
        license: 'MIT',
        projectUrl: 'https://github.com/sindresorhus/p-retry',
    },
    {
        packageName: 'partial-json',
        version: '0.1.7',
        license: 'MIT',
        projectUrl: 'https://github.com/promplate/partial-json-parser-js',
    },
    {
        packageName: 'pinia',
        version: '3.0.3',
        license: 'MIT',
        projectUrl: 'https://github.com/vuejs/pinia',
    },
    {
        packageName: 'retry',
        version: '0.13.1',
        license: 'MIT',
        projectUrl: 'https://github.com/tim-kos/node-retry',
    },
    {
        packageName: 'vue',
        version: '3.5.22',
        license: 'MIT',
        projectUrl: 'https://github.com/vuejs/core',
    },
    {
        packageName: 'vue-i18n',
        version: '11.1.12',
        license: 'MIT',
        projectUrl: 'https://github.com/intlify/vue-i18n',
    },
    {
        packageName: 'vue-loader',
        version: '17.4.2',
        license: 'MIT',
        projectUrl: 'https://github.com/vuejs/vue-loader',
    },
    {
        packageName: 'vue-style-loader',
        version: '4.1.3',
        license: 'MIT',
        projectUrl: 'https://github.com/vuejs/vue-style-loader',
    },
    {
        packageName: 'yaml',
        version: '2.8.1',
        license: 'ISC',
        projectUrl: 'https://github.com/eemeli/yaml',
    },
    {
        packageName: 'zod',
        version: '4.1.11',
        license: 'MIT',
        projectUrl: 'https://github.com/colinhacks/zod',
    },
] as const satisfies readonly OpenSourceLicense[];
