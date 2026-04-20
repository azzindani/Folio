import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  define: {
    __DEV__: mode === 'development',
    __PROD__: mode === 'production',
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: mode !== 'production',
    minify: mode === 'production' ? 'esbuild' : false,
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 3000,
    open: false,
    strictPort: false,
    allowedHosts: true,
  },
  preview: {
    port: 4173,
    allowedHosts: true,
  },
}));
