import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expect,
  test,
  type BrowserContext,
  type CDPSession,
  type Frame,
  type Page,
  type Worker,
} from '@playwright/test';
import { EXTENSION_ID, extensionWorker } from './extension-runtime';
import { startMockOpenAI, type MockOpenAI } from './mock-openai';
import { launchVisibilityBrowser } from './visibility-runtime';

const DIST = fileURLToPath(new URL('../../dist', import.meta.url));
const CLOCK_BUNDLE = fileURLToPath(
  new URL('../../node_modules/playwright-core/lib/coreBundle.js', import.meta.url),
);
const FIXTURE = 'http://localhost:5179/';
const DRAFT = 'i has went home today';
const LATEST = 'these are the latest words';
const IDLE_MS = 3000;
const QUIET_MS = 1000;

const NATIVE_STUB = `
globalThis.__benchNative = 0;
globalThis.__benchSettingsReads = 0;
chrome.runtime.connectNative = () => {
  globalThis.__benchNative++;
  throw new Error('Offline test: native messaging is mocked');
};
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'page-settings') globalThis.__benchSettingsReads++;
});
`;

interface PageSettings {
  blocklist: string[];
  idleFix: boolean;
  defaultMode: string;
  languages: Record<'en' | 'ar' | 'franco' | 'other', boolean>;
}

interface UsageRow {
  provider: string;
  model: string;
  requests: number;
}

interface World {
  href: string;
  evaluate<T>(expression: string): Promise<T>;
}

interface Editor {
  page: Page;
  frame(selector: string): Promise<Frame>;
  world(href: string): World;
  forward(ms: number): Promise<void>;
  apply(extra: { idleFix?: boolean; blocklist?: string[] }): Promise<void>;
  close(): Promise<void>;
}

let browser: { context: BrowserContext; close(): Promise<void> } | undefined;
let mock: MockOpenAI | undefined;
let sw: Worker | undefined;
let cover: Page | undefined;
let tempDir: string | undefined;
let editor: Editor | undefined;

