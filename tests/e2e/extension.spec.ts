import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Locator,
  type Page,
  type Worker,
} from '@playwright/test';
import { defaultReply, startMockOpenAI, type MockOpenAI } from './mock-openai';

const EXTENSION_ID = 'ealpmjmaclnlpelpcacmbicmdipmbeei';
const DIST = fileURLToPath(new URL('../../dist', import.meta.url));
const SOURCE = 'i has went home';
const REWRITE = 'I went home.';
const FAKE_API_KEY = 'sk-localpolish-e2e-fake';

interface ExtensionChrome {
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
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

// Runs first: the worker's fresh profile opened the setup tab on install.
test('first-run setup tests the provider and turning idle Fix off stops idle requests', async ({
  extensionContext,
  page,
  mock,
  sw,
}) => {
  const setupUrl = `chrome-extension://${EXTENSION_ID}/setup.html`;
  await expect
    .poll(() => extensionContext.pages().some((other) => other.url() === setupUrl))
    .toBe(true);
  const setup = extensionContext.pages().find((other) => other.url() === setupUrl);
  if (!setup) throw new Error('No setup tab');
  await setup.bringToFront();

  const idle = setup.getByRole('switch', { name: 'Fix while I type' });
  await expect(idle).toHaveAttribute('aria-checked', 'true');
  await expect(setup.getByText(`${mock.url}/v1, a server on this computer`)).toBeVisible();
  await expect(setup.getByRole('button', { name: 'Test connection' })).toHaveCount(1);
  await setup.getByRole('button', { name: 'Test connection' }).click();
  await expect(setup.getByText('Works. Got')).toBeVisible();

  await idle.click();
  await expect(idle).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => storedSettings(sw).then((stored) => stored?.idleFix)).toBe(false);

  mock.requests.length = 0;
  await page.bringToFront();
  await openFixture(page);
  await page.locator('#ta').click();
  await page.keyboard.type('i has went home today');
  await page.waitForTimeout(4500);
  expect(mock.requests).toHaveLength(0);
  await expect(page.locator('.lp-mark')).toHaveCount(0);

  const closed = setup.waitForEvent('close');
  await setup.getByRole('button', { name: 'Done' }).click();
  await closed;
});

test('textarea via the floating button', async ({ page, mock }) => {
  await openRewrite(page, '#ta');

  expect(mock.requests).toHaveLength(1);
  expect(mock.requests[0]?.authorization).toBe(`Bearer ${FAKE_API_KEY}`);
  const body = mock.requests[0]?.body;
  expect(body.model).toBe('mock-model');
  expect(body.messages[0].content.startsWith('Fix the grammar')).toBe(true);
  expect(body.messages[1].content).toBe(`<text>\n${SOURCE}\n</text>`);

  await accept(page);
  await expect(page.locator('#ta')).toHaveValue(REWRITE);
});

