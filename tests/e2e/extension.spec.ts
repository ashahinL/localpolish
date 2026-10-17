import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import { defaultReply, startMockOpenAI, type MockOpenAI } from './mock-openai';

const EXTENSION_ID = 'ealpmjmaclnlpelpcacmbicmdipmbeei';
const DIST = fileURLToPath(new URL('../../dist', import.meta.url));
const SOURCE = 'i has went home';
const REWRITE = 'I went home.';

interface ExtensionChrome {
  storage: {
    local: {
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
  tabs: {
    query(query: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number }>>;
    sendMessage(tabId: number, message: { type: 'open-popup' }): Promise<unknown>;
  };
}

interface PageApi {
  __keys: string[];
  __lp?: { draftText?: () => string };
}

// The shared browser fixture launches with --single-process, which keeps an
// extension service worker from starting. This spec launches its own browser.
const test = base.extend<
  { page: Page },
  { mock: MockOpenAI; extensionContext: BrowserContext; sw: Worker }
>({
  mock: [
    // Playwright requires a destructuring pattern, even with no dependencies.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const mock = await startMockOpenAI();
      await use(mock);
      await mock.close();
    },
    { scope: 'worker' },
  ],
  extensionContext: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localpolish-e2e-'));
      try {
        const context = await chromium.launchPersistentContext(userDataDir, {
          channel: 'chromium',
          headless: true,
          args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
        });
        try {
          await use(context);
        } finally {
          await context.close();
        }
      } finally {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    },
    { scope: 'worker' },
  ],
  sw: [
    async ({ extensionContext }, use) => {
      await expect
        .poll(() => extensionWorker(extensionContext)?.url() ?? '', { timeout: 15_000 })
        .toContain(EXTENSION_ID);
      const worker = extensionWorker(extensionContext);
      if (!worker) throw new Error('Extension service worker did not start');
      await use(worker);
    },
    { scope: 'worker' },
  ],
  page: async ({ extensionContext }, use) => {
    const page = await extensionContext.newPage();
    // The persistent context starts on about:blank. Drop it so the fixture
    // tab is the active one the shortcut message is sent to.
    for (const other of extensionContext.pages()) {
      if (other !== page && other.url() === 'about:blank') await other.close();
    }
    await use(page);
    await page.close();
  },
});

function extensionWorker(context: BrowserContext): Worker | undefined {
  return context.serviceWorkers().find((worker) => worker.url().includes(EXTENSION_ID));
}

test.beforeEach(async ({ page, mock, sw }) => {
  mock.reply(defaultReply);
  mock.requests.length = 0;
  await writeSettings(sw, `${mock.url}/v1`);
  await openFixture(page);
});

test('textarea via the floating button', async ({ page, mock }) => {
  await openRewrite(page, '#ta');

  expect(mock.requests).toHaveLength(1);
  const body = mock.requests[0]?.body;
  expect(body.model).toBe('mock-model');
  expect(body.messages[0].content.startsWith('Fix the grammar')).toBe(true);
  expect(body.messages[1].content).toBe(`<text>\n${SOURCE}\n</text>`);

  await accept(page);
  await expect(page.locator('#ta')).toHaveValue(REWRITE);
});

test('textarea inside a modal dialog', async ({ page }) => {
  await page.evaluate(() => (document.getElementById('dlg') as HTMLDialogElement).showModal());
  await openRewrite(page, '#dlg-ta');
  await accept(page);
  await expect(page.locator('#dlg-ta')).toHaveValue(REWRITE);
});

test('input via the floating button', async ({ page }) => {
  await openRewrite(page, '#inp');
  await accept(page);
  await expect(page.locator('#inp')).toHaveValue(REWRITE);
});

test('contenteditable via the floating button', async ({ page }) => {
  await openRewrite(page, '#ce');
  await accept(page);
  expect((await page.locator('#ce').innerText()).trim()).toBe(REWRITE);
});

test('Draft.js via the floating button', async ({ page }) => {
  await openRewrite(page, '#draft .public-DraftEditor-content');
  await accept(page);
  expect(await draftText(page)).toBe(REWRITE);
});

test('shortcut with no selection uses the whole field', async ({ page, sw }) => {
  await page.locator('#ta').click();
  await page.keyboard.type(SOURCE);
  // The button mounts only after settings have loaded. Collapse back to a
  // caret so the shortcut, not a selection, is what opens the popup.
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.locator('.lp-fab')).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.locator('.lp-fab')).toHaveCount(0);
  await sendOpenPopup(page, sw, '#ta');

  await expect(page.locator('.lp-popup')).toBeVisible();
  await expect.poll(() => shownRewrite(page)).toBe(REWRITE);
  await accept(page);
  await expect(page.locator('#ta')).toHaveValue(REWRITE);
});

