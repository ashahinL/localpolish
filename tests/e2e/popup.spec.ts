import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';

// Closing a context exits Chromium when it was launched with --single-process.
// Keep one context for the worker and open a new page per test.
const test = base.extend<{ page: Page }, { sharedContext: BrowserContext }>({
  sharedContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ baseURL: 'http://localhost:5179' });
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

type FakeEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string }
  | 'disconnect';

type PageApi = {
  __keys: string[];
  __lp: {
    openPopup: (scripts: FakeEvent[][], settings?: Record<string, unknown>) => void;
    setScripts: (scripts: FakeEvent[][]) => void;
    startButton: () => void;
    draftText: () => string;
  };
};

const SUCCESS: FakeEvent[] = [
  { type: 'chunk', text: 'I went' },
  { type: 'chunk', text: ' home.' },
  { type: 'done', text: 'I went home.' },
];

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => {
    const api = (window as unknown as Partial<PageApi>).__lp;
    return typeof api?.openPopup === 'function';
  });
});

async function typeAndSelectAll(page: Page, text: string): Promise<void> {
  await page.locator('#ta').click();
  await page.keyboard.type(text);
  await page.keyboard.press('ControlOrMeta+a');
}

async function openPopup(
  page: Page,
  scripts: FakeEvent[][],
  settings: Record<string, unknown> = {},
): Promise<void> {
  await page.evaluate(
    ([scripts, settings]) => (window as unknown as PageApi).__lp.openPopup(scripts, settings),
    [scripts, settings] as const,
  );
}

// The diff read without its deleted parts.
async function newText(page: Page): Promise<string> {
  return page.locator('.lp-popup .lp-diff').evaluate((el) =>
    [...el.childNodes]
      .filter((node) => node.nodeName !== 'DEL')
      .map((node) => node.textContent)
      .join(''),
  );
}

test('accept replaces the selection with the rewrite and closes', async ({ page }) => {
  await typeAndSelectAll(page, 'i has went home');
  await openPopup(page, [SUCCESS]);

  const popup = page.locator('.lp-popup');
  await expect(popup.locator('del').first()).toBeVisible();
  await expect(popup.locator('ins').first()).toBeVisible();
  await expect.poll(() => newText(page)).toBe('I went home.');

  await popup.getByRole('button', { name: 'Accept' }).click();
  await expect(page.locator('#ta')).toHaveValue('I went home.');
  await expect(popup).toHaveCount(0);
});

