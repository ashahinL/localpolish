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
      __bridgeHeld: bridgeHeld,
      __testPorts: testPorts,
      __holdSaves: false,
      __saveHeld: saveHeld,
      __store: store,
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
              if (cfg.holdBridge) return new Promise((reply) => bridgeHeld.push(reply));
              return cfg.bridge;
            }
            return undefined;
          },
        },
        commands: { getAll: async () => [{ name: 'polish', shortcut: cfg.shortcut }] },
        tabs: { create: async () => ({}) },
      },
    });
    window.addEventListener('pagehide', () => testPorts.forEach((port) => port.disconnect()));
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

function bridgeCalls(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __runtimeSent: Array<{ type: string }> }).__runtimeSent.filter(
        (message) => message.type === 'bridge-status',
      ).length,
  );
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

  await provider(page, 'Antigravity CLI').click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gemini-3.8-flash');
  await expect(page.getByLabel('Thinking effort', { exact: true })).toHaveValue('low');
  await expect(page.getByText('Antigravity needs its own login')).toBeVisible();
  await expect.poll(async () => (await stored(page))?.provider).toBe('antigravity-cli');
});

test('Antigravity effort follows the chosen model', async ({ page }) => {
  await openOptions(page, { settings: { provider: 'antigravity-cli' } });
  const model = page.getByLabel('Model', { exact: true });
  const effort = page.getByLabel('Thinking effort', { exact: true });
  const help = page.getByText('Lower effort is faster and cheaper.');
  await expect(effort.locator('option')).toHaveText(['Low', 'Medium', 'High', 'Custom…']);
  await effort.selectOption('high');
  await model.selectOption('claude-sonnet-4-6');
  await expect(effort).toHaveCount(0);
  await expect(help).toHaveCount(0);
  await expect
    .poll(async () => {
      const settings = await stored(page);
      return [
        (settings?.models as Record<string, string>)?.['antigravity-cli'],
        (settings?.efforts as Record<string, string>)?.['antigravity-cli'],
      ];
    })
    .toEqual(['claude-sonnet-4-6', '']);
  await model.selectOption('gemini-3.8-flash');
  await expect(effort).toHaveValue('low');
  await expect
    .poll(
      async () => ((await stored(page))?.efforts as Record<string, string>)?.['antigravity-cli'],
    )
    .toBe('low');

  await model.selectOption('__custom__');
  await page.getByLabel('Custom model', { exact: true }).fill('custom-agy-model');
  await expect(effort.locator('option')).toHaveText([
    'Model default',
    'Low',
    'Medium',
    'High',
    'Custom…',
  ]);
  await expect(effort).toHaveValue('low');
  await effort.selectOption('__custom__');
  await page.getByLabel('Custom thinking effort', { exact: true }).fill('custom-effort');
  await expect
    .poll(
      async () => ((await stored(page))?.efforts as Record<string, string>)?.['antigravity-cli'],
    )
    .toBe('custom-effort');
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
  // Grok is missing, and this older bridge reply has no Antigravity entry.
  await expect(page.getByText('not found')).toHaveCount(2);
  await expect(page.locator('kbd')).toHaveText(['⇧', '⌘', 'K']);

  const missing = await page.context().newPage();
  await openOptions(missing, {
    bridge: { ok: false, message: 'Specified native messaging host not found.' },
  });
  await expect(missing.getByText('Specified native messaging host not found.')).toBeVisible();
  await expect(missing.getByText('npm run bridge:install')).toBeVisible();
  await missing.close();
});

