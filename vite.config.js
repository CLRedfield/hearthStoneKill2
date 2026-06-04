import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
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
});
