import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    setupFiles: ['./test/setup.ts'],
    env: {
      DATABASE_URL: 'file:./test.db',
      JWT_SECRET: 'test-secret-hivex-beta',
      UPLOAD_DIR: '/tmp/hivex-uploads-test',
      WEB_ORIGIN: 'http://localhost:5173',
      NODE_ENV: 'test',
      SEED_ON_BOOT: '0',
      SERVE_STATIC: '0',
    },
  },
});
