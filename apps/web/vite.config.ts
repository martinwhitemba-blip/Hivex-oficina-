import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// El build normal sirve la PWA. `vite build --mode single` sigue generando un HTML único.
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: single ? [viteSingleFile()] : [],
    publicDir: single ? false : 'public',
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': 'http://127.0.0.1:8787',
        '/uploads': 'http://127.0.0.1:8787',
        '/socket.io': { target: 'http://127.0.0.1:8787', ws: true },
      },
    },
    preview: {
      port: 4173,
      strictPort: true,
      proxy: {
        '/api': 'http://127.0.0.1:8787',
        '/uploads': 'http://127.0.0.1:8787',
        '/socket.io': { target: 'http://127.0.0.1:8787', ws: true },
      },
    },
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
      assetsInlineLimit: single ? 100_000_000 : 4096,
    },
  };
});
