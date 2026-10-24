import { fileURLToPath } from 'node:url';
import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import { EXTENSION_ID, extensionWorker, launchExtension } from './extension-runtime';
import { defaultReply, startMockOpenAI, type MockOpenAI } from './mock-openai';

// These open sidepanel.html as a tab, as the chat tests do.
const DIST = fileURLToPath(new URL('../../dist', import.meta.url));
const PANEL = `chrome-extension://${EXTENSION_ID}/sidepanel.html`;
const FAKE_API_KEY = 'sk-localpolish-e2e-fake';

interface ExtensionChrome {
  windows: { getCurrent(): Promise<{ id: number }> };
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
    };
    session: {
      remove(key: string): Promise<void>;
    };
  };
}

interface StoredDocument {
  title: string;
  body: string;
}

const test = base.extend<
  { page: Page },
  { mock: MockOpenAI; extensionContext: BrowserContext; sw: Worker }
>({
  mock: [
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
      const extension = await launchExtension(DIST);
      try {
        await use(extension.context);
      } finally {
        await extension.close();
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
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as unknown as { __copied?: string }).__copied = text;
          },
        },
      });
    });
    await use(page);
    await page.close();
  },
});

async function writeSettings(
  sw: Worker,
  url: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await sw.evaluate(
    async ({ url, key, extra }) => {
      const chrome = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
      await chrome.storage.local.set({
        settings: {
          provider: 'openai-compatible',
          openaiBaseUrl: url,
          openaiApiKey: key,
          models: { 'openai-compatible': 'fix-model' },
          chat: { provider: 'openai-compatible', models: { 'openai-compatible': 'chat-model' } },
          ...extra,
        },
      });
    },
    { url, key: FAKE_API_KEY, extra },
  );
}

test.beforeEach(async ({ mock, sw }) => {
  mock.reply(defaultReply);
  mock.requests.length = 0;
  await sw.evaluate(async () => {
    const chrome = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    await chrome.storage.local.remove('chat-history');
    await chrome.storage.local.remove('documents');
    const { id } = await chrome.windows.getCurrent();
    await chrome.storage.session.remove(`chat-pending:${id}`);
  });
  await writeSettings(sw, `${mock.url}/v1`);
});

async function stored(sw: Worker, key: string): Promise<unknown> {
  return sw.evaluate(async (name) => {
    const chrome = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    return (await chrome.storage.local.get(name))[name];
  }, key);
}

async function storedDocuments(sw: Worker): Promise<StoredDocument[] | undefined> {
  return (await stored(sw, 'documents')) as StoredDocument[] | undefined;
}

async function openDocument(page: Page): Promise<void> {
  await page.goto(PANEL);
  await expect(page.getByLabel('Chat provider')).toHaveValue('openai-compatible');
  await page.getByRole('button', { name: 'New document' }).click();
  await expect(text(page)).toBeVisible();
}

const text = (page: Page) => page.getByRole('textbox', { name: 'Document text' });
const title = (page: Page) => page.getByRole('textbox', { name: 'Title' });

async function fixAndAccept(page: Page, mock: MockOpenAI): Promise<void> {
  await text(page).click();
  await page.keyboard.type('i has went home');
  await expect.poll(() => mock.requests.length, { timeout: 10_000 }).toBe(1);
  await expect(page.locator('.lp-mark')).toBeVisible();
  await page.locator('.lp-mark').click();
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(text(page)).toHaveValue('I went home.');
}

test('idle Fix in the document text, then Accept saves the fixed body', async ({
  page,
  mock,
  sw,
}) => {
  await openDocument(page);
  await fixAndAccept(page, mock);
  await expect.poll(async () => (await storedDocuments(sw))?.[0]?.body).toBe('I went home.');
  expect(await storedDocuments(sw)).toHaveLength(1);
});

test('one undo after Accept restores the text from before', async ({ page, mock }) => {
  await openDocument(page);
  await fixAndAccept(page, mock);
  await text(page).focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(text(page)).toHaveValue('i has went home');
});

test('a saved document survives a reload', async ({ page, mock, sw }) => {
  await writeSettings(sw, `${mock.url}/v1`, { idleFix: false });
  await openDocument(page);
  await title(page).fill('Trip notes');
  await text(page).fill('Pack the blue bag.');
  await expect(page.locator('.d-foot')).toContainText('Saved');

  await page.reload();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page
    .getByRole('group', { name: 'History lists' })
    .getByRole('button', { name: 'Documents' })
    .click();
  await page.locator('.history-open').first().click();
  await expect(title(page)).toHaveValue('Trip notes');
  await expect(text(page)).toHaveValue('Pack the blue bag.');
  expect(await storedDocuments(sw)).toHaveLength(1);
});

test('Ask in chat opens a chat with the document attached', async ({ page, mock, sw }) => {
  await writeSettings(sw, `${mock.url}/v1`, { idleFix: false });
  await openDocument(page);
  await title(page).fill('Vendor reply');
  await text(page).fill('We need a date by Thursday.');
  await page.getByRole('button', { name: 'Ask in chat' }).click();

  const attachment = page.getByRole('region', { name: 'Attached' });
  await expect(attachment).toContainText('Vendor reply');
  await expect(attachment).toContainText('We need a date by Thursday.');
  await expect(page.getByRole('textbox', { name: 'Your question' })).toBeVisible();
  expect((await storedDocuments(sw))?.[0]?.body).toBe('We need a date by Thursday.');
});

test('Fix while I type off sends nothing and shows no mark', async ({ page, mock, sw }) => {
  await writeSettings(sw, `${mock.url}/v1`, { idleFix: false });
  await openDocument(page);
  await text(page).click();
  await page.keyboard.type('i has went home');
  await page.waitForTimeout(4500);
  expect(mock.requests).toHaveLength(0);
  await expect(page.locator('.lp-mark')).toHaveCount(0);
});

test('an empty document is not saved', async ({ page, sw }) => {
  await openDocument(page);
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByRole('textbox', { name: 'Your question' })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await storedDocuments(sw)).toBeUndefined();
});

test('Preview shows Markdown and Edit keeps the text', async ({ page, mock, sw }) => {
  await writeSettings(sw, `${mock.url}/v1`, { idleFix: false });
  await openDocument(page);
  await text(page).fill('Some **bold** words');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Preview' }).click();
  await expect(page.locator('.d-preview strong')).toHaveText('bold');
  await expect(text(page)).toBeHidden();
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Edit' }).click();
  await expect(text(page)).toHaveValue('Some **bold** words');
});

test('emptying a saved document saves it empty', async ({ page, mock, sw }) => {
  await writeSettings(sw, `${mock.url}/v1`, { idleFix: false });
  await openDocument(page);
  await text(page).fill('Draft line.');
  await expect.poll(async () => (await storedDocuments(sw))?.[0]?.body).toBe('Draft line.');
  await text(page).fill('');
  await expect.poll(async () => (await storedDocuments(sw))?.[0]?.body).toBe('');
  expect(await storedDocuments(sw)).toHaveLength(1);
});
