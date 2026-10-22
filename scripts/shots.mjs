#!/usr/bin/env node
/**
 * Renders the real toolbar popup from dist/ into docs/screenshots, one PNG per
 * tab at 400x600 (2x). Chrome APIs are stubbed with a fixed demo state, so the
 * pictures do not depend on this machine's settings, bridge or CLIs.
 * Run it with `npm run shots`, which builds first.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'docs', 'screenshots');
// The built page loads /chunks/... by absolute path, which file:// cannot resolve.
const ORIGIN = 'https://localpolish.test';
const version = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8')).version;

const STATE = {
  version,
  tabUrl: 'https://mail.google.com/mail/u/0/',
  settings: { blocklist: ['bank.example.com', 'docs.google.com'], languages: { other: false } },
  bridge: {
    ok: true,
    clis: {
      claude: { version: '2.4.1 (Claude Code)' },
      codex: { version: '0.98.0' },
      grok: { version: '1.3.0' },
      agy: { version: '1.4.4' },
    },
  },
};

const SHOTS = [
  { file: 'home.png', tab: 'Home', scheme: 'light' },
  { file: 'provider.png', tab: 'Provider', scheme: 'light' },
  { file: 'sites.png', tab: 'Sites', scheme: 'light' },
  { file: 'about.png', tab: 'About', scheme: 'light' },
  { file: 'home-dark.png', tab: 'Home', scheme: 'dark' },
];

function stubChrome(state) {
  const store = { settings: state.settings };
  const copy = (value) => JSON.parse(JSON.stringify(value));
  window.chrome = {
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: copy(store[key]) } : {}),
        set: async (items) => Object.assign(store, copy(items)),
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
    runtime: {
      sendMessage: async (message) => (message.type === 'bridge-status' ? state.bridge : undefined),
      openOptionsPage: async () => {},
      getManifest: () => ({ version: state.version }),
    },
    commands: { getAll: async () => [{ name: 'polish', shortcut: '⇧⌘K' }] },
    tabs: {
      query: async () => [{ id: 1, windowId: 1, url: state.tabUrl }],
      create: async () => ({}),
    },
  };
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'popup.html'))) {
    console.error('dist/popup.html is missing. Run npm run build first.');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  // One process, so one context: with --single-process, closing a context ends the browser.
  const browser = await chromium.launch({ args: ['--single-process'] });
  try {
    const context = await browser.newContext({
      viewport: { width: 400, height: 600 },
      deviceScaleFactor: 2,
    });
    await context.route(`${ORIGIN}/**`, (route) =>
      route.fulfill({ path: path.join(DIST, new URL(route.request().url()).pathname) }),
    );
    await context.addInitScript(stubChrome, STATE);
    for (const shot of SHOTS) {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: shot.scheme });
      await page.goto(`${ORIGIN}/popup.html`);
      await page.getByRole('tab', { name: shot.tab }).click();
      await page.waitForTimeout(300);
      const file = path.join(OUT, shot.file);
      await page.screenshot({ path: file });
      console.log(path.relative(ROOT, file));
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
