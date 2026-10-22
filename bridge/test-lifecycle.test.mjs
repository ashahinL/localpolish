import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { TEST_PORT } from '../src/core/messages';
import { createDecoder, encodeMessage } from './lib.mjs';

const hostPath = fileURLToPath(new URL('./host.mjs', import.meta.url));
let fixtureDir;
let adapter;
let fakePid;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') return false;
    throw err;
  }
}

afterEach(async () => {
  try {
    if (adapter) {
      adapter.disconnect();
      const timer = setTimeout(() => adapter.child.kill('SIGKILL'), 3000);
      try {
        await adapter.closed;
      } finally {
        clearTimeout(timer);
      }
    }
    const pidFile = fixtureDir && path.join(fixtureDir, 'fake-cli.json');
    if (!fakePid && pidFile && fs.existsSync(pidFile)) {
      fakePid = JSON.parse(fs.readFileSync(pidFile, 'utf8')).pid;
    }
    if (fakePid && alive(fakePid)) {
      process.kill(fakePid, 'SIGKILL');
      await vi.waitFor(() => expect(alive(fakePid)).toBe(false));
    }
  } finally {
    vi.unstubAllGlobals();
    if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
    fixtureDir = undefined;
    adapter = undefined;
    fakePid = undefined;
  }
});

function nativeAdapter(env) {
  const child = spawn(process.execPath, [hostPath], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const messages = [];
  const listeners = [];
  const disconnects = [];
  const errors = [];
  let live = true;
  let disconnectCount = 0;
  const disconnect = () => {
    if (!live) return;
    live = false;
    disconnectCount++;
    child.stdin.end();
    disconnects.forEach((cb) => cb());
  };
  child.stdout.on(
    'data',
    createDecoder((message) => {
      messages.push(message);
      if (live) listeners.forEach((cb) => cb(message));
    }),
  );
  child.stderr.on('data', (chunk) => errors.push(chunk.toString()));
  child.stdin.on('error', (err) => errors.push(err.message));
  child.on('error', (err) => errors.push(err.message));
  const closed = new Promise((resolve) => child.once('close', resolve));
  child.on('close', disconnect);
  return {
    child,
    messages,
    errors,
    closed,
    disconnect,
    get disconnectCount() {
      return disconnectCount;
    },
    postMessage: (message) => child.stdin.write(encodeMessage(message)),
    onMessage: { addListener: (cb) => listeners.push(cb) },
    onDisconnect: { addListener: (cb) => disconnects.push(cb) },
  };
}

it('closing a test owner stops the real host and its fake CLI and removes the working directory', async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-test-owner-'));
  const bin = path.join(fixtureDir, 'bin');
  const home = path.join(fixtureDir, 'home');
  const hostTemp = path.join(fixtureDir, 'temp');
  for (const dir of [bin, home, hostTemp]) fs.mkdirSync(dir);
  const pidFile = path.join(fixtureDir, 'fake-cli.json');
  fs.writeFileSync(path.join(bin, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  const cli = `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify({ pid: process.pid, cwd: process.cwd() }));
process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ type: 'stream_event', event: {
    type: 'content_block_delta', delta: { type: 'text_delta', text: 'Held fake answer.' }
  } }) + '\\n');
  setInterval(() => {}, 1000);
});
`;
  if (process.platform === 'win32') {
    fs.copyFileSync(process.execPath, path.join(bin, 'node.exe'));
    fs.writeFileSync(path.join(bin, 'claude.js'), cli);
    fs.writeFileSync(
      path.join(bin, 'claude.cmd'),
      '@echo off\r\n"%~dp0node.exe" "%~dp0\\claude.js" %*\r\n',
    );
  } else {
    fs.symlinkSync(process.execPath, path.join(bin, 'node'));
    fs.writeFileSync(path.join(bin, 'claude'), cli, { mode: 0o755 });
  }
  const env = {
    HOME: home,
    USERPROFILE: home,
    PATH: bin,
    TMPDIR: hostTemp,
    TMP: hostTemp,
    TEMP: hostTemp,
    ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
  };
  let onConnect;
  const store = { settings: { provider: 'claude-cli', models: { 'claude-cli': 'fake-model' } } };
  const connectNative = vi.fn(() => {
    adapter = nativeAdapter(env);
    return adapter;
  });
  vi.stubGlobal('defineBackground', (start) => start());
  vi.stubGlobal('chrome', {
    runtime: {
      connectNative,
      onConnect: {
        addListener: (cb) => {
          onConnect = cb;
        },
      },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onMessage: { addListener: () => {} },
    },
    storage: {
      local: {
        setAccessLevel: async () => {},
        get: async (key) => ({ [key]: structuredClone(store[key]) }),
        set: async (items) => Object.assign(store, structuredClone(items)),
      },
      onChanged: { addListener: () => {} },
    },
    commands: { onCommand: { addListener: () => {} } },
  });
  await import('../src/entrypoints/background');
  let start;
  let closeOwner;
  const replies = [];
  onConnect({
    name: TEST_PORT,
    postMessage: (message) => replies.push(message),
    onMessage: {
      addListener: (cb) => {
        start = cb;
      },
    },
    onDisconnect: {
      addListener: (cb) => {
        closeOwner = cb;
      },
    },
  });
  start({ type: 'test-connection' });
  await vi.waitFor(
    () => {
      expect(connectNative).toHaveBeenCalledExactlyOnceWith('com.localpolish.bridge');
      expect(fs.existsSync(pidFile)).toBe(true);
    },
    { timeout: 4000 },
  );
  const fake = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
  fakePid = fake.pid;
  expect(alive(fakePid)).toBe(true);
  expect(fs.realpathSync(path.dirname(fake.cwd))).toBe(fs.realpathSync(hostTemp));
  await vi.waitFor(
    () => expect(adapter.messages).toContainEqual({ type: 'chunk', text: 'Held fake answer.' }),
    { timeout: 4000 },
  );
  expect(store.usage).toEqual([{ provider: 'claude-cli', model: 'fake-model', requests: 1 }]);

  closeOwner();
  expect(adapter.disconnectCount).toBe(1);
  expect(adapter.child.stdin.writableEnded).toBe(true);
  await adapter.closed;
  expect(alive(fakePid)).toBe(false);
  fakePid = undefined;
  expect(fs.readdirSync(hostTemp)).toEqual([]);
  expect(replies).toEqual([]);
  expect(adapter.errors).toEqual([]);
  expect(store.usage).toEqual([{ provider: 'claude-cli', model: 'fake-model', requests: 1 }]);
}, 10_000);
