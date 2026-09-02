/**
 * Release kill switch for the Pi multiprovider path.
 *
 * - Build-time: `MVU_PI_MULTIPROVIDER_ENABLED=false yarn build` makes the path unavailable.
 * - Runtime: set `globalThis.__MVU_PI_MULTIPROVIDER_ENABLED__ = false` before MVU loads, then
 *   reload the page. A runtime override cannot re-enable a build that was compiled off.
 */
export function isPiMultiproviderEnabled(): boolean {
    const build_enabled =
        typeof __PI_MULTIPROVIDER_ENABLED__ === 'undefined' ? true : __PI_MULTIPROVIDER_ENABLED__;
    return build_enabled && globalThis.__MVU_PI_MULTIPROVIDER_ENABLED__ !== false;
}
