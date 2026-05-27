import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright smoke tests pour Novus Epoxy.
 * Tests les pages PUBLIQUES (pas besoin d'auth) en prod.
 * Pages admin protégées par NextAuth — testées séparément via session token si besoin.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://novus-epoxy.vercel.app',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