test('Esc closes the popup and the page never sees it', async ({ page }) => {
  await page.evaluate(() => {
    const api = window as unknown as PageApi;
    api.__keys = [];
    document.addEventListener('keydown', (event) => api.__keys.push(event.key));
  });
  await typeAndSelectAll(page, 'i has went home');
  await openPopup(page, [SUCCESS]);
  await expect(page.locator('.lp-popup')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.lp-popup')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as PageApi).__keys)).not.toContain('Escape');
  await expect(page.locator('#ta')).toBeFocused();
});

test('an error shows the message and Retry runs again', async ({ page }) => {
  await typeAndSelectAll(page, 'i has went home');
  await openPopup(page, [[{ type: 'error', message: 'The bridge is not installed.' }], SUCCESS]);

  const popup = page.locator('.lp-popup');
  await expect(popup.getByRole('alert')).toHaveText('The bridge is not installed.');
  await expect(popup.getByRole('button', { name: 'Accept' })).toBeDisabled();
  const retry = popup.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeEnabled();

  await retry.click();
  await expect.poll(() => newText(page)).toBe('I went home.');
  await expect(popup.getByRole('button', { name: 'Accept' })).toBeEnabled();
});

test('a port that drops before done shows an error', async ({ page }) => {
  await typeAndSelectAll(page, 'i has went home');
  await openPopup(page, [[{ type: 'chunk', text: 'I' }, 'disconnect']]);

  await expect(page.locator('.lp-popup').getByRole('alert')).toContainText(
    'stopped before the new text was ready',
  );
});

test('accept on changed text keeps the popup open with a note', async ({ page }) => {
  await typeAndSelectAll(page, 'i has went home');
  await openPopup(page, [SUCCESS]);

  const popup = page.locator('.lp-popup');
  const accept = popup.getByRole('button', { name: 'Accept' });
  await expect(accept).toBeEnabled();
  await page.locator('#ta').evaluate((el) => {
    if (!(el instanceof HTMLTextAreaElement)) throw new Error('expected textarea');
    el.value = 'something else';
  });

  await accept.click();
  await expect(popup.locator('.lp-notes')).toContainText(
    'The text in the field changed since you selected it.',
  );
  await expect(popup).toBeVisible();
  await expect(page.locator('#ta')).toHaveValue('something else');
});

test('Shorter mode flags a result over 280 characters', async ({ page }) => {
  await typeAndSelectAll(page, 'make this shorter please');
  await openPopup(page, [[{ type: 'done', text: 'a'.repeat(300) }]], { defaultMode: 'shorter' });

  const count = page.locator('.lp-popup .lp-count');
  await expect(count).toHaveText('24 → 300 characters · over 280');
  await expect(count).toHaveClass(/lp-over/);
  await expect(page.locator('.lp-popup .lp-tab[aria-pressed="true"]')).toHaveText('Shorter');
});

test('switching mode restarts the request with the new mode', async ({ page }) => {
  await typeAndSelectAll(page, 'i has went home');
  await openPopup(page, [SUCCESS]);
  const popup = page.locator('.lp-popup');
  await expect(popup.locator('.lp-diff')).toBeVisible();

  await page.evaluate(() =>
    (window as unknown as PageApi).__lp.setScripts([[{ type: 'done', text: 'i has went home' }]]),
  );
  await popup.getByRole('button', { name: 'Tone' }).click();
  await expect(popup.getByRole('button', { name: 'Angry but civil' })).toBeVisible();
  await expect(popup.locator('.lp-body')).toHaveText('No changes needed.');
});

test('the floating button follows a textarea selection', async ({ page }) => {
  await page.evaluate(() => (window as unknown as PageApi).__lp.startButton());
  await typeAndSelectAll(page, 'i has went home');

  const fab = page.locator('.lp-fab');
  await expect(fab).toBeVisible();
  await expect(fab).toHaveAttribute('title', 'LocalPolish (Ctrl+Shift+K)');

  await page.keyboard.press('ArrowRight');
  await expect(fab).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+a');
  await fab.click();
  await expect(page.locator('.lp-popup')).toBeVisible();
  await expect(fab).toHaveCount(0);
});

test('page scripts cannot press the button or Retry', async ({ page }) => {
  await page.evaluate(() => (window as unknown as PageApi).__lp.startButton());
  await typeAndSelectAll(page, 'i has went home');
  await expect(page.locator('.lp-fab')).toBeVisible();

  // What a hostile page can do: reach the open shadow root and click by script.
  const pageClick = (label: string) =>
    page.evaluate((label) => {
      const buttons = document
        .querySelector('localpolish-root')
        ?.shadowRoot?.querySelectorAll('button');
      const button = [...(buttons ?? [])].find(
        (el) =>
          el.getAttribute('aria-label')?.startsWith(label) || el.textContent?.trim() === label,
      );
      if (!button) throw new Error(`no ${label} button`);
      button.click();
    }, label);

  await pageClick('LocalPolish');
  await expect(page.locator('.lp-popup')).toHaveCount(0);

  await page.evaluate((scripts) => (window as unknown as PageApi).__lp.setScripts(scripts), [
    [{ type: 'error', message: 'Boom.' }],
    SUCCESS,
  ] as FakeEvent[][]);
  await page.locator('.lp-fab').click();
  await expect(page.locator('.lp-popup')).toContainText('Boom.');

  await pageClick('Retry');
  await expect(page.locator('.lp-popup')).toContainText('Boom.');
});
