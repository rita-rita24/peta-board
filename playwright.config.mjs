import { defineConfig } from '@playwright/test';

// Opt into other engines without changing the default regression suite.
const browserNames = [...new Set((process.env.PETA_TEST_BROWSERS || 'chromium')
  .split(',').map((name) => name.trim()).filter(Boolean))];
const supportedBrowsers = new Set(['chromium', 'firefox', 'webkit']);
if (!browserNames.length || browserNames.some((name) => !supportedBrowsers.has(name))) {
  throw new Error('PETA_TEST_BROWSERS must be a comma-separated list of chromium, firefox, or webkit.');
}

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    headless: true,
    viewport: { width: 1280, height: 900 },
    actionTimeout: 10000,
    trace: 'retain-on-failure'
  },
  projects: browserNames.map((browserName) => {
    const executablePath = process.env[`PETA_TEST_${browserName.toUpperCase()}_EXECUTABLE_PATH`];
    return {
      name: browserName,
      use: {
        browserName,
        ...(executablePath ? { launchOptions: { executablePath } } : {})
      }
    };
  })
});
