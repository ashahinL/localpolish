import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';

const DIST = new URL('../../dist', import.meta.url);
// The built page loads /chunks/... by absolute path, which file:// cannot resolve.
const ORIGIN = 'https://localpolish.test';

interface StubConfig {
  settings?: Record<string, unknown>;
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
    bridge: BRIDGE_OK,
    test: { ok: true, sample: 'Hello.', ms: 1234 },
    shortcut: '⇧⌘K',
    ...overrides,
  };
  await page.route(`${ORIGIN}/**`, (route) => {
    const file = new URL(DIST.href + new URL(route.request().url()).pathname);
    return route.fulfill({ path: decodeURIComponent(file.pathname) });
  });
  await page.addInitScript((cfg: StubConfig) => {
    const store: Record<string, unknown> = {};
    if (cfg.settings) store.settings = cfg.settings;
    const listeners: Array<(changes: unknown, area: string) => void> = [];
    const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    Object.assign(window, {
      __store: store,
      chrome: {
        storage: {
          local: {
            get: async (key: string) => (key in store ? { [key]: copy(store[key]) } : {}),
            set: async (items: Record<string, unknown>) => {
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
  await openOptions(page);
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
  await openOptions(page);
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
  await openOptions(page, { settings: { efforts: { 'claude-cli': 'turbo' } } });
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
