import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { heldSaves, holdSaves, releaseSaves, replyToTest, testPorts } from './test-owner';

const DIST = new URL('../../dist', import.meta.url);
// The built page loads /chunks/... by absolute path, which file:// cannot resolve.
const ORIGIN = 'https://localpolish.test';

interface StubConfig {
  failSets: number;
  settings?: Record<string, unknown>;
  usage?: unknown;
  failUsageRead?: boolean;
  tabUrl: string | undefined;
  bridge: unknown;
  holdBridge: boolean;
  holdTest: boolean;
  test: unknown;
  shortcut: string;
}

const BRIDGE_OK = {
  ok: true,
  clis: {
    claude: { version: '2.4.1 (Claude Code)' },
    codex: { version: '0.98.0' },
    grok: null,
    agy: null,
  },
};

const BRIDGE_MISSING =
  'The LocalPolish bridge is not installed. In the LocalPolish folder run: npm run bridge:install';

const test = base.extend<{ page: Page }, { sharedContext: BrowserContext }>({
  sharedContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext();
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
  page: async ({ sharedContext }, use) => {
    const page = await sharedContext.newPage();
    await use(page);
    await page.close();
  },
});

async function openPopup(
  page: Page,
  overrides: Partial<StubConfig> = {},
  path: 'popup.html' | 'setup.html' = 'popup.html',
): Promise<void> {
  const config: StubConfig = {
    failSets: 0,
    tabUrl: 'https://mail.google.com/mail/u/0/',
    bridge: BRIDGE_OK,
    holdBridge: false,
    holdTest: false,
    test: { ok: true, sample: 'Hello.', ms: 1234 },
    shortcut: '⇧⌘K',
    ...overrides,
  };
  await page.route(`${ORIGIN}/**`, (route) => {
    const file = new URL(DIST.href + new URL(route.request().url()).pathname);
    return route.fulfill({ path: fileURLToPath(file) });
  });
  await page.addInitScript((cfg: StubConfig) => {
    const store: Record<string, unknown> = {};
    if (cfg.settings) store.settings = cfg.settings;
    if (cfg.usage !== undefined) store.usage = cfg.usage;
    const listeners: Array<(changes: unknown, area: string) => void> = [];
    const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    const opened: string[] = [];
    const runtimeSent: Array<{ type: string }> = [];
    const bridgeHeld: Array<(reply: unknown) => void> = [];
    const testPorts: Array<{
      disconnected: boolean;
      disconnects: number;
      reply(result: unknown): void;
      disconnect(): void;
    }> = [];
    const saveHeld: Array<() => void> = [];
    Object.assign(window, {
      __runtimeSent: runtimeSent,
      __store: store,
      __opened: opened,
      __bridgeCalls: 0,
      __bridgeHeld: bridgeHeld,
      __testPorts: testPorts,
      __holdSaves: false,
      __saveHeld: saveHeld,
      chrome: {
        storage: {
          local: {
            get: async (key: string) => {
              if (key === 'usage' && cfg.failUsageRead) throw new Error('Usage read failed');
              return key in store ? { [key]: copy(store[key]) } : {};
            },
            set: async (items: Record<string, unknown>) => {
              if ((window as unknown as { __holdSaves: boolean }).__holdSaves) {
                await new Promise<void>((resolve) => saveHeld.push(resolve));
              }
              if (cfg.failSets > 0) {
                cfg.failSets -= 1;
                throw new Error('Storage write failed');
              }
              const changes: Record<string, unknown> = {};
              for (const [key, value] of Object.entries(items)) {
                store[key] = copy(value);
                changes[key] = { newValue: copy(value) };
              }
              for (const listener of listeners) listener(changes, 'local');
            },
          },
          onChanged: {
            addListener: (cb: (changes: unknown, area: string) => void) => listeners.push(cb),
            removeListener: () => {},
          },
        },
        runtime: {
          connect: ({ name }: { name: string }) => {
            if (name !== 'test-connection') throw new Error(`Unexpected port ${name}`);
            const messages: Array<(message: unknown) => void> = [];
            const disconnects: Array<() => void> = [];
            let accepted = false;
            const port = {
              disconnected: false,
              disconnects: 0,
              reply: (result: unknown) => messages.forEach((cb) => cb({ type: 'result', result })),
              postMessage: (message: { type: string }) => {
                if (accepted || port.disconnected) return;
                if (message.type !== 'test-connection') throw new Error('Invalid test start');
                accepted = true;
                runtimeSent.push(copy(message));
                if (!cfg.holdTest) setTimeout(() => port.reply(cfg.test), 300);
              },
              disconnect: () => {
                if (port.disconnected) return;
                port.disconnected = true;
                port.disconnects++;
                disconnects.forEach((cb) => cb());
              },
              onMessage: { addListener: (cb: (message: unknown) => void) => messages.push(cb) },
              onDisconnect: { addListener: (cb: () => void) => disconnects.push(cb) },
            };
            testPorts.push(port);
            return port;
          },
          sendMessage: async (message: { type: string }) => {
            runtimeSent.push(copy(message));
            if (message.type === 'bridge-status') {
              (window as unknown as { __bridgeCalls: number }).__bridgeCalls += 1;
              if (cfg.holdBridge) return new Promise((reply) => bridgeHeld.push(reply));
              return cfg.bridge;
            }
            return undefined;
          },
          openOptionsPage: async () => {
            opened.push('options');
          },
          getManifest: () => ({ version: '1.2.3' }),
        },
        commands: { getAll: async () => [{ name: 'polish', shortcut: cfg.shortcut }] },
        tabs: {
          query: async () => [{ url: cfg.tabUrl }],
          create: async (props: { url: string }) => {
            opened.push(props.url);
            return {};
          },
        },
      },
    });
    window.addEventListener('pagehide', () => testPorts.forEach((port) => port.disconnect()));
  }, config);
  await page.goto(`${ORIGIN}/${path}`);
  if (path === 'popup.html') await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible();
  else await expect(page.getByRole('heading', { name: 'Set up LocalPolish' })).toBeVisible();
}

