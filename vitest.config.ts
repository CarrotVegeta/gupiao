import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    /*
     * 只收 src / server 两棵源码树。
     * 默认的 include 是 `**\/*.test.*`，会把仓库里任何临时目录（例如调试时留下的
     * tmp-analysis/ 下的文件副本）也当成测试跑：那些副本的相对 import 解析不到，
     * 于是 `npm test` 会以 4 个 "Failed Suites" 退出——不是代码坏了，是收集范围太宽。
     */
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
  },
});
