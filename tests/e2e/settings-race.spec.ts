import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type CDPSession, type Worker } from '@playwright/test';
import { EXTENSION_ID, extensionWorker, launchExtension } from './extension-runtime';
import { startMockOpenAI, type MockOpenAI } from './mock-openai';

const DIST = fileURLToPath(new URL('../../dist', import.meta.url));
const FAKE_API_KEY = 'sk-localpolish-e2e-fake';
const FIXTURE = 'http://localhost:5179/';
const DEBOUNCE_WAIT_MS = 400;

const NATIVE_STUB = `
globalThis.__benchNative = 0;
chrome.runtime.connectNative = () => {
  globalThis.__benchNative++;
  throw new Error('Offline settings race: native messaging is blocked');
};
`;

// Runs in the extension isolated world before the built content script.
// The first page-settings call uses the real worker reply, stores that snapshot,
// and only then lets the content script continue.
const CONTENT_PREFIX = `
(() => {
  const hook = (globalThis.__lpSettingsRace = {
    requests: 0,
    received: false,
    initial: null,
    initialError: '',
    notices: [],
    release: null,
  });
  const original = chrome.runtime.sendMessage.bind(chrome.runtime);
  let held = false;
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'page-settings-changed') hook.notices.push(message);
  });
  chrome.runtime.sendMessage = (message, ...args) => {
    if (!message || message.type !== 'page-settings') return original(message, ...args);
    hook.requests += 1;
    if (held) return original(message, ...args);
    held = true;
    return original(message, ...args).then(
      (snapshot) => {
        hook.initial = snapshot;
        hook.received = true;
        return new Promise((resolve) => {
          hook.release = () => resolve(snapshot);
        });
      },
      (error) => {
        hook.initialError = error instanceof Error ? error.message : String(error);
        hook.received = true;
        throw error;
      },
    );
  };
})();
`;

interface PageSettings {
  blocklist: string[];
  idleFix: boolean;
  defaultMode: string;
  languages: Record<'en' | 'ar' | 'franco' | 'other', boolean>;
}

interface RaceHook {
  requests: number;
  received: boolean;
  initial: PageSettings | null;
  initialError: string;
  notices: Array<{ type: string; settings: PageSettings }>;
}

