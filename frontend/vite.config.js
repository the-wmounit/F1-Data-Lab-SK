import { defineConfig } from 'vite';
export default defineConfig({
  base: '/reference/',
  build: { outDir: '../wwwroot/reference', emptyOutDir: true, rollupOptions: { output: { manualChunks: { three: ['three', 'three/addons/controls/OrbitControls.js'] } } } },
  server: { proxy: { '/api': 'http://localhost:5080', '/models': 'http://localhost:5080' } }
});
