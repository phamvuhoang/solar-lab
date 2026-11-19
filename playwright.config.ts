import { defineConfig } from '@playwright/test';
import { createServer } from 'node:net';

// Free port, chosen once: workers inherit env set by the main process.
process.env.SOLAR_PORT ??= String(
  await new Promise<number>((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  }),
);
const port = process.env.SOLAR_PORT;

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: `http://127.0.0.1:${port}`, channel: process.env.CI ? undefined : 'chrome' },
  webServer: {
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
