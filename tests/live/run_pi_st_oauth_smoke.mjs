/**
 * 测试场景：启用 OAuth 界面测试模式，再交给共享酒馆浏览器启动器执行授权与凭证生命周期场景。
 */
process.env.MVU_PI_ST_OAUTH_SMOKE = '1';
await import('./run_pi_st_capture_smoke.mjs');