function stored(page: Page): Promise<Record<string, unknown> | undefined> {
  return page.evaluate(
    () =>
      (window as unknown as { __store: Record<string, Record<string, unknown>> }).__store.settings,
  );
}

function opened(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
}

function bridgeCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __bridgeCalls: number }).__bridgeCalls);
}

function bridgeForces(page: Page): Promise<Array<boolean | undefined>> {
  return page.evaluate(() =>
    (window as unknown as { __runtimeSent: Array<{ type: string; force?: boolean }> }).__runtimeSent
      .filter((message) => message.type === 'bridge-status')
      .map((message) => message.force),
  );
}

async function releaseBridge(page: Page, index: number, reply: unknown): Promise<void> {
  await page.evaluate(
    async ([at, value]) => {
      const held = (window as unknown as { __bridgeHeld: Array<(reply: unknown) => void> })
        .__bridgeHeld[at as number];
      if (!held) throw new Error(`No held bridge call ${String(at)}`);
      held(value);
      // Let pending state updates render before checking that a stale reply stayed hidden.
      await new Promise<void>((done) => requestAnimationFrame(() => done()));
    },
    [index, reply],
  );
}

// The radio itself is hidden. The visible control is its label, same as the options page.
function radioLabel(page: Page, name: string) {
  return page.locator('label', { has: page.getByRole('radio', { name, exact: true }) });
}