test('an API provider skips the bridge check until Check again', async ({ page }) => {
  await openOptions(page, { settings: { provider: 'anthropic-api' }, holdBridge: true });
  await expect(page.locator('kbd')).toHaveText(['⇧', '⌘', 'K']);
  expect(await bridgeCalls(page)).toBe(0);
  const idle = page.getByText('API providers do not need the bridge.');
  await expect(idle).toBeVisible();
  await expect(page.getByText('Checking…')).toHaveCount(0);

  const again = page.getByRole('button', { name: 'Check again' });
  await again.click();
  await expect.poll(() => bridgeCalls(page)).toBe(1);
  expect(await bridgeForces(page)).toEqual([true]);
  await expect(page.getByText('Checking…')).toBeVisible();
  await expect(again).toBeDisabled();

  await releaseBridge(page, 0, BRIDGE_OK);
  await expect(page.getByText('2.4.1 (Claude Code)')).toBeVisible();
  await expect(again).toBeEnabled();
  expect(await bridgeCalls(page)).toBe(1);
});

test('provider changes ignore an old bridge reply', async ({ page }) => {
  await openOptions(page, { settings: { provider: 'anthropic-api' }, holdBridge: true });
  await expect(page.locator('kbd')).toHaveText(['⇧', '⌘', 'K']);
  expect(await bridgeCalls(page)).toBe(0);
  const again = page.getByRole('button', { name: 'Check again' });
  const idle = page.getByText('API providers do not need the bridge.');

  await provider(page, 'Codex').click();
  await expect.poll(() => bridgeCalls(page)).toBe(1);
  expect(await bridgeForces(page)).toEqual([false]);
  await expect(page.getByText('Checking…')).toBeVisible();
  await expect(again).toBeDisabled();

  await provider(page, 'Anthropic API').click();
  await expect(idle).toBeVisible();
  await expect(again).toBeEnabled();
  await releaseBridge(page, 0, BRIDGE_OK);
  await expect(page.getByText('2.4.1 (Claude Code)')).toHaveCount(0);
  await expect(idle).toBeVisible();
  await expect(again).toBeEnabled();

  await provider(page, 'Codex').click();
  await expect.poll(() => bridgeCalls(page)).toBe(2);
  await expect(page.getByText('Checking…')).toBeVisible();
  await expect(again).toBeDisabled();
  await releaseBridge(page, 1, {
    ok: false,
    message: 'Specified native messaging host not found.',
  });
  await expect(page.getByText('Specified native messaging host not found.')).toBeVisible();
  await expect(page.getByText('npm run bridge:install')).toBeVisible();
  await expect(again).toBeEnabled();
  expect(await bridgeForces(page)).toEqual([false, false]);

  await again.click();
  await expect.poll(() => bridgeCalls(page)).toBe(3);
  expect(await bridgeForces(page)).toEqual([false, false, true]);
  await releaseBridge(page, 2, BRIDGE_OK);
  await expect(page.getByText('2.4.1 (Claude Code)')).toBeVisible();
  await expect(again).toBeEnabled();
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

const LANGUAGE_NAMES = {
  en: 'English',
  ar: 'Arabic',
  franco: 'Franco-Arabic',
  other: 'Other languages',
};

test('language checkboxes show the stored values and save one language', async ({ page }) => {
  const languages = { en: true, ar: false, franco: true, other: false };
  await openOptions(page, { settings: { languages } });
  const group = page.getByRole('group', { name: 'Languages to fix while I type' });
  for (const [id, name] of Object.entries(LANGUAGE_NAMES)) {
    await expect(group.getByRole('checkbox', { name, exact: true })).toBeChecked({
      checked: languages[id as keyof typeof languages],
    });
  }

  await group.getByRole('checkbox', { name: 'Arabic', exact: true }).click();
  await expect
    .poll(async () => (await stored(page))?.languages)
    .toEqual({ en: true, ar: true, franco: true, other: false });

  await group.getByRole('checkbox', { name: 'English' }).click();
  await expect
    .poll(async () => (await stored(page))?.languages)
    .toEqual({ en: false, ar: true, franco: true, other: false });
});

test('language checkboxes are disabled while Fix while I type is off', async ({ page }) => {
  await openOptions(page, { settings: { idleFix: false, languages: { ar: false } } });
  const group = page.getByRole('group', { name: 'Languages to fix while I type' });
  await expect(group).toBeVisible();
  for (const name of Object.values(LANGUAGE_NAMES)) {
    await expect(group.getByRole('checkbox', { name, exact: true })).toBeDisabled();
  }
  await expect(group.getByRole('checkbox', { name: 'Arabic', exact: true })).not.toBeChecked();

  await page.getByRole('checkbox', { name: 'Fix while I type' }).click();
  await expect(group.getByRole('checkbox', { name: 'Arabic', exact: true })).toBeEnabled();
  await expect(group.getByRole('checkbox', { name: 'Arabic', exact: true })).not.toBeChecked();
});

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
      ['Unknown (CLI default)', 'Grok CLI', '1'],
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

test('provider change cancels its options test and ignores the old reply', async ({ page }) => {
  await openOptions(page, { holdTest: true, settings: { provider: 'claude-cli' } });
  const run = page.getByRole('button', { name: 'Test connection' });
  await run.click();
  await expect.poll(() => testPorts(page)).toEqual([{ disconnected: false, disconnects: 0 }]);
  await expect(run).toBeDisabled();
  await provider(page, 'OpenAI-compatible API').click();
  await expect.poll(() => testPorts(page)).toEqual([{ disconnected: true, disconnects: 1 }]);
  await expect(run).toBeEnabled();
  await expect(page.getByText('Testing…')).toHaveCount(0);
  await replyToTest(page, 0, 'Old provider.');
  await expect(page.getByText('Old provider.', { exact: false })).toHaveCount(0);
  await run.click();
  await expect.poll(() => testPorts(page).then((ports) => ports.length)).toBe(2);
  await replyToTest(page, 1, 'Current provider.');
  await expect(page.getByText('Works. Got “Current provider.” in 0.1 s')).toBeVisible();
  await expect(run).toBeEnabled();
});

test('a replacement options run closes only the previous port and ignores its answer', async ({
  page,
}) => {
  await openOptions(page, { holdTest: true });
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
  await expect(page.getByText('Testing…')).toBeVisible();
  await replyToTest(page, 1, 'Replacement.');
  await expect(page.getByText('Works. Got “Replacement.” in 0.1 s')).toBeVisible();
});

test('an abandoned options save cannot open a test port after a provider change', async ({
  page,
}) => {
  await openOptions(page, { holdTest: true, settings: { provider: 'claude-cli' } });
  await holdSaves(page);
  await page.getByLabel('Model', { exact: true }).selectOption({ label: 'Custom…' });
  await page.getByLabel('Custom model', { exact: true }).fill('held-model');
  const run = page.getByRole('button', { name: 'Test connection' });
  await run.dispatchEvent('click');
  await expect.poll(() => heldSaves(page)).toBe(1);
  await expect(page.getByText('Testing…')).toBeVisible();
  await provider(page, 'OpenAI-compatible API').click();
  await expect(run).toBeEnabled();
  await releaseSaves(page);
  await expect.poll(async () => (await stored(page))?.provider).toBe('openai-compatible');
  expect(await testPorts(page)).toEqual([]);
  await expect(page.getByText('Testing…')).toHaveCount(0);
  await expect(
    page.getByText('Settings were not saved, so the test did not run. Try again.'),
  ).toHaveCount(0);
});

test('selection chat checkbox defaults on and saves independently of idle Fix', async ({
  page,
}) => {
  await openOptions(page, { settings: { idleFix: false } });
  const checkbox = page.getByRole('checkbox', { name: 'Show chat button on selected page text' });
  await expect(checkbox).toBeChecked();
  await expect(page.getByText('Applies outside text fields.')).toBeVisible();
  await checkbox.click();
  await expect.poll(async () => (await stored(page))?.selectionChat).toBe(false);
  expect((await stored(page))?.idleFix).toBe(false);
});
