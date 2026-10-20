import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` genera dos salidas:
//  - dist/                 → build normal (para servir desde un hosting estático)
//  - dist-single/          → un único HTML autocontenido (JS, CSS e imágenes inline)
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: single ? [viteSingleFile()] : [],
    // El HTML único no lleva manifest/service worker (no aplican en file://).
    publicDir: single ? false : 'public',
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
      assetsInlineLimit: single ? 100_000_000 : 4096,
    },
  };
});