interface ExtensionChrome {
  storage: {
    local: {
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
}

const OLD: PageSettings = {
  blocklist: [],
  idleFix: false,
  defaultMode: 'fix',
  languages: { en: true, ar: true, franco: true, other: true },
};
const BLOCKED: PageSettings = {
  blocklist: ['localhost'],
  idleFix: false,
  defaultMode: 'fix',
  languages: { en: true, ar: true, franco: true, other: true },
};

test('a late initial settings reply cannot undo a newer block', async () => {
  test.setTimeout(60_000);
  if (!fs.existsSync(DIST)) throw new Error(`Extension build is missing at ${DIST}`);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localpolish-settings-race-'));
  let extension: Awaited<ReturnType<typeof launchExtension>> | undefined;
  let mock: MockOpenAI | undefined;
  let session: CDPSession | undefined;
  try {
    const copyPath = path.join(tempDir, 'dist');
    fs.cpSync(DIST, copyPath, { recursive: true });
    patchExtension(copyPath);
    const launched = await launchExtension(copyPath);
    extension = launched;
    await expect
      .poll(() => extensionWorker(launched.context)?.url() ?? '', { timeout: 15_000 })
      .toContain(EXTENSION_ID);
    const sw = extensionWorker(launched.context);
    if (!sw) throw new Error('Extension service worker did not start');
    mock = await startMockOpenAI();
    await writeSettings(sw, mock.url, {});

    const page = await launched.context.newPage();
    await page.goto(FIXTURE);
    for (const other of launched.context.pages()) {
      if (other !== page) await other.close();
    }
    await page.bringToFront();
    const cdp = await page.context().newCDPSession(page);
    session = cdp;
    const contexts = new Set<number>();
    cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.add(context.id));
    cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) =>
      contexts.delete(executionContextId),
    );
    await cdp.send('Runtime.enable');

    const contextId = await extensionWorld(cdp, contexts, page.url());
    await expect.poll(async () => (await readHook(cdp, contextId))?.received).toBe(true);
    const captured = await readHook(cdp, contextId);
    expect(captured?.requests).toBe(1);
    expect(captured?.initial).toEqual(OLD);
    expect(captured?.initialError).toBe('');
    // First-run setup can probe the default CLI before this fixture configures the API.
    await sw.evaluate('globalThis.__benchNative = 0');

    await writeSettings(sw, mock.url, { blocklist: ['localhost'] });
    await expect
      .poll(async () => (await readHook(cdp, contextId))?.notices)
      .toEqual([{ type: 'page-settings-changed', settings: BLOCKED }]);
    const blocked = await readHook(cdp, contextId);
    expect(blocked?.initial).toEqual(OLD);
    expect(blocked?.requests).toBe(1);

    await releaseInitial(cdp, contextId);
    const field = page.locator('#ta');
    await field.fill('i has went home');
    await field.click();
    await field.selectText();
    await page.waitForTimeout(DEBOUNCE_WAIT_MS);
    await expect(page.locator('.lp-fab')).toHaveCount(0);
    expect((await readHook(cdp, contextId))?.requests).toBe(1);

    await writeSettings(sw, mock.url, { blocklist: [] });
    await expect
      .poll(async () => (await readHook(cdp, contextId))?.notices.at(-1))
      .toEqual({ type: 'page-settings-changed', settings: OLD });
    await field.click();
    await field.selectText();
    await expect(page.locator('.lp-fab')).toBeVisible();

    const beforeRapid = (await readHook(cdp, contextId))?.notices.length ?? 0;
    await writeSettings(sw, mock.url, { blocklist: ['localhost'] });
    await writeSettings(sw, mock.url, { blocklist: [] });
    await expect
      .poll(async () => {
        const notices = (await readHook(cdp, contextId))?.notices ?? [];
        return notices.length > beforeRapid ? notices.at(-1) : undefined;
      })
      .toEqual({ type: 'page-settings-changed', settings: OLD });
    await field.click();
    await field.selectText();
    await expect(page.locator('.lp-fab')).toBeVisible();

    const hook = await readHook(cdp, contextId);
    expect(hook?.requests).toBe(1);
    expect(JSON.stringify(hook)).not.toContain(FAKE_API_KEY);
    expect(await page.content()).not.toContain(FAKE_API_KEY);
    expect(await sw.evaluate('globalThis.__benchNative')).toBe(0);
    expect(mock.requests).toHaveLength(0);
  } finally {
    await session?.detach().catch(() => undefined);
    try {
      await extension?.close();
    } finally {
      try {
        await mock?.close();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }
});

function patchExtension(copyPath: string): void {
  const manifest = JSON.parse(fs.readFileSync(path.join(copyPath, 'manifest.json'), 'utf8')) as {
    background?: { service_worker?: string };
    content_scripts?: Array<{ js?: string[] }>;
  };
  const workerName = manifest.background?.service_worker;
  const contentName = manifest.content_scripts?.[0]?.js?.[0];
  if (!workerName || !contentName) {
    throw new Error('Extension manifest is missing its worker or content script');
  }
  const workerFile = path.join(copyPath, workerName);
  const contentFile = path.join(copyPath, contentName);
  const content = fs.readFileSync(contentFile);
  if (!content.subarray(0, 20).toString('utf8').startsWith('(function')) {
    throw new Error('Content script prefix expects the built classic script');
  }
  fs.writeFileSync(
    workerFile,
    Buffer.concat([Buffer.from(NATIVE_STUB), fs.readFileSync(workerFile)]),
  );
  fs.writeFileSync(contentFile, Buffer.concat([Buffer.from(CONTENT_PREFIX), content]));
}

async function writeSettings(
  sw: Worker,
  mockUrl: string,
  extra: { blocklist?: string[] },
): Promise<void> {
  const settings = {
    provider: 'openai-compatible',
    openaiBaseUrl: `${mockUrl}/v1`,
    openaiApiKey: FAKE_API_KEY,
    models: { 'openai-compatible': 'mock-model' },
    idleFix: false,
    blocklist: [] as string[],
    ...extra,
  };
  await sw.evaluate((stored) => {
    const chrome = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    return chrome.storage.local.set({ settings: stored });
  }, settings);
}

async function extensionWorld(
  session: CDPSession,
  contexts: Set<number>,
  href: string,
): Promise<number> {
  let contextId: number | undefined;
  const expression = `globalThis.chrome?.runtime?.id === ${JSON.stringify(EXTENSION_ID)} && location.href === ${JSON.stringify(href)}`;
  await expect
    .poll(async () => {
      for (const id of contexts) {
        try {
          const result = await session.send('Runtime.evaluate', {
            contextId: id,
            expression,
            returnByValue: true,
          });
          if (result.result.value === true) {
            contextId = id;
            return true;
          }
        } catch {
          // A context can close while the page is settling.
        }
      }
      return false;
    })
    .toBe(true);
  if (contextId === undefined) throw new Error('Extension content world not found');
  return contextId;
}

async function readHook(session: CDPSession, contextId: number): Promise<RaceHook | null> {
  return evaluate<RaceHook | null>(
    session,
    contextId,
    `(() => {
      const hook = globalThis.__lpSettingsRace;
      if (!hook) return null;
      return {
        requests: hook.requests,
        received: hook.received,
        initial: hook.initial,
        initialError: hook.initialError,
        notices: hook.notices,
      };
    })()`,
  );
}

async function releaseInitial(session: CDPSession, contextId: number): Promise<void> {
  await evaluate(
    session,
    contextId,
    `(() => {
      const hook = globalThis.__lpSettingsRace;
      if (!hook || typeof hook.release !== 'function') {
        throw new Error('Initial settings reply is still pending');
      }
      hook.release();
    })()`,
  );
}

async function evaluate<T>(session: CDPSession, contextId: number, expression: string): Promise<T> {
  const result = await session.send('Runtime.evaluate', {
    contextId,
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? 'Extension world evaluation failed');
  }
  return result.result.value as T;
}
