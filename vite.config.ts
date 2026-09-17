import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3001',
    },
    watch: {
      // vite 的 watcher 遇到被独占锁定的文件会抛 EBUSY 并“直接退出”，把整个 dev 进程带走。
      //
      // 关键一条是把 tsx 的临时目录模式排除掉：`tsx watch` 重写任何被服务端 import 的文件时
      // （src/ 与 server/ 都可能被它写），会在同目录生成 `.<文件名>.<pid>.<uuid>.tmpdir/<文件名>.tmp`
      // 再改名回去；这些临时文件随时可能正被写入锁住，一旦被 watcher 抓到就 EBUSY。
      //
      // 其余为「不是前端源码、但可能被别的进程锁住」的目录：server/ 与 dist-server/ 前端不 import；
      // 浏览器自动化工具用的 user-data-dir 会被 Chrome 锁住 Default/Network/Cookies。
      // 屏蔽这些都不影响前端 HMR。
      ignored: [
        '**/.*.tmpdir',
        '**/.*.tmpdir/**',
        '**/server/**',
        '**/dist-server/**',
        '**/.cdp-profile/**',
        '**/.chrome-debug/**',
        '**/.playwright/**',
        '**/.tmp/**',
        '**/tmp-analysis/**',
      ],
    },
  },
});
