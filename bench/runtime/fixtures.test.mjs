import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { compile } from './compile.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'localpolish-runtime-fixture-test-'));
const load = compile(root, temp);
const { startMockOpenAI } = load('tests/e2e/mock-openai');
after(() => fs.rmSync(temp, { recursive: true, force: true }));

async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail('Mock stream state did not settle');
}

test('default mock preserves immediate SSE, captured body, auth and errors', async () => {
  const mock = await startMockOpenAI();
  try {
    const response = await fetch(mock.url, {
      method: 'POST',
      headers: { authorization: 'Bearer synthetic' },
      body: '{"model":"fake"}',
    });
    assert.equal(
      await response.text(),
      'data: {"choices":[{"delta":{"content":"I went"}}]}\n\ndata: {"choices":[{"delta":{"content":" home."}}]}\n\ndata: [DONE]\n\n',
    );
    assert.deepEqual(mock.requests, [
      { body: { model: 'fake' }, authorization: 'Bearer synthetic' },
    ]);
    await waitFor(() => mock.streams.active === 0);
    assert.deepEqual(mock.streams, { started: 1, active: 0, cancelled: 0, finished: 1 });
    mock.reply({ status: 500, body: 'synthetic failure' });
    const failure = await fetch(mock.url, { method: 'POST', body: '{}' });
    assert.equal(failure.status, 500);
    assert.equal(await failure.text(), 'synthetic failure');
    const options = await fetch(mock.url, { method: 'OPTIONS' });
    assert.equal(options.status, 204);
    assert.equal(mock.requests.length, 2);
  } finally {
    await mock.close();
  }
});

test('held stream records client cancellation and can be released normally', async () => {
  const mock = await startMockOpenAI();
  try {
    mock.reply({ chunks: ['Working'], hold: true });
    const abort = new AbortController();
    const response = await fetch(mock.url, { method: 'POST', body: '{}', signal: abort.signal });
    const reader = response.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /Working/);
    assert.equal(mock.streams.active, 1);
    abort.abort();
    await waitFor(() => mock.streams.cancelled === 1);
    assert.equal(mock.streams.active, 0);
    const second = await fetch(mock.url, { method: 'POST', body: '{}' });
    mock.releaseHeld();
    assert.match(await second.text(), /data: \[DONE\]/);
    await waitFor(() => mock.streams.finished === 1);
    assert.equal(mock.streams.active, 0);
  } finally {
    await mock.close();
  }
});

test('paced chunks retain order and finish without retained timers', async () => {
  const mock = await startMockOpenAI();
  try {
    mock.reply({ chunks: ['أ', '🌍', 'tail'], intervalMs: 5 });
    const response = await fetch(mock.url, { method: 'POST', body: '{}' });
    const body = await response.text();
    assert.equal(
      body,
      'data: {"choices":[{"delta":{"content":"أ"}}]}\n\ndata: {"choices":[{"delta":{"content":"🌍"}}]}\n\ndata: {"choices":[{"delta":{"content":"tail"}}]}\n\ndata: [DONE]\n\n',
    );
    await waitFor(() => mock.streams.active === 0);
    assert.equal(mock.streams.cancelled, 0);
  } finally {
    await mock.close();
  }
});

test(
  'macOS sandbox refuses extension launch before starting Chrome',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const launch = t.mock.method(chromium, 'launchPersistentContext', async () => {
      throw new Error('Unexpected Chrome launch');
    });
    const previous = process.env.CODEX_SANDBOX;
    process.env.CODEX_SANDBOX = 'seatbelt';
    try {
      const { launchExtension } = load('tests/e2e/extension-runtime');
      await assert.rejects(
        launchExtension('/unused-built-extension'),
        /cannot run in the macOS Codex sandbox/,
      );
      assert.equal(launch.mock.callCount(), 0);
    } finally {
      if (previous === undefined) delete process.env.CODEX_SANDBOX;
      else process.env.CODEX_SANDBOX = previous;
    }
  },
);
