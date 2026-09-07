/**
 * 测试场景：启用 Pi 功能测试模式，再交给共享酒馆浏览器启动器执行协议能力和生命周期场景。
 */
process.env.MVU_PI_ST_FEATURE_SMOKE = '1';
await import('./run_pi_st_capture_smoke.mjs');
