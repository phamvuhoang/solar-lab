import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(process.env.BUILD_ID ?? 'dev') },
  build: { target: 'es2022' },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
