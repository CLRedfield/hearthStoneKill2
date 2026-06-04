import { defineConfig } from 'vite';

// GitHub Pages 部署在 https://<user>.github.io/hearthStoneKill2/ 子路径下，
// 构建时需要把 base 设为该子路径；本地 dev 仍用根路径 '/'。
export default defineConfig(({ command }) => ({
  root: '.',
  base: command === 'build' ? '/hearthStoneKill2/' : '/',
  // mqtt.js 在浏览器端需要 global 指向 globalThis
  define: {
    global: 'globalThis',
  },
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
}));
