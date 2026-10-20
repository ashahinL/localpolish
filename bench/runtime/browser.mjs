import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { small, multilingual, large, rich, sizes } from './fixtures.mjs';
import { instrument } from './instrument.mjs';

const pause = (page, ms) => page.waitForTimeout(ms);

export async function browserSession(root, load, artifactDir, label) {
  const { launchExtension, extensionWorker, EXTENSION_ID } = load('tests/e2e/extension-runtime');
  const { startMockOpenAI } = load('tests/e2e/mock-openai');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'localpolish-runtime-extension-'));
  let extension;
  let mock;
  let server;
  const cleanup = async () => {
    mock?.releaseHeld();
    const results = await Promise.allSettled([
      extension?.close(),
      mock?.close(),
      server?.listening
        ? new Promise((resolve) => {
            server.close(resolve);
            server.closeAllConnections();
          })
        : undefined,
    ]);
    fs.rmSync(temp, { recursive: true, force: true });
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
  };
  try {
    const copyPath = path.join(temp, 'dist');
    fs.cpSync(path.join(root, 'dist'), copyPath, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(copyPath, 'manifest.json'), 'utf8'));
    const workerFile = path.join(copyPath, manifest.background.service_worker);
    const builtWorker = fs.readFileSync(workerFile);
    const nativeBoundaryStub = `
globalThis.__benchNative = 0;
globalThis.__benchSettingsReads = 0;
chrome.runtime.connectNative = () => {
  globalThis.__benchNative++;
  throw new Error('Offline runtime benchmark: native messaging is mocked');
};
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'page-settings') globalThis.__benchSettingsReads++;
});
`;
    fs.writeFileSync(workerFile, Buffer.concat([Buffer.from(nativeBoundaryStub), builtWorker]));
    extension = await launchExtension(copyPath);
    const context = extension.context;
    await expect.poll(() => extensionWorker(context)?.url(), { timeout: 15_000 }).toBeTruthy();
    const worker = extensionWorker(context);
    mock = await startMockOpenAI();
    const settings = async (extra = {}) =>
      worker.evaluate(
        async ({ base, extra }) => {
          const { settings = {} } = await chrome.storage.local.get('settings');
          await chrome.storage.local.set({
            settings: {
              ...settings,
              provider: 'openai-compatible',
              openaiBaseUrl: `${base}/v1`,
              openaiApiKey: 'synthetic-runtime-key',
              models: { 'openai-compatible': 'synthetic-runtime-model' },
              idleFix: false,
              blocklist: [],
              ...extra,
            },
          });
        },
        { base: mock.url, extra },
      );
    await settings();
    for (const page of context.pages()) await page.close();
    server = createServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (req.url === '/frames') {
        res.end(
          '<!doctype html><title>Synthetic frames</title><iframe src="/editor"></iframe><iframe src="/editor"></iframe><iframe src="/editor"></iframe>',
        );
      } else {
        res.end(
          '<!doctype html><title>Synthetic runtime editor</title><style>textarea,[contenteditable]{display:block;width:600px;min-height:100px;margin:20px;border:1px solid black}body{min-height:2000px}</style><textarea id="draft"></textarea><div id="rich" contenteditable="true"></div>',
        );
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const worlds = [];
    cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
    await cdp.send('Runtime.enable');
    await cdp.send('Performance.enable');
    await page.goto(`${base}/editor`);
    await expect
      .poll(() => worlds.some((world) => world.origin === `chrome-extension://${EXTENSION_ID}`))
      .toBe(true);
    const world = worlds.findLast((world) => world.origin === `chrome-extension://${EXTENSION_ID}`);
    const evaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', {
        contextId: world.id,
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await evaluate(`(${instrument.toString()})()`);
    const counters = () => evaluate('__runtimeBench.snapshot()');
    const reset = () => evaluate('__runtimeBench.reset()');
    const open = async () => {
      await page.bringToFront();
      await page.locator('#draft').focus();
      await worker.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((tab) => tab.url === url);
        if (tab?.id === undefined) throw new Error('Synthetic editor tab not found');
        await chrome.tabs.sendMessage(tab.id, { type: 'open-popup' });
      }, page.url());
    };
    const close = async () => {
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(page.locator('.lp-popup')).toHaveCount(0);
    };
    const finalText = () =>
      page.locator('.lp-diff').evaluate((element) =>
        [...element.childNodes]
          .filter((node) => node.nodeName !== 'DEL')
          .map((node) => node.textContent ?? '')
          .join(''),
      );
    const memory = async () => ({
      ...(await cdp.send('Memory.getDOMCounters')),
      heap: await cdp.send('Runtime.getHeapUsage'),
      observedPending: (await counters()).pending,
      popupNodes: await page.locator('.lp-popup').count(),
      rootNodes: await page.locator('localpolish-root').count(),
      exactExtensionListenerCount: null,
      exactExtensionListenerCountReason:
        'CDP reports renderer-wide listeners; pre-instrumentation extension listeners cannot be isolated.',
      pendingWorkScope:
        'Only timers/intervals/rAF scheduled in the content world after instrumentation. Worker and pre-existing work unavailable.',
    });
    const heapSnapshot = async (suffix) => {
      const filename = `${label}-${suffix}-${randomUUID()}.heapsnapshot`;
      const file = path.join(artifactDir, filename);
      const fd = fs.openSync(file, 'w');
      const append = ({ chunk }) => fs.writeSync(fd, chunk);
      cdp.on('HeapProfiler.addHeapSnapshotChunk', append);
      try {
        await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
      } finally {
        cdp.off('HeapProfiler.addHeapSnapshotChunk', append);
        fs.closeSync(fd);
      }
      return { file: filename, bytes: fs.statSync(file).size, gcDependent: true };
    };
    let modelRevision = 0;
    let richRevision = 0;
    const run = async (name, iteration) => {
      const requestStart = mock.requests.length;
      await reset();
      const start = performance.now();
      let detail;
      if (['rewrite-small', 'rewrite-multilingual', 'diff-1500-no-overlap'].includes(name)) {
        const fixture =
          name === 'rewrite-small' ? small : name === 'rewrite-multilingual' ? multilingual : large;
        // Paced local chunks keep the real first preview observable before ready.
        const half = Math.floor(fixture.output.length / 2);
        mock.reply({
          chunks: [fixture.output.slice(0, half), fixture.output.slice(half)],
          intervalMs: 75,
        });
        await page.locator('#draft').fill(fixture.input);
        await reset();
        await open();
        await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeEnabled({
          timeout: 20_000,
        });
        assert.equal(await finalText(), fixture.output);
        const lifecycle = await counters();
        assert.ok(lifecycle.firstPreviewMs !== null, 'No actual streaming preview observed');
        assert.ok(lifecycle.readyMs >= lifecycle.firstPreviewMs);
        const views = [];
        if (name === 'diff-1500-no-overlap') {
          for (let repeat = 0; repeat < 3; repeat++) {
            for (const view of ['Final', 'Changes']) {
              const before = Object.fromEntries(
                (await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [
                  name,
                  value,
                ]),
              );
              const at = performance.now();
              await page.getByRole('button', { name: view, exact: true }).click();
              if (view === 'Final')
                await expect(page.locator('.lp-final')).toHaveText(fixture.output);
              else assert.equal(await finalText(), fixture.output);
              const after = Object.fromEntries(
                (await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [
                  name,
                  value,
                ]),
              );
              views.push({
                view,
                repeat,
                ms: performance.now() - at,
                scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
              });
            }
          }
        }
        detail = { ...sizes(fixture), ...lifecycle, views };
        await close();
        assert.equal(mock.requests.length - requestStart, 1);
      } else if (name === 'selection-100') {
        await page.locator('#draft').fill('word '.repeat(2000));
        await page.locator('#draft').focus();
        await page.locator('#draft').evaluate((field) => field.setSelectionRange(1, 5000));
        await pause(page, 250);
        await reset();
        const burst = await evaluate(`(() => {
          const at = performance.now();
          for(let i=0;i<100;i++) document.dispatchEvent(new Event('selectionchange'));
          return {dispatchMs: performance.now()-at, immediate: __runtimeBench.snapshot()};
        })()`);
        await pause(page, 250);
        const settled = await counters();
        for (const call of [
          'getComputedStyle',
          'getBoundingClientRect',
          'offsetTop',
          'offsetLeft',
          'offsetHeight',
        ]) {
          assert.equal(burst.immediate.calls[call] ?? 0, 0, `${call} before debounce`);
          assert.equal(settled.calls[call] ?? 0, 1, `${call} after debounce`);
        }
        detail = { events: 100, inputBytes: 10_000, ...burst, settled };
      } else if (name === 'idle-off') {
        await page.locator('#draft').fill('');
        await reset();
        await page.locator('#draft').pressSequentially('abcdefghij');
        const afterTyping = await counters();
        await pause(page, 3300);
        const afterPause = await counters();
        assert.equal(mock.requests.length - requestStart, 0);
        assert.equal(afterTyping.calls['setTimeout:3000'] ?? 0, 0);
        await page.locator('#draft').selectText();
        await expect(page.locator('.lp-fab')).toBeVisible();
        await settings({ idleFix: true, blocklist: ['127.0.0.1'] });
        await expect(page.locator('.lp-fab')).toHaveCount(0);
        await page.locator('#draft').press('End');
        await page.locator('#draft').fill('');
        await reset();
        await page.locator('#draft').pressSequentially('abcdefghij');
        const blockedTyping = await counters();
        await pause(page, 3300);
        const blockedPause = await counters();
        assert.equal(blockedTyping.calls['setTimeout:3000'] ?? 0, 0);
        assert.equal(mock.requests.length - requestStart, 0);
        await settings();
        detail = {
          characters: 10,
          inputBytes: 10,
          observationMs: 3300,
          afterTyping,
          afterPause,
          blocked: { afterTyping: blockedTyping, afterPause: blockedPause },
        };
      } else if (name === 'rich-marker') {
        const fixture = {
          input: rich.input.slice(0, -6) + String(++richRevision).padStart(6, '0'),
          output: rich.output,
        };
        await settings({ idleFix: true });
        mock.reply({ chunks: [fixture.output] });
        await page.locator('#rich').fill(fixture.input);
        await expect(page.locator('.lp-mark')).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => mock.streams.active).toBe(0);
        await reset();
        await pause(page, 900);
        const observed = await counters();
        assert.ok((observed.calls.innerText ?? 0) <= 1000);
        detail = {
          ...sizes(fixture),
          observationMs: 900,
          ...observed,
          renderInvocations: null,
          renderInvocationsReason:
            'Bundled Preact render is not exported. markMutationRecords counts DOM mutations, not render calls.',
        };
        assert.equal(mock.requests.length - requestStart, 1);
        await settings({ idleFix: false });
        await expect(page.locator('.lp-mark')).toHaveCount(0);
        await page.locator('#rich').fill('');
        await settings();
      } else if (name === 'api-native-checks') {
        await worker.evaluate(() => {
          globalThis.__benchNative = 0;
        });
        const pages = [];
        for (const route of ['options', 'popup', 'setup']) {
          const ui = await context.newPage();
          await ui.goto(`chrome-extension://${EXTENSION_ID}/${route}.html`);
          await expect(
            ui.getByRole('button', { name: 'Test connection', exact: true }),
          ).toBeVisible();
          await pause(ui, 300);
          pages.push({
            page: route,
            cumulativeNativeChecks: await worker.evaluate(() => globalThis.__benchNative),
          });
          await ui.close();
        }
        const nativeChecks = await worker.evaluate(() => globalThis.__benchNative);
        assert.equal(nativeChecks, 0);
        detail = { pages, nativeChecks };
      } else if (name === 'connection-owner-close') {
        mock.reply({ chunks: ['Still working'], hold: true });
        const before = { ...mock.streams };
        const owner = await context.newPage();
        try {
          await owner.goto(`chrome-extension://${EXTENSION_ID}/popup.html`);
          await owner.getByRole('button', { name: 'Test connection', exact: true }).click();
          await expect.poll(() => mock.streams.active).toBe(1);
          const activeBeforeClose = mock.streams.active;
          await owner.close();
          await pause(page, 500);
          await expect.poll(() => mock.streams.active).toBe(0);
          await expect.poll(() => mock.streams.cancelled - before.cancelled).toBe(1);
          detail = {
            activeBeforeClose,
            observationMs: 500,
            activeAfterOwnerClose: mock.streams.active,
            cancellationsAfterOwnerClose: mock.streams.cancelled - before.cancelled,
          };
          assert.equal(mock.requests.length - requestStart, 1);
        } finally {
          mock.releaseHeld();
          await owner.close();
          await expect.poll(() => mock.streams.active).toBe(0);
        }
      } else if (name === 'model-settings-frames') {
        const frames = await context.newPage();
        try {
          await frames.goto(`${base}/frames`);
          await expect.poll(() => frames.frames().length).toBe(4);
          await pause(frames, 500);
          await worker.evaluate(() => {
            globalThis.__benchSettingsReads = 0;
          });
          await worker.evaluate(async (iteration) => {
            const { settings } = await chrome.storage.local.get('settings');
            await chrome.storage.local.set({
              settings: {
                ...settings,
                models: { ...settings.models, 'openai-compatible': `synthetic-${iteration}` },
              },
            });
          }, ++modelRevision);
          await pause(frames, 500);
          const pageSettingsQueries = await worker.evaluate(() => globalThis.__benchSettingsReads);
          assert.ok(pageSettingsQueries <= 30);
          detail = {
            framedPageFrames: frames.frames().length,
            editorFrames: 1,
            totalFrames: 5,
            pageSettingsQueries,
            observationMs: 500,
          };
        } finally {
          await frames.close();
        }
      } else if (name === 'open-close-retention') {
        mock.reply({ chunks: [small.output] });
        await page.locator('#draft').fill(small.input);
        const before = await memory();
        const cycles = [];
        const heaps = [];
        if (iteration === 0) heaps.push(await heapSnapshot('before'));
        for (let cycle = 0; cycle < 3; cycle++) {
          await open();
          await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeEnabled();
          assert.equal(await finalText(), small.output);
          await close();
          await pause(page, 100);
          const observation = await memory();
          assert.equal(observation.popupNodes, 0);
          assert.ok(observation.rootNodes <= 1);
          assert.ok(observation.observedPending.timeouts <= 100);
          cycles.push(observation);
        }
        if (iteration === 0) heaps.push(await heapSnapshot('after'));
        assert.equal(mock.requests.length - requestStart, 3);
        detail = { cycles, before, heapSnapshots: heaps, ...sizes(small) };
      } else throw new Error(`Unknown browser scenario: ${name}`);
      const requests = mock.requests.length - requestStart;
      if (['selection-100', 'api-native-checks', 'model-settings-frames'].includes(name))
        assert.equal(requests, 0);
      return { ms: performance.now() - start, requests, ...detail, observed: await counters() };
    };
    return {
      run,
      browserVersion: context.browser()?.version() ?? 'unavailable',
      close: cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
