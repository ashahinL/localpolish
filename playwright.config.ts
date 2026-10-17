import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: {
    baseURL: 'http://localhost:5179',
    browserName: 'chromium',
    headless: true,
    // Some macOS sandboxes deny Chromium's Mach-port rendezvous, so the browser
    // never starts. One process skips that IPC. Closing a context then exits
    // the browser; the e2e fixture keeps a single context for the worker.
    launchOptions: { args: ['--single-process'] },
  },
  webServer: {
    command: 'npx vite --config tests/e2e/vite.config.ts',
    port: 5179,
    reuseExistingServer: true,
  },
});