test.describe('hidden idle requests', () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeAll(async () => {
    if (!fs.existsSync(DIST)) throw new Error(`Extension build is missing at ${DIST}`);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localpolish-visibility-idle-'));
    const copyPath = path.join(tempDir, 'dist');
    fs.cpSync(DIST, copyPath, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(copyPath, 'manifest.json'), 'utf8')) as {
      background?: { service_worker?: string };
    };
    const workerName = manifest.background?.service_worker;
    if (!workerName) throw new Error('Extension manifest has no background service worker');
    const workerFile = path.join(copyPath, workerName);
    const builtWorker = fs.readFileSync(workerFile);
    fs.writeFileSync(workerFile, Buffer.concat([Buffer.from(NATIVE_STUB), builtWorker]));

    const launched = await launchVisibilityBrowser(copyPath);
    browser = launched;
    await expect
      .poll(() => extensionWorker(launched.context)?.url() ?? '', { timeout: 15_000 })
      .toContain(EXTENSION_ID);
    const worker = extensionWorker(launched.context);
    if (!worker) throw new Error('Extension service worker did not start');
    sw = worker;
    mock = await startMockOpenAI();
    await writeSettings({ idleFix: true, blocklist: [] });
    for (const page of browser.context.pages()) await page.close();
    cover = await browser.context.newPage();
    await cover.setContent('Cover');
  });

  test.afterAll(async () => {
    try {
      await browser?.close();
    } finally {
      try {
        await mock?.close();
      } finally {
        if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  test.beforeEach(async () => {
    if (!mock || !sw) throw new Error('Visibility idle harness did not start');
    mock.reply({ chunks: ['I went', ' home.'] });
    mock.requests.length = 0;
    await sw.evaluate(async () => {
      const chrome = (globalThis as unknown as { chrome: ChromeStorage }).chrome;
      await chrome.storage.local.set({ usage: [] });
    });
    // A repeated true/true write does not emit storage.onChanged, so the first
    // apply must change idle Fix from off to on.
    await writeSettings({ idleFix: false, blocklist: [] });
  });

  test.afterEach(async () => {
    await editor?.close();
    editor = undefined;
  });

  test('a hidden tab waits, then sends the latest focused text once', async () => {
    editor = await openEditor('');
    await editor.apply({ idleFix: true, blocklist: [] });
    await editor.page.locator('#ta').click();
    await editor.page.keyboard.type(DRAFT);
    await hide(editor.page);
    await editor.forward(IDLE_MS);
    await expectQuiet();
    await editor.page.locator('#ta').evaluate((el, value: string) => {
      (el as HTMLTextAreaElement).value = value;
    }, LATEST);
    await show(editor.page);
    await expectFocused(editor.page, 'ta');
    await expect.poll(() => requests().length, { timeout: 10_000 }).toBe(1);
    expect(requestText()).toBe(wrapped(LATEST));
    await expectUsage(1);
    await editor.forward(IDLE_MS);
    await stayAtOneRequest();
  });

  test('returning early waits only for the rest of the pause', async () => {
    editor = await openEditor('');
    await editor.apply({ idleFix: true, blocklist: [] });
    await editor.page.locator('#ta').click();
    await editor.page.keyboard.type(DRAFT);
    await hide(editor.page);
    await editor.forward(2_000);
    await expectQuiet();
    await show(editor.page);
    await expectFocused(editor.page, 'ta');
    expect(requests()).toHaveLength(0);
    await editor.forward(999);
    await expectQuiet();
    await editor.forward(1);
    await expect.poll(() => requests().length, { timeout: 10_000 }).toBe(1);
    expect(requestText()).toBe(wrapped(DRAFT));
    await expectUsage(1);
    await editor.forward(IDLE_MS);
    await stayAtOneRequest();
  });

  test('idle switched off while hidden does not start on return', async () => {
    editor = await openEditor('');
    await editor.apply({ idleFix: true, blocklist: [] });
    await editor.page.locator('#ta').click();
    await editor.page.keyboard.type(DRAFT);
    await hide(editor.page);
    await editor.apply({ idleFix: false, blocklist: [] });
    await editor.forward(IDLE_MS);
    await expectQuiet();
    await show(editor.page);
    await expectQuiet();
    await editor.apply({ idleFix: true, blocklist: [] });
    await editor.page.locator('#ta').click();
    await editor.page.keyboard.type(' and then some more words');
    await editor.forward(IDLE_MS);
    await expect.poll(() => requests().length, { timeout: 10_000 }).toBe(1);
    expect(requestText()).toContain('and then some more words');
    await expectUsage(1);
  });

  test('a site blocked while hidden does not start on return', async () => {
    editor = await openEditor('');
    await editor.apply({ idleFix: true, blocklist: [] });
    await editor.page.locator('#ta').click();
    await editor.page.keyboard.type(DRAFT);
    await hide(editor.page);
    await editor.apply({ idleFix: true, blocklist: ['localhost'] });
    await editor.forward(IDLE_MS);
    await expectQuiet();
    await show(editor.page);
    await expectQuiet();
    await editor.apply({ idleFix: true, blocklist: [] });
    await editor.page.locator('#ta').click();
    await editor.page.keyboard.type(' and then some more words');
    await editor.forward(IDLE_MS);
    await expect.poll(() => requests().length, { timeout: 10_000 }).toBe(1);
    await expectUsage(1);
  });

  test('a running request finishes while hidden and marker polling stops', async () => {
    editor = await openEditor('');
    await editor.apply({ idleFix: true, blocklist: [] });
    const world = editor.world(editor.page.url());
    await world.evaluate(READ_PROBE);
    const server = activeMock();
    server.reply({ chunks: ['I went home today.'], hold: true });
    const before = {
      started: server.streams.started,
      cancelled: server.streams.cancelled,
      finished: server.streams.finished,
    };
    await editor.page.locator('#ta').click();
    await editor.page.keyboard.type(DRAFT);
    await editor.forward(IDLE_MS);
    await expect.poll(() => requests().length, { timeout: 10_000 }).toBe(1);
    await expect.poll(() => server.streams.active).toBe(1);
    await expectUsage(1);
    await expect(editor.page.locator('.lp-mark')).toBeVisible();

    await hide(editor.page);
    await expect(editor.page.locator('.lp-mark')).toHaveCount(0);
    expect(server.streams.active).toBe(1);
    expect(requests()).toHaveLength(1);
    await expectUsage(1);
    await world.evaluate(RESET_READS);
    await editor.forward(1_000);
    expect(await reads(world)).toEqual({ rect: 0, text: 0 });

    server.releaseHeld();
    await expect.poll(() => server.streams.finished).toBe(before.finished + 1);
    expect(server.streams.cancelled).toBe(before.cancelled);
    expect(server.streams.started).toBe(before.started + 1);
    expect(server.streams.active).toBe(0);
    expect(requests()).toHaveLength(1);
    await expectUsage(1);
    expect(await reads(world)).toEqual({ rect: 0, text: 0 });
    await editor.forward(1_000);
    expect(await reads(world)).toEqual({ rect: 0, text: 0 });

    await show(editor.page);
    await expect(editor.page.locator('.lp-mark')).toBeVisible();
    await expect.poll(async () => (await reads(world)).rect).toBeGreaterThan(0);
    expect((await reads(world)).text).toBeGreaterThan(0);
    expect(requests()).toHaveLength(1);
  });

  test('a cross-host editor waits for its own document to be visible', async () => {
    await expectFrameRequest('#cross-host');
  });

  test('a srcdoc editor waits for its own document to be visible', async () => {
    await expectFrameRequest('#srcdoc');
  });

  test('a blocked ancestor stays quiet when its frame becomes visible', async () => {
    editor = await openFrames();
    const frame = await editor.frame('#srcdoc');
    await editor.apply({ idleFix: true, blocklist: [] });
    await frame.locator('textarea').click();
    await frame.locator('textarea').pressSequentially(DRAFT);
    await hide(frame);
    await editor.apply({ idleFix: true, blocklist: ['localhost'] });
    await editor.forward(IDLE_MS);
    await expectQuiet();
    await show(editor.page, frame);
    await expectQuiet();
    await editor.apply({ idleFix: true, blocklist: [] });
    await frame.locator('textarea').click();
    await frame.locator('textarea').pressSequentially(' and then some more words');
    await editor.forward(IDLE_MS);
    await expect.poll(() => requests().length, { timeout: 10_000 }).toBe(1);
    expect(requestText()).toContain('and then some more words');
    await expectUsage(1);
  });
});

async function expectFrameRequest(selector: string): Promise<void> {
  editor = await openFrames();
  const frame = await editor.frame(selector);
  await editor.apply({ idleFix: true, blocklist: [] });
  await frame.locator('textarea').click();
  await frame.locator('textarea').pressSequentially(DRAFT);
  await hide(frame);
  await editor.forward(IDLE_MS);
  await expectQuiet();
  await show(editor.page, frame);
  await expect
    .poll(() => frame.evaluate(() => document.activeElement?.tagName ?? ''))
    .toBe('TEXTAREA');
  await expect.poll(() => requests().length, { timeout: 10_000 }).toBe(1);
  expect(requestText()).toBe(wrapped(DRAFT));
  await expectUsage(1);
  await editor.forward(IDLE_MS);
  await stayAtOneRequest();
}

async function openEditor(fixture: string): Promise<Editor> {
  return openPage(`${FIXTURE}${fixture}`, async (page) => {
    if (fixture === '') await expect(page.locator('#ta')).toBeVisible();
    return [page.url()];
  });
}

async function openFrames(): Promise<Editor> {
  return openPage(`${FIXTURE}frames.html`, async (page) => {
    await expect(page.frameLocator('#cross-host').locator('textarea')).toBeVisible();
    await expect(page.frameLocator('#srcdoc').locator('textarea')).toBeVisible();
    const hrefs: string[] = [];
    for (const selector of ['#cross-host', '#srcdoc']) {
      const frame = await contentFrame(page, selector);
      hrefs.push(frame.url());
    }
    return hrefs;
  });
}

async function openPage(url: string, ready: (page: Page) => Promise<string[]>): Promise<Editor> {
  if (!browser) throw new Error('Visibility browser is not open');
  const page = await browser.context.newPage();
  const sessions: CDPSession[] = [];
  try {
    await page.goto(url);
    const hrefs = await ready(page);
    await page.clock.install();
    await page.clock.pauseAt(Date.now() + 60_000);
    const pausedAt = await page.evaluate(() => Date.now());
    const worlds = await attachWorlds(page, hrefs, sessions);
    for (const href of hrefs) {
      const world = worlds.get(href);
      if (!world) {
        throw new Error(
          `No extension world for ${href}. Found ${[...worlds.keys()].join(', ') || 'none'}.`,
        );
      }
      await world.evaluate(clockExpression(pausedAt));
      await world.evaluate(SETTINGS_PROBE);
    }
    return {
      page,
      async frame(selector: string) {
        return contentFrame(page, selector);
      },
      world(href: string) {
        const world = worlds.get(href);
        if (!world) throw new Error(`No extension world for ${href}`);
        return world;
      },
      async forward(ms: number) {
        await page.clock.fastForward(ms);
        for (const world of worlds.values()) {
          await world.evaluate(`globalThis.__pwClock.controller.fastForward(${ms})`);
        }
      },
      async apply(extra) {
        await applySettings(worlds, extra);
      },
      async close() {
        await page.clock.resume().catch(() => undefined);
        await page.close().catch(() => undefined);
        for (const session of sessions) await session.detach().catch(() => undefined);
      },
    };
  } catch (error) {
    await page.close().catch(() => undefined);
    for (const session of sessions) await session.detach().catch(() => undefined);
    throw error;
  }
}

async function attachWorlds(
  page: Page,
  hrefs: string[],
  sessions: CDPSession[],
): Promise<Map<string, World>> {
  const found = new Map<string, World>();
  const tracked = new Map<string, { session: CDPSession; ids: Set<number> }>();

  await expect
    .poll(
      async () => {
        for (const href of hrefs) {
          if (found.has(href)) continue;
          let entry = tracked.get(href);
          if (!entry) {
            const frame = frameFor(page, href);
            if (!frame) continue;
            let session: CDPSession;
            try {
              session = await page.context().newCDPSession(frame);
            } catch (error) {
              if (!(error instanceof Error) || !error.message.includes('part of the parent frame'))
                throw error;
              session = await page.context().newCDPSession(page);
            }
            sessions.push(session);
            const ids = new Set<number>();
            session.on('Runtime.executionContextCreated', ({ context }) => ids.add(context.id));
            session.on('Runtime.executionContextDestroyed', ({ executionContextId }) =>
              ids.delete(executionContextId),
            );
            entry = { session, ids };
            tracked.set(href, entry);
            await session.send('Runtime.enable');
          }
          await absorb(entry.session, entry.ids, href, found);
        }
        return hrefs.filter((href) => !found.has(href));
      },
      { timeout: 15_000 },
    )
    .toEqual([]);
  return found;
}

function frameFor(page: Page, href: string): Frame | undefined {
  if (page.mainFrame().url() === href) return page.mainFrame();
  return page.frames().find((frame) => frame.url() === href);
}

async function absorb(
  session: CDPSession,
  ids: Set<number>,
  href: string,
  found: Map<string, World>,
): Promise<void> {
  for (const id of ids) {
    let extensionId: unknown;
    try {
      extensionId = await evaluate(session, id, 'globalThis.chrome?.runtime?.id');
    } catch {
      continue;
    }
    if (extensionId !== EXTENSION_ID) continue;
    let locationHref: unknown;
    try {
      locationHref = await evaluate(session, id, 'location.href');
    } catch {
      continue;
    }
    if (locationHref !== href || found.has(href)) continue;
    found.set(href, {
      href,
      evaluate: <T>(expression: string) => evaluate(session, id, expression) as Promise<T>,
    });
  }
}

async function evaluate(
  session: CDPSession,
  contextId: number,
  expression: string,
): Promise<unknown> {
  const evaluated = await session.send('Runtime.evaluate', {
    contextId,
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (evaluated.exceptionDetails) {
    throw new Error(evaluated.exceptionDetails.text ?? 'Isolated world evaluation failed');
  }
  return evaluated.result.value;
}

async function applySettings(
  worlds: Map<string, World>,
  extra: { idleFix?: boolean; blocklist?: string[] },
): Promise<void> {
  const expected: PageSettings = {
    blocklist: extra.blocklist ?? [],
    idleFix: extra.idleFix ?? true,
    defaultMode: 'fix',
    languages: { en: true, ar: true, franco: true, other: true },
  };
  for (const world of worlds.values()) {
    await world.evaluate('globalThis.__lpPageSettings = undefined');
  }
  await writeSettings(extra);
  for (const world of worlds.values()) {
    await expect
      .poll(() => world.evaluate<boolean>('Boolean(globalThis.__lpPageSettings)'))
      .toBe(true);
    const applied = await world.evaluate<PageSettings>('globalThis.__lpPageSettings');
    expect(applied).toEqual(expected);
  }
}

async function writeSettings(extra: { idleFix?: boolean; blocklist?: string[] }): Promise<void> {
  if (!mock || !sw) throw new Error('Visibility idle harness did not start');
  const settings = {
    provider: 'openai-compatible',
    openaiBaseUrl: `${mock.url}/v1`,
    openaiApiKey: 'sk-localpolish-e2e-fake',
    models: { 'openai-compatible': 'mock-model' },
    idleFix: true,
    blocklist: [] as string[],
    ...extra,
  };
  await sw.evaluate(async (stored) => {
    const chrome = (globalThis as unknown as { chrome: ChromeStorage }).chrome;
    await chrome.storage.local.set({ settings: stored });
  }, settings);
}

async function readUsage(): Promise<UsageRow[]> {
  if (!sw) throw new Error('Extension service worker did not start');
  const usage = await sw.evaluate(async () => {
    const chrome = (globalThis as unknown as { chrome: ChromeStorage }).chrome;
    const stored = await chrome.storage.local.get('usage');
    return stored.usage ?? [];
  });
  return usage as UsageRow[];
}

async function expectUsage(requests: number): Promise<void> {
  await expect
    .poll(() => readUsage())
    .toEqual([{ provider: 'openai-compatible', model: 'mock-model', requests }]);
}

async function expectQuiet(): Promise<void> {
  const deadline = Date.now() + QUIET_MS;
  while (Date.now() < deadline) {
    if (requests().length !== 0) {
      throw new Error(`Unexpected idle request: ${JSON.stringify(requests()[0]?.body)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(requests()).toHaveLength(0);
  expect(await readUsage()).toEqual([]);
}

async function stayAtOneRequest(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
  expect(requests()).toHaveLength(1);
  expect(await readUsage()).toEqual([
    { provider: 'openai-compatible', model: 'mock-model', requests: 1 },
  ]);
}

async function hide(document: Page | Frame): Promise<void> {
  if (!cover) throw new Error('Cover page is not open');
  await cover.bringToFront();
  await expect.poll(() => readVisibility(document)).toEqual({ hidden: true, state: 'hidden' });
}

async function show(page: Page, document: Page | Frame = page): Promise<void> {
  await page.bringToFront();
  await expect.poll(() => readVisibility(document)).toEqual({ hidden: false, state: 'visible' });
}

function readVisibility(target: Page | Frame): Promise<{ hidden: boolean; state: string }> {
  return target.evaluate(() => ({ hidden: document.hidden, state: document.visibilityState }));
}

async function expectFocused(page: Page, id: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? '')).toBe(id);
}

async function contentFrame(page: Page, selector: string): Promise<Frame> {
  const handle = await page.locator(selector).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error(`No frame for ${selector}`);
  return frame;
}

function activeMock(): MockOpenAI {
  if (!mock) throw new Error('Mock OpenAI is not open');
  return mock;
}

function requests(): MockOpenAI['requests'] {
  return activeMock().requests;
}

function requestText(): string {
  const content = requests()[0]?.body?.messages?.[1]?.content;
  if (typeof content !== 'string') throw new Error('Idle request has no user text');
  return content;
}

function wrapped(text: string): string {
  return `<text>\n${text}\n</text>`;
}

async function reads(world: World): Promise<{ rect: number; text: number }> {
  return world.evaluate(READ_COUNTS);
}

interface ChromeStorage {
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
}

let clockSource: string | undefined;

function clockExpression(pausedAt: number): string {
  return `(() => {
    const module = {};
    ${playwrightClockSource()}
    if (!globalThis.__pwClock) {
      globalThis.__pwClock = (module.exports.inject())(globalThis, 'chromium');
    }
    const controller = globalThis.__pwClock.controller;
    controller.install(${pausedAt});
    return controller.pauseAt(${pausedAt});
  })()`;
}

function playwrightClockSource(): string {
  if (clockSource) return clockSource;
  const bundle = fs.readFileSync(CLOCK_BUNDLE, 'utf8');
  const comment = bundle.indexOf('// packages/injected/src/clock.ts');
  const assign = bundle.lastIndexOf('source = ', comment);
  if (comment < 0 || assign < 0) throw new Error('Playwright clock source was not found');
  const quote = bundle[assign + 'source = '.length];
  if (quote !== "'" && quote !== '"') throw new Error('Playwright clock source is not a string');
  let cursor = assign + 'source = '.length + 1;
  let source = '';
  while (cursor < bundle.length) {
    const ch = bundle[cursor];
    if (ch === '\\') {
      const next = bundle[cursor + 1];
      if (next === 'n') source += '\n';
      else if (next === 'r') source += '\r';
      else if (next === 't') source += '\t';
      else if (next === '\\' || next === "'" || next === '"') source += next;
      else if (next === 'u') {
        source += String.fromCharCode(Number.parseInt(bundle.slice(cursor + 2, cursor + 6), 16));
        cursor += 6;
        continue;
      } else source += next ?? '';
      cursor += 2;
      continue;
    }
    if (ch === quote) break;
    source += ch;
    cursor += 1;
  }
  if (!source.includes('function inject')) throw new Error('Playwright clock source is incomplete');
  clockSource = source;
  return source;
}

// Playwright's page clock replaces timers in the main world only.
// The content script has its own timers, so the same installed clock is applied there.
const SETTINGS_PROBE = `(() => {
  if (globalThis.__lpSettingsProbe) return;
  globalThis.__lpSettingsProbe = true;
  const runtime = chrome.runtime;
  runtime.onMessage.addListener((message) => {
    if (message && message.type === 'page-settings-changed') {
      globalThis.__lpPageSettings = new Promise((resolve) => {
        queueMicrotask(() => resolve(message.settings));
      });
    }
  });
})()`;

const READ_PROBE = `(() => {
  if (globalThis.__lpReads) return;
  globalThis.__lpReads = { rect: 0, text: 0 };
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    globalThis.__lpReads.rect += 1;
    return rect.call(this);
  };
  const watch = (prototype) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (!descriptor || !descriptor.get || !descriptor.set) throw new Error('Field value is not an accessor');
    const get = descriptor.get;
    const set = descriptor.set;
    Object.defineProperty(prototype, 'value', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        globalThis.__lpReads.text += 1;
        return get.call(this);
      },
      set(value) {
        set.call(this, value);
      },
    });
  };
  watch(HTMLTextAreaElement.prototype);
  watch(HTMLInputElement.prototype);
})()`;

const RESET_READS = `(() => {
  globalThis.__lpReads.rect = 0;
  globalThis.__lpReads.text = 0;
})()`;

const READ_COUNTS = `(() => ({ rect: globalThis.__lpReads.rect, text: globalThis.__lpReads.text }))()`;