test('Home shows the default provider and Change opens Provider', async ({ page }) => {
  await openPopup(page);
  await expect(page.getByText('Codex', { exact: true })).toBeVisible();
  await expect(page.getByText('GPT-6 Luna · Effort: None')).toBeVisible();
  await expect(page.getByText('Bridge ready')).toBeVisible();

  await page.getByRole('button', { name: 'Change' }).click();
  await expect(page.getByRole('tab', { name: 'Provider' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('Fix while I type stores idleFix off', async ({ page }) => {
  await openPopup(page);
  const toggle = page.getByRole('switch', { name: 'Fix while I type' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  await toggle.click();
  await expect.poll(async () => (await stored(page))?.idleFix).toBe(false);
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('language chips show the stored values and toggle each language', async ({ page }) => {
  await openPopup(page, { settings: { languages: { ar: false } } });
  const group = page.getByRole('group', { name: 'Languages to fix while I type' });
  const chips = [
    { name: 'English', text: 'EN', id: 'en', on: true },
    { name: 'Arabic', text: 'AR', id: 'ar', on: false },
    { name: 'Franco-Arabic', text: 'Franco', id: 'franco', on: true },
    { name: 'Other languages', text: 'Other', id: 'other', on: true },
  ];
  const expected: Record<string, boolean> = { en: true, ar: false, franco: true, other: true };
  for (const { name, text, id, on } of chips) {
    const chip = group.getByRole('button', { name, exact: true });
    await expect(chip).toHaveText(text);
    await expect(chip).toHaveAttribute('aria-pressed', String(on));

    await chip.click();
    expected[id] = !on;
    await expect.poll(async () => (await stored(page))?.languages).toEqual(expected);
    await expect(chip).toHaveAttribute('aria-pressed', String(!on));
  }
});

test('language chips are hidden while Fix while I type is off', async ({ page }) => {
  await openPopup(page, { settings: { idleFix: false } });
  const group = page.getByRole('group', { name: 'Languages to fix while I type' });
  await expect(group).toBeHidden();

  await page.getByRole('switch', { name: 'Fix while I type' }).click();
  await expect(group).toBeVisible();
  await expect(group.getByRole('button')).toHaveCount(4);
});

test('the site switch hides and shows mail.google.com', async ({ page }) => {
  await openPopup(page);
  const toggle = page.getByRole('switch', { name: 'Show on mail.google.com' });

  await toggle.click();
  await expect.poll(async () => (await stored(page))?.blocklist).toEqual(['mail.google.com']);
  await expect(toggle).toHaveAccessibleDescription('Hidden here. The shortcut still works');
  await expect(
    page.getByText('Hidden here. The shortcut still works', { exact: true }),
  ).toBeHidden();

  await toggle.click();
  await expect.poll(async () => (await stored(page))?.blocklist).toEqual([]);
});

test('a broader blocklist disables the site switch', async ({ page }) => {
  await openPopup(page, { settings: { blocklist: ['google.com'] } });
  const toggle = page.getByRole('switch', { name: 'Show on mail.google.com' });
  await expect(toggle).toBeDisabled();
  await expect(page.getByText('Hidden by google.com.')).toBeVisible();

  await page.getByRole('button', { name: 'Edit in Sites' }).click();
  await expect(page.getByRole('tab', { name: 'Sites' })).toHaveAttribute('aria-selected', 'true');
});

test('a browser page disables the site switch', async ({ page }) => {
  await openPopup(page, { tabUrl: 'chrome://extensions/' });
  const toggle = page.getByRole('switch', { name: 'This page' });
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAccessibleDescription('LocalPolish does not run on this page');
  await expect(
    page.getByText('LocalPolish does not run on this page', { exact: true }),
  ).toBeHidden();
});

test('a missing bridge shows the install hint and marks Provider', async ({ page }) => {
  await openPopup(page, { bridge: { ok: false, message: BRIDGE_MISSING } });
  await expect(page.getByText(BRIDGE_MISSING)).toBeVisible();
  await expect(page.locator('code', { hasText: 'npm run bridge:install' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Provider' })).toHaveAccessibleName(/needs attention/);
});

test('Test connection shows a success', async ({ page }) => {
  await openPopup(page);
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Works. Got “Hello.” in 1.2 s')).toBeVisible();
});

test('Test connection shows a failure', async ({ page }) => {
  await openPopup(page, { test: { ok: false, message: 'Timed out after 45 seconds.' } });
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Test failed')).toBeVisible();
  await expect(page.getByText('Timed out after 45 seconds.')).toBeVisible();
});

test("switching provider shows that provider's fields", async ({ page }) => {
  await openPopup(page, { settings: { provider: 'claude-cli' } });
  await page.getByRole('tab', { name: 'Provider' }).click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('haiku');
  await expect(page.getByLabel('Thinking effort', { exact: true })).toHaveValue('low');

  await radioLabel(page, 'OpenAI-compatible').click();
  await expect(page.getByLabel('Base URL', { exact: true })).toBeVisible();
  const apiKey = page.getByLabel('API key', { exact: true });
  await expect(apiKey).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show', exact: true }).click();
  await expect(apiKey).toHaveAttribute('type', 'text');
  await expect(page.getByLabel('Temperature', { exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page))?.provider).toBe('openai-compatible');

  await radioLabel(page, 'Anthropic API').click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('claude-haiku-5-5');

  await radioLabel(page, 'Codex').click();
  await expect(page.getByText('Codex needs its own login')).toBeVisible();

  await radioLabel(page, 'Antigravity CLI').click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gemini-3.8-flash');
  await expect(page.getByLabel('Thinking effort', { exact: true })).toHaveValue('low');
  await expect(page.getByText('Antigravity needs its own login')).toBeVisible();
  await expect.poll(async () => (await stored(page))?.provider).toBe('antigravity-cli');
});

test('bridge rows and Check again asks again', async ({ page }) => {
  await openPopup(page);
  await page.getByRole('tab', { name: 'Provider' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Claude Code' })).toContainText(
    '2.4.1 (Claude Code)',
  );
  await expect(page.getByRole('listitem').filter({ hasText: 'Grok CLI' })).toContainText(
    'not found',
  );

  const again = page.getByRole('button', { name: 'Check again' });
  await expect(again).toBeEnabled();
  const before = await bridgeCalls(page);
  await again.click();
  await expect.poll(() => bridgeCalls(page)).toBe(before + 1);
  expect(await bridgeForces(page)).toEqual([false, true]);
});

for (const { path, colorScheme, width } of [
  { path: 'popup.html', colorScheme: 'light', width: 400 },
  { path: 'popup.html', colorScheme: 'dark', width: 400 },
  { path: 'setup.html', colorScheme: 'light', width: 720 },
  { path: 'setup.html', colorScheme: 'dark', width: 720 },
] as const) {
  test(`${path} ${colorScheme}: API skips the bridge check and old replies cannot replace a new one`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: path === 'popup.html' ? 600 : 950 });
    await page.emulateMedia({ colorScheme });
    await openPopup(page, { settings: { provider: 'anthropic-api' }, holdBridge: true }, path);
    if (path === 'popup.html') await page.getByRole('tab', { name: 'Provider' }).click();
    await expect(page.getByLabel('Model', { exact: true })).toHaveValue('claude-haiku-5-5');
    expect(await bridgeCalls(page)).toBe(0);
    await expect(page.getByRole('heading', { name: 'Bridge' })).toHaveCount(0);

    await radioLabel(page, 'Claude Code').click();
    await expect.poll(() => bridgeCalls(page)).toBe(1);
    expect(await bridgeForces(page)).toEqual([false]);
    await expect(page.getByText('Checking…')).toBeVisible();

    await radioLabel(page, 'Anthropic API').click();
    await expect(page.getByRole('heading', { name: 'Bridge' })).toHaveCount(0);
    expect(await bridgeCalls(page)).toBe(1);

    await radioLabel(page, 'Claude Code').click();
    await expect.poll(() => bridgeCalls(page)).toBe(2);
    expect(await bridgeForces(page)).toEqual([false, false]);
    const again = page.getByRole('button', { name: 'Check again' });
    await expect(page.getByText('Checking…')).toBeVisible();
    await expect(again).toBeDisabled();

    await releaseBridge(page, 0, { ok: false, message: BRIDGE_MISSING });
    await expect(page.getByText(BRIDGE_MISSING)).toHaveCount(0);
    await expect(page.getByText('Checking…')).toBeVisible();
    await expect(again).toBeDisabled();

    await releaseBridge(page, 1, BRIDGE_OK);
    await expect(page.locator('.clis li', { hasText: 'Claude Code' })).toContainText(
      '2.4.1 (Claude Code)',
    );
    await expect(again).toBeEnabled();
    await expect(page.getByText(BRIDGE_MISSING)).toHaveCount(0);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.locator('.clis li').last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('bridge.png'), fullPage: true });

    await again.click();
    await expect.poll(() => bridgeCalls(page)).toBe(3);
    expect(await bridgeForces(page)).toEqual([false, false, true]);
    await expect(again).toBeDisabled();
    await releaseBridge(page, 2, { ok: false, message: BRIDGE_MISSING });
    await expect(page.getByText(BRIDGE_MISSING)).toBeVisible();
    await expect(page.getByText('Checking…')).toHaveCount(0);
    await expect(again).toBeEnabled();

    await radioLabel(page, 'Anthropic API').click();
    await page.getByRole('button', { name: 'Open the full options page' }).click();
    await expect.poll(() => opened(page)).toContain('options');
    expect(await bridgeCalls(page)).toBe(3);
  });
}

test('Sites tab adds a site, rejects a duplicate and removes it', async ({ page }) => {
  await openPopup(page);
  await page.getByRole('tab', { name: 'Sites' }).click();
  await page.getByLabel('Add a site').fill('Example.com');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(async () => (await stored(page))?.blocklist).toEqual(['example.com']);
  await expect(page.getByText('example.com', { exact: true })).toBeVisible();

  await page.getByLabel('Add a site').fill('example.com');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Already in the list');

  await page.getByRole('button', { name: 'Remove example.com' }).click();
  await expect.poll(async () => (await stored(page))?.blocklist).toEqual([]);
});

test('Hide on this tab stores the host and tags the row', async ({ page }) => {
  await openPopup(page);
  await page.getByRole('tab', { name: 'Sites' }).click();
  await page.getByRole('button', { name: 'Hide on mail.google.com' }).click();
  await expect.poll(async () => (await stored(page))?.blocklist).toEqual(['mail.google.com']);
  await expect(page.getByText('This tab', { exact: true })).toBeVisible();
});

test('Shorter becomes the default mode', async ({ page }) => {
  await openPopup(page);
  await radioLabel(page, 'Shorter').click();
  await expect.poll(async () => (await stored(page))?.defaultMode).toBe('shorter');
});

test('About shows the shortcut and opens the other pages', async ({ page }) => {
  await openPopup(page);
  await page.getByRole('tab', { name: 'About' }).click();
  await expect(page.locator('kbd')).toHaveText(['⇧', '⌘', 'K']);

  await page.getByRole('button', { name: 'Change shortcut' }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('button', { name: 'Open the full options page' }).click();
  await expect
    .poll(() => opened(page))
    .toEqual(['chrome://extensions/shortcuts', 'options', 'options']);
  await expect(page.getByText('LocalPolish 1.2.3')).toBeVisible();
});

test('arrow keys move between tabs', async ({ page }) => {
  await openPopup(page);
  await page.getByRole('tab', { name: 'Home' }).focus();
  await page.keyboard.press('ArrowRight');

  const provider = page.getByRole('tab', { name: 'Provider' });
  await expect(provider).toHaveAttribute('aria-selected', 'true');
  await expect(provider).toBeFocused();

  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true');
});

test('the popup body is 400 px wide', async ({ page }) => {
  await openPopup(page);
  expect(await page.evaluate(() => document.body.getBoundingClientRect().width)).toBe(400);
});

test('hover help shows after 2 seconds', async ({ page }) => {
  await page.clock.install();
  try {
    await openPopup(page);
    // Real time must not cross the rest of the delay while the assertion runs.
    await page.clock.pauseAt(Date.now() + 10_000);

    const label = page.getByText('Fix while I type', { exact: true });
    const tip = page.locator('#idle-desc');
    await label.hover();
    await page.clock.runFor(1900);
    await expect(tip).toBeHidden();
    await page.clock.runFor(100);
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText('Fixes a field after a 3 s pause');

    await page.mouse.move(0, 0);
    await expect(tip).toBeHidden();

    const toggle = page.getByRole('switch', { name: 'Fix while I type' });
    for (
      let step = 0;
      step < 8 && !(await toggle.evaluate((el) => el === document.activeElement));
      step++
    ) {
      await page.keyboard.press('Tab');
    }
    await expect(toggle).toBeFocused();
    await expect(tip).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
  } finally {
    await page.clock.resume();
  }
});

for (const path of ['popup.html', 'setup.html'] as const) {
  test(`${path} failed save blocks Test connection and is retried`, async ({ page }) => {
    await page.clock.install();
    await openPopup(page, { failSets: 1 }, path);
    if (path === 'popup.html') await page.getByRole('tab', { name: 'Provider' }).click();
    await page.getByLabel('Model', { exact: true }).selectOption({ label: 'Custom…' });
    await page.clock.pauseAt(Date.now() + 10_000);
    try {
      await page.getByLabel('Custom model', { exact: true }).fill('custom-retry-model');
      const run = page.getByRole('button', { name: 'Test connection' });
      // Keep focus in the input so the button's flush handles the pending typing edit.
      await run.dispatchEvent('click');
      await expect(page.getByText('Could not save: Storage write failed')).toBeVisible();
      await expect(
        page.getByText('Settings were not saved, so the test did not run. Try again.'),
      ).toBeVisible();
      await expect(run).toBeEnabled();
      const testMessages = () =>
        page.evaluate(() =>
          (window as unknown as { __runtimeSent: Array<{ type: string }> }).__runtimeSent.filter(
            (message) => message.type === 'test-connection',
          ),
        );
      expect(await testMessages()).toHaveLength(0);
      expect(
        ((await stored(page))?.models as Record<string, string> | undefined)?.['codex-cli'],
      ).not.toBe('custom-retry-model');

      await run.click();
      await expect
        .poll(async () => ((await stored(page))?.models as Record<string, string>)?.['codex-cli'])
        .toBe('custom-retry-model');
      await expect.poll(testMessages).toHaveLength(1);
      await page.clock.runFor(300);
      await expect(page.getByText('Works. Got “Hello.” in 1.2 s')).toBeVisible();
      await expect(page.getByText('Could not save: Storage write failed')).toHaveCount(0);
    } finally {
      await page.clock.resume();
    }
  });
}

const LONG_MODEL = `my-org/${'very-long-custom-model-name-'.repeat(6)}q4_k_m`;

const SEEDED_USAGE = [
  { provider: 'claude-cli', model: 'haiku', requests: 3 },
  { provider: 'codex-cli', model: '', requests: 7 },
  { provider: 'openai-compatible', model: LONG_MODEL, requests: 12 },
  { provider: 'anthropic-api', model: 'claude-haiku-5-5', requests: 3 },
];

function usageRegion(page: Page) {
  return page.getByRole('region', { name: 'Usage' });
}

function usageCells(page: Page): Promise<string[][]> {
  return usageRegion(page)
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) =>
        Array.from((row as HTMLTableRowElement).cells, (cell) => cell.textContent ?? ''),
      ),
    );
}

test('Usage shows an empty state without numbers', async ({ page }) => {
  await openPopup(page);
  const usage = usageRegion(page);
  await expect(usage.getByText('No requests recorded yet.')).toBeVisible();
  await expect(usage.getByText('Cached answers do not count.', { exact: false })).toBeVisible();
  await expect(usage.getByRole('table')).toHaveCount(0);
  await expect(usage).not.toContainText(/\d/);
});

test('Usage lists each provider and model with a total', async ({ page }) => {
  await openPopup(page, { usage: SEEDED_USAGE });
  const usage = usageRegion(page);
  const table = usage.getByRole('table');
  await expect(table.getByRole('columnheader')).toHaveText(['Model', 'Provider', 'Requests']);
  await expect
    .poll(() => usageCells(page))
    .toEqual([
      [LONG_MODEL, 'OpenAI-compatible API', '12'],
      ['Unknown (CLI default)', 'Codex', '7'],
      ['claude-haiku-5-5', 'Anthropic API', '3'],
      ['haiku', 'Claude Code', '3'],
    ]);
  await expect(table.getByRole('row', { name: /Total/ })).toContainText('25');

  // The long custom name wraps inside the card, and counts stay right aligned.
  const layout = await usage.evaluate((section) => {
    const count = section.querySelector('tbody td.usage-num') as HTMLElement;
    return {
      overflow: section.scrollWidth - section.clientWidth,
      align: getComputedStyle(count).textAlign,
    };
  });
  expect(layout.overflow).toBeLessThanOrEqual(0);
  expect(layout.align).toBe('right');
});

test('Usage updates live when the counts change in storage', async ({ page }) => {
  await openPopup(page, { usage: [{ provider: 'claude-cli', model: 'haiku', requests: 1 }] });
  await expect.poll(() => usageCells(page)).toEqual([['haiku', 'Claude Code', '1']]);

  await page.evaluate(() =>
    (
      window as unknown as {
        chrome: { storage: { local: { set(items: unknown): Promise<void> } } };
      }
    ).chrome.storage.local.set({
      usage: [
        { provider: 'claude-cli', model: 'haiku', requests: 2 },
        { provider: 'grok-cli', model: '', requests: 1 },
      ],
    }),
  );
  await expect
    .poll(() => usageCells(page))
    .toEqual([
      ['haiku', 'Claude Code', '2'],
      ['Unknown (CLI default)', 'Grok CLI', '1'],
    ]);
  await expect(usageRegion(page).getByRole('row', { name: /Total/ })).toContainText('3');
});

test('Usage shows a load failure instead of zero', async ({ page }) => {
  await openPopup(page, { usage: SEEDED_USAGE, failUsageRead: true });
  const usage = usageRegion(page);
  await expect(usage.getByRole('alert')).toHaveText('Could not load usage: Usage read failed');
  await expect(usage.getByText('No requests recorded yet.')).toHaveCount(0);
  await expect(usage.getByRole('table')).toHaveCount(0);
});

for (const path of ['popup.html', 'setup.html'] as const) {
  test(`${path} provider change cancels the test and ignores a late answer`, async ({ page }) => {
    await openPopup(page, { holdTest: true, settings: { provider: 'claude-cli' } }, path);
    const run = page.getByRole('button', { name: 'Test connection' });
    await run.click();
    await expect.poll(() => testPorts(page).then((ports) => ports.length)).toBe(1);
    await expect(run).toBeDisabled();
    if (path === 'popup.html') await page.getByRole('tab', { name: 'Provider' }).click();
    await radioLabel(page, 'OpenAI-compatible').click();
    await expect.poll(() => testPorts(page)).toEqual([{ disconnected: true, disconnects: 1 }]);
    await expect(run).toBeEnabled();
    await replyToTest(page, 0, 'Old provider.');
    await expect(page.getByText('Old provider.', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Testing…')).toHaveCount(0);
    await run.click();
    await expect.poll(() => testPorts(page).then((ports) => ports.length)).toBe(2);
    await replyToTest(page, 1, 'Current provider.');
    await expect(page.getByText('Works. Got “Current provider.” in 0.1 s')).toBeVisible();
    await expect(run).toBeEnabled();
  });

  test(`${path} replacement disconnects the old run without showing its result`, async ({
    page,
  }) => {
    await openPopup(page, { holdTest: true }, path);
    const run = page.getByRole('button', { name: 'Test connection' });
    await run.click();
    await expect.poll(() => testPorts(page).then((ports) => ports.length)).toBe(1);
    await run.dispatchEvent('click');
    await expect
      .poll(() => testPorts(page))
      .toEqual([
        { disconnected: true, disconnects: 1 },
        { disconnected: false, disconnects: 0 },
      ]);
    await replyToTest(page, 0, 'Replaced answer.');
    await expect(page.getByText('Replaced answer.', { exact: false })).toHaveCount(0);
    await expect(run).toBeDisabled();
    await replyToTest(page, 1, 'Replacement.');
    await expect(page.getByText('Works. Got “Replacement.” in 0.1 s')).toBeVisible();
    await expect(run).toBeEnabled();
  });

  test(`${path} cannot start an abandoned save after changing provider`, async ({ page }) => {
    await openPopup(page, { holdTest: true, settings: { provider: 'claude-cli' } }, path);
    if (path === 'popup.html') await page.getByRole('tab', { name: 'Provider' }).click();
    await holdSaves(page);
    await page.getByLabel('Model', { exact: true }).selectOption({ label: 'Custom…' });
    await page.getByLabel('Custom model', { exact: true }).fill('held-model');
    const run = page.getByRole('button', { name: 'Test connection' });
    await run.dispatchEvent('click');
    await expect.poll(() => heldSaves(page)).toBe(1);
    await expect(run).toBeDisabled();
    await radioLabel(page, 'OpenAI-compatible').click();
    await expect(run).toBeEnabled();
    await releaseSaves(page);
    await expect.poll(async () => (await stored(page))?.provider).toBe('openai-compatible');
    expect(await testPorts(page)).toEqual([]);
    await expect(page.getByText('Testing…')).toHaveCount(0);
    await expect(
      page.getByText('Settings were not saved, so the test did not run. Try again.'),
    ).toHaveCount(0);
  });
}
