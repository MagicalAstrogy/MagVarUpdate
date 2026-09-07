/**
 * 测试场景：启用本地服务端取消测试模式，再交给共享酒馆浏览器启动器验证 Pi 连接关闭与主生成隔离。
 */
process.env.MVU_PI_ST_SERVER_CANCEL_SMOKE = '1';
await import('./run_pi_st_capture_smoke.mjs');
