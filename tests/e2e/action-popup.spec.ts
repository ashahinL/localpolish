import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const DIST = new URL('../../dist', import.meta.url);
// The built page loads /chunks/... by absolute path, which file:// cannot resolve.
const ORIGIN = 'https://localpolish.test';

interface StubConfig {
  failSets: number;
  settings?: Record<string, unknown>;
  tabUrl: string | undefined;
  bridge: unknown;
  test: unknown;
  shortcut: string;
}

const BRIDGE_OK = {
  ok: true,
  clis: { claude: { version: '2.4.1 (Claude Code)' }, codex: { version: '0.98.0' }, grok: null },
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

async function openPopup(page: Page, overrides: Partial<StubConfig> = {}): Promise<void> {
  const config: StubConfig = {
    failSets: 0,
    tabUrl: 'https://mail.google.com/mail/u/0/',
    bridge: BRIDGE_OK,
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
    const listeners: Array<(changes: unknown, area: string) => void> = [];
    const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    const opened: string[] = [];
    const runtimeSent: Array<{ type: string }> = [];
    Object.assign(window, {
      __runtimeSent: runtimeSent,
      __store: store,
      __opened: opened,
      __bridgeCalls: 0,
      chrome: {
        storage: {
          local: {
            get: async (key: string) => (key in store ? { [key]: copy(store[key]) } : {}),
            set: async (items: Record<string, unknown>) => {
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
          sendMessage: async (message: { type: string }) => {
            runtimeSent.push(copy(message));
            if (message.type === 'bridge-status') {
              (window as unknown as { __bridgeCalls: number }).__bridgeCalls += 1;
              return cfg.bridge;
            }
            if (message.type === 'test-connection') {
              await new Promise((done) => setTimeout(done, 300));
              return cfg.test;
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
  }, config);
  await page.goto(`${ORIGIN}/popup.html`);
  await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible();
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
});

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

test('the popup body is 360 px wide', async ({ page }) => {
  await openPopup(page);
  expect(await page.evaluate(() => document.body.getBoundingClientRect().width)).toBe(360);
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

test('a failed save blocks Test connection and is retried', async ({ page }) => {
  await page.clock.install();
  await openPopup(page, { failSets: 1 });
  await page.getByRole('tab', { name: 'Provider' }).click();
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