test('content scripts cannot read local storage or receive stored keys', async ({
  page,
  mock,
  sw,
}) => {
  const session = await page.context().newCDPSession(page);
  const contexts = new Set<number>();
  session.on('Runtime.executionContextCreated', ({ context }) => contexts.add(context.id));
  session.on('Runtime.executionContextDestroyed', ({ executionContextId }) =>
    contexts.delete(executionContextId),
  );
  try {
    await session.send('Runtime.enable');
    let contextId: number | undefined;
    await expect
      .poll(async () => {
        for (const id of contexts) {
          const result = await session.send('Runtime.evaluate', {
            contextId: id,
            expression: 'globalThis.chrome?.runtime?.id',
            returnByValue: true,
          });
          if (result.result.value === EXTENSION_ID) {
            contextId = id;
            return true;
          }
        }
        return false;
      })
      .toBe(true);
    if (contextId === undefined) throw new Error('Extension content world not found');

    const storage = await session.send('Runtime.evaluate', {
      contextId,
      expression: `(async () => {
        globalThis.__lpStorageChanges = [];
        chrome.storage.onChanged.addListener((...args) => globalThis.__lpStorageChanges.push(args));
        globalThis.__lpSettingsNotice = new Promise(resolve => {
          chrome.runtime.onMessage.addListener(message => {
            if (message.type === 'page-settings-changed') resolve(message);
          });
        });
        try {
          return { stored: await chrome.storage.local.get('settings') };
        } catch (error) {
          return { error: error.message };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    expect(storage.exceptionDetails).toBeUndefined();
    expect(storage.result.value).toEqual({
      error: 'Access to storage is not allowed from this context.',
    });

    await writeSettings(sw, `${mock.url}/v1`, {
      blocklist: ['blocked.example'],
      idleFix: false,
      defaultMode: 'shorter',
    });
    const refreshed = await session.send('Runtime.evaluate', {
      contextId,
      expression: `(async () => {
        const notice = await globalThis.__lpSettingsNotice;
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          notice,
          storageChanges: globalThis.__lpStorageChanges,
          settings: await chrome.runtime.sendMessage({ type: 'page-settings' }),
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
      timeout: 5000,
    });
    expect(refreshed.exceptionDetails).toBeUndefined();
    expect(refreshed.result.value).toEqual({
      notice: { type: 'page-settings-changed' },
      storageChanges: [],
      settings: { blocklist: ['blocked.example'], idleFix: false, defaultMode: 'shorter' },
    });
    expect(JSON.stringify(refreshed.result.value)).not.toContain(FAKE_API_KEY);
  } finally {
    await session.detach();
  }
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

test('textarea keeps a two-line rewrite exactly', async ({ page, mock }) => {
  mock.reply({ chunks: ['I went home.\n', 'She does not know.'] });
  await page.locator('#ta').click();
  await page.keyboard.type('i has went home');
  await page.keyboard.press('Enter');
  await page.keyboard.type('she dont know');
  await page.keyboard.press('ControlOrMeta+a');
  await page.locator('.lp-fab').click();
  await accept(page);
  await expect(page.locator('#ta')).toHaveValue('I went home.\nShe does not know.');
});

test('Rephrase tab sends nothing and its Formal chip asks for a formal rewrite', async ({
  page,
  mock,
}) => {
  await openRewrite(page, '#ta');
  const seen = mock.requests.length;
  await page.getByRole('button', { name: 'Rephrase' }).click();
  await expect(page.getByRole('button', { name: 'Formal' })).toBeVisible();
  expect(mock.requests.length).toBe(seen);
  await page.getByRole('button', { name: 'Formal' }).click();

  await expect
    .poll(() =>
      mock.requests.slice(seen).some((request) => {
        const content = request.body?.messages?.[0]?.content;
        return (
          typeof content === 'string' &&
          content.startsWith('Rewrite the text inside the <text> tags in a formal')
        );
      }),
    )
    .toBe(true);
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
  await writeSettings(sw, `${mock.url}/v1`, { blocklist: ['localhost'] });
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

test('toolbar popup Test connection', async ({ page }) => {
  await page.goto(`chrome-extension://${EXTENSION_ID}/popup.html`);
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

test('the shortcut in an iframe opens one popup and no parent toast', async ({ page, sw }) => {
  await openFixture(page, 'frames.html');
  const frame = page.frameLocator('#cross-host');
  const field = frame.locator('textarea');
  await field.pressSequentially(SOURCE);
  await field.selectText();
  await expect(frame.locator('.lp-fab')).toBeVisible();
  await page.keyboard.press('End');
  await sendOpenPopup(page, sw, field);

  await expect(frame.locator('.lp-popup')).toHaveCount(1);
  await expect(frame.locator('.lp-popup')).toBeVisible();
  await expect(page.locator('.lp-popup')).toHaveCount(0);
  await expect(page.locator('.lp-toast')).toHaveCount(0);
});

test.describe('idle Fix', () => {
  test('a pause sends one Fix and shows the marker', async ({ page, mock, sw }) => {
    await writeSettings(sw, `${mock.url}/v1`);
    await openFixture(page);
    await page.locator('#ta').click();
    await page.keyboard.type('i has went home today');
    await expect.poll(() => mock.requests.length, { timeout: 10_000 }).toBe(1);
    await expect(page.locator('.lp-mark')).toBeVisible();
  });

  test('blocking the site removes existing idle work and its selection button', async ({
    page,
    mock,
    sw,
  }) => {
    await writeSettings(sw, `${mock.url}/v1`);
    await openFixture(page);
    await page.locator('#ta').click();
    await page.keyboard.type('i has went home today');
    await expect.poll(() => mock.requests.length, { timeout: 10_000 }).toBe(1);
    await expect(page.locator('.lp-mark')).toBeVisible();
    await page.locator('#ta').selectText();
    await expect(page.locator('.lp-fab')).toBeVisible();

    await writeSettings(sw, `${mock.url}/v1`, { blocklist: ['localhost'] });
    await expect(page.locator('.lp-mark')).toHaveCount(0);
    await expect(page.locator('.lp-fab')).toHaveCount(0);
    await page.keyboard.press('End');
    await page.keyboard.type(' more words');
    await page.waitForTimeout(4500);
    expect(mock.requests).toHaveLength(1);

    await sendOpenPopup(page, sw, '#ta');
    await expect(page.locator('.lp-popup .lp-diff')).toBeVisible();
    expect(mock.requests).toHaveLength(2);
  });

  test('turning idle Fix off removes its marker but keeps the button and shortcut', async ({
    page,
    mock,
    sw,
  }) => {
    await writeSettings(sw, `${mock.url}/v1`);
    await openFixture(page);
    await page.locator('#ta').click();
    await page.keyboard.type('i has went home today');
    await expect.poll(() => mock.requests.length, { timeout: 10_000 }).toBe(1);
    await expect(page.locator('.lp-mark')).toBeVisible();
    await page.locator('#ta').selectText();
    await expect(page.locator('.lp-fab')).toBeVisible();

    await writeSettings(sw, `${mock.url}/v1`, { idleFix: false });
    await expect(page.locator('.lp-mark')).toHaveCount(0);
    await expect(page.locator('.lp-fab')).toBeVisible();
    await page.keyboard.press('End');
    await page.keyboard.type(' more words');
    await page.waitForTimeout(4500);
    expect(mock.requests).toHaveLength(1);

    await sendOpenPopup(page, sw, '#ta');
    await expect(page.locator('.lp-popup .lp-diff')).toBeVisible();
    expect(mock.requests).toHaveLength(2);
  });

  test('a blocked site gets no idle Fix from its iframes', async ({ page, mock, sw }) => {
    await writeSettings(sw, `${mock.url}/v1`, { blocklist: ['localhost'] });
    await openFixture(page, 'frames.html');
    for (const selector of ['#cross-host', '#srcdoc', '#blank']) {
      const frame = page.frameLocator(selector);
      await frame.locator('textarea').pressSequentially('i has went home today');
      await frame.locator('textarea').selectText();
      await page.waitForTimeout(4500);
      expect(mock.requests).toHaveLength(0);
      await expect(frame.locator('.lp-mark')).toHaveCount(0);
      await expect(frame.locator('.lp-fab')).toHaveCount(0);
    }
  });

  test('an unblocked page still fixes inside an iframe', async ({ page, mock }) => {
    await openFixture(page, 'frames.html');
    const frame = page.frameLocator('#cross-host');
    await frame.locator('textarea').pressSequentially('i has went home today');
    await expect.poll(() => mock.requests.length, { timeout: 10_000 }).toBe(1);
    await expect(frame.locator('.lp-mark')).toBeVisible();
  });

  test('idle Fix off: a pause sends nothing', async ({ page, mock, sw }) => {
    await writeSettings(sw, `${mock.url}/v1`, { idleFix: false });
    await openFixture(page);
    await page.locator('#ta').click();
    await page.keyboard.type('i has went home today');
    await page.waitForTimeout(4500);
    expect(mock.requests).toHaveLength(0);
    await expect(page.locator('.lp-mark')).toHaveCount(0);
  });

  test('a blocklisted site gets no idle Fix', async ({ page, mock, sw }) => {
    await writeSettings(sw, `${mock.url}/v1`, { blocklist: ['localhost'] });
    await openFixture(page);
    await page.locator('#ta').click();
    await page.keyboard.type('i has went home today');
    await page.waitForTimeout(4500);
    expect(mock.requests).toHaveLength(0);
    await expect(page.locator('.lp-mark')).toHaveCount(0);
  });
});

async function writeSettings(
  sw: Worker,
  openaiBaseUrl: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const settings: Record<string, unknown> = {
    provider: 'openai-compatible',
    openaiBaseUrl,
    openaiApiKey: FAKE_API_KEY,
    models: { 'openai-compatible': 'mock-model' },
    ...extra,
  };
  await sw.evaluate((stored) => {
    const chrome = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    return chrome.storage.local.set({ settings: stored });
  }, settings);
}

async function storedSettings(sw: Worker): Promise<Record<string, unknown> | undefined> {
  return sw.evaluate(async () => {
    const chrome = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    const stored = await chrome.storage.local.get('settings');
    return stored.settings as Record<string, unknown> | undefined;
  });
}

async function openFixture(page: Page, fixture = ''): Promise<void> {
  await page.goto(`http://localhost:5179/${fixture}`);
  if (fixture) return;
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

async function sendOpenPopup(page: Page, sw: Worker, field: string | Locator): Promise<void> {
  await page.bringToFront();
  await (typeof field === 'string' ? page.locator(field) : field).focus();
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