test('mode switch asks for a shorter rewrite', async ({ page, mock }) => {
  await openRewrite(page, '#ta');
  await page.getByRole('button', { name: 'Shorter' }).click();

  await expect.poll(() => mock.requests.length).toBe(2);
  const content = mock.requests[1]?.body.messages[0].content as string;
  expect(content.startsWith('Make the text')).toBe(true);
});

test('server error can be retried', async ({ page, mock }) => {
  mock.reply({ status: 500, body: 'boom' });
  await selectAllIn(page, '#ta');
  await page.locator('.lp-fab').click();

  const popup = page.locator('.lp-popup');
  await expect(popup.locator('.lp-error')).toContainText('HTTP 500: boom');
  await expect(popup.getByRole('button', { name: 'Accept' })).toBeDisabled();

  mock.reply(defaultReply);
  await popup.getByRole('button', { name: 'Retry' }).click();
  await expect(popup.locator('.lp-diff')).toBeVisible();
  await expect.poll(() => shownRewrite(page)).toBe(REWRITE);
  await expect(popup.getByRole('button', { name: 'Accept' })).toBeEnabled();
  await accept(page);
  await expect(page.locator('#ta')).toHaveValue(REWRITE);
});

test('blocklist hides the button but the shortcut still opens', async ({ page, mock, sw }) => {
  await writeSettings(sw, `${mock.url}/v1`, ['localhost']);
  await openFixture(page);

  await selectAllIn(page, '#ta');
  await page.waitForTimeout(500);
  await expect(page.locator('.lp-fab')).not.toBeVisible();

  await sendOpenPopup(page, sw, '#ta');
  await expect(page.locator('.lp-popup')).toBeVisible();
});

test('options page Test connection', async ({ page }) => {
  await page.goto(`chrome-extension://${EXTENSION_ID}/options.html`);
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Works. Got')).toBeVisible();
});

test('Esc does not reach the page', async ({ page }) => {
  await page.evaluate(() => {
    const api = window as unknown as PageApi;
    api.__keys = [];
    document.addEventListener('keydown', (event) => api.__keys.push(event.key));
  });
  await openRewrite(page, '#ta');

  await page.keyboard.press('Escape');
  await expect(page.locator('.lp-popup')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as PageApi).__keys)).not.toContain('Escape');
});

async function writeSettings(
  sw: Worker,
  openaiBaseUrl: string,
  blocklist?: string[],
): Promise<void> {
  const settings: Record<string, unknown> = {
    provider: 'openai-compatible',
    openaiBaseUrl,
    models: { 'openai-compatible': 'mock-model' },
  };
  if (blocklist) settings.blocklist = blocklist;
  await sw.evaluate((stored) => {
    const chrome = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    return chrome.storage.local.set({ settings: stored });
  }, settings);
}

async function openFixture(page: Page): Promise<void> {
  await page.goto('http://localhost:5179/');
  await page.waitForFunction(() => {
    const api = (window as unknown as PageApi).__lp;
    return typeof api?.draftText === 'function';
  });
}

async function selectAllIn(page: Page, selector: string): Promise<void> {
  await page.locator(selector).click();
  await page.keyboard.type(SOURCE);
  await page.keyboard.press('ControlOrMeta+a');
}

async function openRewrite(page: Page, selector: string): Promise<void> {
  await selectAllIn(page, selector);
  await page.locator('.lp-fab').click();
  await expect(page.locator('.lp-diff')).toBeVisible();
  await expect.poll(() => shownRewrite(page)).toBe(REWRITE);
}

async function accept(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(page.locator('.lp-popup')).toHaveCount(0);
}

async function sendOpenPopup(page: Page, sw: Worker, field: string): Promise<void> {
  await page.bringToFront();
  await page.locator(field).focus();
  await sw.evaluate(async () => {
    const chrome = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new Error('No active tab');
    await chrome.tabs.sendMessage(tab.id, { type: 'open-popup' });
  });
}

// Deleted words stay in the diff, so the rewrite is every node except del.
async function shownRewrite(page: Page): Promise<string> {
  return page.locator('.lp-diff').evaluate((el) =>
    [...el.childNodes]
      .filter((node) => node.nodeName !== 'DEL')
      .map((node) => node.textContent ?? '')
      .join(''),
  );
}

function draftText(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as PageApi).__lp?.draftText?.() ?? '');
}
