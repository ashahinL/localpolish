import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const DIST = new URL('../../dist', import.meta.url);
// The built page loads /chunks/... by absolute path, which file:// cannot resolve.
const ORIGIN = 'https://localpolish.test';

interface StubConfig {
  failSets: number;
  settings?: Record<string, unknown>;
  usage?: unknown;
  failUsageRead?: boolean;
  bridge: unknown;
  test: unknown;
  shortcut: string;
}

const BRIDGE_OK = {
  ok: true,
  clis: { claude: { version: '2.4.1 (Claude Code)' }, codex: { version: '0.98.0' }, grok: null },
};

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

async function openOptions(page: Page, overrides: Partial<StubConfig> = {}): Promise<void> {
  const config: StubConfig = {
    failSets: 0,
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
    if (cfg.usage !== undefined) store.usage = cfg.usage;
    const listeners: Array<(changes: unknown, area: string) => void> = [];
    const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    const runtimeSent: Array<{ type: string }> = [];
    Object.assign(window, {
      __runtimeSent: runtimeSent,
      __store: store,
      chrome: {
        storage: {
          local: {
            get: async (key: string) => {
              if (key === 'usage' && cfg.failUsageRead) throw new Error('Usage read failed');
              return key in store ? { [key]: copy(store[key]) } : {};
            },
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
            if (message.type === 'bridge-status') return cfg.bridge;
            if (message.type === 'test-connection') {
              await new Promise((done) => setTimeout(done, 300));
              return cfg.test;
            }
            return undefined;
          },
        },
        commands: { getAll: async () => [{ name: 'polish', shortcut: cfg.shortcut }] },
        tabs: { create: async () => ({}) },
      },
    });
  }, config);
  await page.goto(`${ORIGIN}/options.html`);
  await expect(page.getByRole('heading', { name: 'AI provider' })).toBeVisible();
}

function stored(page: Page): Promise<Record<string, unknown> | undefined> {
  return page.evaluate(
    () =>
      (window as unknown as { __store: Record<string, Record<string, unknown>> }).__store.settings,
  );
}

function provider(page: Page, title: string) {
  return page.locator('label.provider', { hasText: title });
}

test('switching provider shows that provider’s fields', async ({ page }) => {
  await openOptions(page, { settings: { provider: 'claude-cli' } });
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('haiku');
  await expect(page.getByLabel('Thinking effort', { exact: true })).toHaveValue('low');

  await provider(page, 'OpenAI-compatible API').click();
  await expect(page.getByLabel('Base URL', { exact: true })).toHaveValue(
    'http://localhost:11434/v1',
  );
  await expect(page.getByLabel('API key', { exact: true })).toHaveAttribute('type', 'password');
  await expect(page.getByLabel('Temperature', { exact: true })).toHaveValue('0.3');
  await expect(page.getByText('Ollama must allow the extension')).toBeVisible();
  await expect(page.getByLabel('Thinking effort', { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await stored(page))?.provider).toBe('openai-compatible');

  await provider(page, 'Anthropic API').click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('claude-haiku-5-5');
  await expect(page.getByLabel('Base URL', { exact: true })).toHaveCount(0);

  await provider(page, 'Codex').click();
  await expect(page.getByLabel('Thinking effort', { exact: true })).toHaveValue('none');
  await expect(page.getByText('Codex needs its own login')).toBeVisible();
});

test('Custom shows a text input and saves what is typed', async ({ page }) => {
  await openOptions(page, { settings: { provider: 'claude-cli' } });
  await page.getByLabel('Model', { exact: true }).selectOption({ label: 'Custom…' });
  const custom = page.getByLabel('Custom model', { exact: true });
  await expect(custom).toHaveValue('haiku');
  await expect(custom).toBeFocused();

  await custom.fill('claude-haiku-5-5[1m]');
  await expect
    .poll(async () => ((await stored(page))?.models as Record<string, string>)?.['claude-cli'])
    .toBe('claude-haiku-5-5[1m]');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
});

test('a stored value that is not a preset shows as Custom', async ({ page }) => {
  await openOptions(page, {
    settings: { provider: 'claude-cli', efforts: { 'claude-cli': 'turbo' } },
  });
  await expect(page.getByLabel('Thinking effort', { exact: true })).toHaveValue('__custom__');
  await expect(page.getByLabel('Custom thinking effort', { exact: true })).toHaveValue('turbo');
});

test('Test connection shows the result', async ({ page }) => {
  await openOptions(page);
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Testing…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  await expect(page.getByText('Works. Got “Hello.” in 1.2 s')).toBeVisible();
});

test('bridge rows and the install hint when the bridge is missing', async ({ page }) => {
  await openOptions(page);
  await expect(page.getByText('2.4.1 (Claude Code)')).toBeVisible();
  await expect(page.getByText('not found')).toBeVisible();
  await expect(page.locator('kbd')).toHaveText(['⇧', '⌘', 'K']);

  const missing = await page.context().newPage();
  await openOptions(missing, {
    bridge: { ok: false, message: 'Specified native messaging host not found.' },
  });
  await expect(missing.getByText('Specified native messaging host not found.')).toBeVisible();
  await expect(missing.getByText('npm run bridge:install')).toBeVisible();
  await missing.close();
});

test('a failed save blocks Test connection and is retried', async ({ page }) => {
  await page.clock.install();
  await openOptions(page, { failSets: 1 });
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

for (const idleFix of [true, false]) {
  test(`Fix while I type shows stored ${idleFix} and saves both ways`, async ({ page }) => {
    await openOptions(page, { settings: { idleFix } });
    const toggle = page.getByRole('checkbox', { name: 'Fix while I type' });
    await expect(toggle).toBeChecked({ checked: idleFix });

    await toggle.click();
    await expect.poll(async () => (await stored(page))?.idleFix).toBe(!idleFix);
    await expect(toggle).toBeChecked({ checked: !idleFix });

    await toggle.click();
    await expect.poll(async () => (await stored(page))?.idleFix).toBe(idleFix);
    await expect(toggle).toBeChecked({ checked: idleFix });
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
  await openOptions(page);
  const usage = usageRegion(page);
  await expect(usage.getByText('No requests recorded yet.')).toBeVisible();
  await expect(usage.getByText('Cached answers do not count.', { exact: false })).toBeVisible();
  await expect(usage.getByRole('table')).toHaveCount(0);
  await expect(usage).not.toContainText(/\d/);
});

test('Usage lists each provider and model with a total', async ({ page }) => {
  await openOptions(page, { usage: SEEDED_USAGE });
  const usage = usageRegion(page);
  const table = usage.getByRole('table');
  await expect(table.getByRole('columnheader')).toHaveText(['Model', 'Provider', 'Requests']);
  await expect
    .poll(() => usageCells(page))
    .toEqual([
      [LONG_MODEL, 'OpenAI-compatible API', '12'],
      ['Provider default', 'Codex', '7'],
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
  await openOptions(page, { usage: [{ provider: 'claude-cli', model: 'haiku', requests: 1 }] });
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
      ['Provider default', 'Grok CLI', '1'],
    ]);
  await expect(usageRegion(page).getByRole('row', { name: /Total/ })).toContainText('3');
});

test('Usage shows a load failure instead of zero', async ({ page }) => {
  await openOptions(page, { usage: SEEDED_USAGE, failUsageRead: true });
  const usage = usageRegion(page);
  await expect(usage.getByRole('alert')).toHaveText('Could not load usage: Usage read failed');
  await expect(usage.getByText('No requests recorded yet.')).toHaveCount(0);
  await expect(usage.getByRole('table')).toHaveCount(0);
});
