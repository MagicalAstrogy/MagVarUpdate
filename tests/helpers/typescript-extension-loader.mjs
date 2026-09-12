/**
 * 测试场景：为原生 Node ESM 测试补全本地 TypeScript 导入后缀，使隔离进程能加载源码入口。
 */
/** ESM 解析：只为解析失败的本地无后缀导入补充 .ts，其他请求遵循 Node 原有规则。 */
export async function resolve(specifier, context, nextResolve) {
    try {
        return await nextResolve(specifier, context);
    } catch (error) {
        const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
        const hasExtension = /\.[^/]+$/.test(specifier);
        if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !isRelative || hasExtension) {
            throw error;
        }
        return nextResolve(`${specifier}.ts`, context);
    }
}
