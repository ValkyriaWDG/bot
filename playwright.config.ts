import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  outputDir: '.local/lab/playwright-results',
  reporter: [['list'], ['html', { outputFolder: '.local/lab/playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4178',
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/lab-server.mjs',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
    timeout: 15_000,
    env: { LAB_PORT: '4178' },
  },
});
