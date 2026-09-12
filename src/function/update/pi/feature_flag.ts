/**
 * 读取 Pi 多服务商功能的发布开关。
 * 构建时可用 MVU_PI_MULTIPROVIDER_ENABLED=false 关闭；运行时可在加载前将
 * globalThis.__MVU_PI_MULTIPROVIDER_ENABLED__ 设为 false，运行时不能重新开启已关闭的构建。
 */
export function isPiMultiproviderEnabled(): boolean {
    const build_enabled =
        typeof __PI_MULTIPROVIDER_ENABLED__ === 'undefined' ? true : __PI_MULTIPROVIDER_ENABLED__;
    return build_enabled && globalThis.__MVU_PI_MULTIPROVIDER_ENABLED__ !== false;
}
