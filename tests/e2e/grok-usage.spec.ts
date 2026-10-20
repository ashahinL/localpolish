import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { EXTENSION_ID, extensionWorker, launchExtension } from './extension-runtime';

const NATIVE_STUB = `
chrome.runtime.connectNative = () => {
  const messages = [];
  const disconnects = [];
  return {
    onMessage: { addListener: (cb) => messages.push(cb) },
    onDisconnect: { addListener: (cb) => disconnects.push(cb) },
    disconnect: () => disconnects.forEach((cb) => cb()),
    postMessage: (request) => {
      queueMicrotask(() => {
        const send = (message) => messages.forEach((cb) => cb(message));
        if (request.type === 'ping') {
          send({ type: 'pong', clis: { claude: null, codex: null, grok: { version: 'fake' } } });
          return;
        }
        if (request.type !== 'rewrite' || request.cli !== 'grok' || request.model !== '') {
          throw new Error('Expected a default-model Grok rewrite');
        }
        send({ type: 'model', model: 'grok-4.7' });
        send({ type: 'model', model: 'grok-4.7' });
        send({ type: 'chunk', text: 'This is a test sentence.' });
        send({ type: 'done' });
      });
    },
  };
};
`;

test('Grok default requests show the reported model and preserve unknown history', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'localpolish-grok-usage-'));
  let extension: Awaited<ReturnType<typeof launchExtension>> | undefined;
  try {
    const dist = path.join(temporary, 'dist');
    fs.cpSync(fileURLToPath(new URL('../../dist', import.meta.url)), dist, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8')) as {
      background: { service_worker: string };
    };
    const workerPath = path.join(dist, manifest.background.service_worker);
    fs.writeFileSync(workerPath, NATIVE_STUB + fs.readFileSync(workerPath, 'utf8'));
    const launched = await launchExtension(dist);
    extension = launched;
    await expect.poll(() => extensionWorker(launched.context)?.url() ?? '').toContain(EXTENSION_ID);
    const worker = extensionWorker(launched.context);
    if (!worker) throw new Error('No extension worker');
    await worker.evaluate(`chrome.storage.local.set({
      settings: { provider: 'grok-cli', models: { 'grok-cli': '' }, idleFix: false },
      usage: [
        { provider: 'codex-cli', model: 'gpt-6-luna', requests: 16 },
        { provider: 'claude-cli', model: 'haiku', requests: 13 },
        { provider: 'grok-cli', model: '', requests: 9 }
      ]
    })`);
    const page = await launched.context.newPage();
    await page.goto(`chrome-extension://${EXTENSION_ID}/options.html`);
    const run = page.getByRole('button', { name: 'Test connection' });
    await run.click();
    await expect(page.getByText('Works. Got', { exact: false })).toBeVisible();
    await expect(page.getByRole('row', { name: 'grok-4.7 Grok CLI 1', exact: true })).toBeVisible();
    await expect(page.getByRole('row', { name: 'Unknown (CLI default) Grok CLI 9' })).toBeVisible();
    await expect(page.getByRole('row', { name: 'Total 39', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('row', { name: 'grok-4.7 Grok CLI 1', exact: true })).toBeVisible();
    await run.click();
    await expect(page.getByRole('row', { name: 'grok-4.7 Grok CLI 2', exact: true })).toBeVisible();
    await expect(page.getByRole('row', { name: 'Total 40', exact: true })).toBeVisible();
  } finally {
    try {
      await extension?.close();
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
});
