import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createDecoder, encodeMessage } from './lib.mjs';

const hostPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'host.mjs');
const dirs = [];
/** @type {import('node:child_process').ChildProcess[]} */
const hosts = [];
/** @type {number[]} */
const pids = [];

afterEach(() => {
  for (const host of hosts) {
    if (host.exitCode === null && host.signalCode === null) host.kill('SIGKILL');
  }
  hosts.length = 0;
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  pids.length = 0;
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/**
 * @param {string} binDir
 * @param {string} name
 * @param {string} body
 */
function writeCli(binDir, name, body) {
  fs.writeFileSync(path.join(binDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  const file = path.join(binDir, name);
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
}

/**
 * @param {string} binDir
 * @param {number} closeMs
 */
function startHost(binDir, closeMs = 5000, home = process.env.HOME) {
  const child = spawn(process.execPath, [hostPath], {
    env: {
      ...process.env,
      HOME: home,
      PATH: `${binDir}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  hosts.push(child);
  /** @type {unknown[]} */
  const messages = [];
  /** @type {Buffer[]} */
  const stderr = [];
  child.stdout.on(
    'data',
    createDecoder((message) => messages.push(message)),
  );
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const closed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`host did not exit\n${Buffer.concat(stderr).toString('utf8')}`));
    }, closeMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  return { child, messages, closed };
}

function rewrite(cli, user) {
  return encodeMessage({ type: 'rewrite', cli, model: 'm1', system: 'S', user });
}

describe('host', () => {
  it('streams claude text deltas and then done', async () => {
    const bin = tempDir('lp-bin-');
    writeCli(
      bin,
      'claude',
      `#!/usr/bin/env node
const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  const text = Buffer.concat(chunks).toString('utf8');
  const send = (piece) =>
    JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: piece } },
    }) + '\\n';
  process.stdout.write(send('echo:') + send(text) + send('!'), () => process.exit(0));
});
`,
    );
    const host = startHost(bin);
    host.child.stdin.write(rewrite('claude', 'hello'));
    const code = await host.closed;
    expect(code).toBe(0);
    expect(host.messages).toEqual([
      { type: 'chunk', text: 'echo:' },
      { type: 'chunk', text: 'hello' },
      { type: 'chunk', text: '!' },
      { type: 'done' },
    ]);
  });

  it('kills the cli when Chrome closes stdin', async () => {
    const bin = tempDir('lp-bin-');
    const pidFile = path.join(bin, 'pid');
    writeCli(
      bin,
      'claude',
      `#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setTimeout(() => {}, 30000);
`,
    );
    const host = startHost(bin, 4000);
    host.child.stdin.write(rewrite('claude', 'hello'));
    const pid = await waitForPid(pidFile);
    pids.push(pid);
    const started = Date.now();
    host.child.stdin.end();
    await host.closed;
    expect(Date.now() - started).toBeLessThan(3000);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('reports stderr when the cli exits with an error', async () => {
    const bin = tempDir('lp-bin-');
    writeCli(
      bin,
      'claude',
      `#!/usr/bin/env node
process.stderr.write('not logged in\\n', () => process.exit(1));
`,
    );
    const host = startHost(bin);
    host.child.stdin.write(rewrite('claude', 'hello'));
    await host.closed;
    expect(host.messages).toHaveLength(1);
    expect(host.messages[0]).toMatchObject({ type: 'error' });
    expect(/** @type {{ message: string }} */ (host.messages[0]).message).toContain(
      'not logged in',
    );
  });

  it('asks for a LocalPolish codex login when the codex home has none', async () => {
    const bin = tempDir('lp-bin-');
    writeCli(bin, 'codex', '#!/bin/sh\nexit 0\n');
    const host = startHost(bin, 5000, tempDir('lp-home-'));
    host.child.stdin.write(rewrite('codex', 'hello'));
    await host.closed;
    expect(host.messages).toHaveLength(1);
    expect(/** @type {{ message: string }} */ (host.messages[0]).message).toContain(
      'codex-home" codex login',
    );
  });

  it('runs codex with the LocalPolish codex home', async () => {
    const bin = tempDir('lp-bin-');
    const home = tempDir('lp-home-');
    const codexHome = path.join(
      home,
      'Library',
      'Application Support',
      'LocalPolish',
      'codex-home',
    );
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(path.join(codexHome, 'auth.json'), '{}');
    writeCli(
      bin,
      'codex',
      `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on('end', () => {
  const item = { type: 'agent_message', text: process.env.CODEX_HOME };
  process.stdout.write(JSON.stringify({ type: 'item.completed', item }) + '\\n', () => process.exit(0));
});
`,
    );
    const host = startHost(bin, 5000, home);
    host.child.stdin.write(rewrite('codex', 'hello'));
    await host.closed;
    expect(host.messages).toEqual([{ type: 'chunk', text: codexHome }, { type: 'done' }]);
  });

  it('reports a missing codex cli', async () => {
    const bin = tempDir('lp-bin-');
    const host = startHost(bin);
    host.child.stdin.write(rewrite('codex', 'hello'));
    await host.closed;
    expect(host.messages).toHaveLength(1);
    expect(/** @type {{ message: string }} */ (host.messages[0]).message).toContain(
      'codex CLI not found',
    );
  });

  it('rejects an unknown request', async () => {
    const bin = tempDir('lp-bin-');
    const host = startHost(bin);
    host.child.stdin.write(encodeMessage({ type: 'nope' }));
    const code = await host.closed;
    expect(code).toBe(0);
    expect(host.messages).toEqual([{ type: 'error', message: 'Unknown request.' }]);
  });

  it('answers ping with the claude version', async () => {
    const bin = tempDir('lp-bin-');
    writeCli(
      bin,
      'claude',
      `#!/usr/bin/env node
if (process.argv.includes('--version')) {
  process.stdout.write('9.9.9 (Claude Code)\\n', () => process.exit(0));
} else {
  process.exit(0);
}
`,
    );
    const host = startHost(bin);
    host.child.stdin.write(encodeMessage({ type: 'ping' }));
    const code = await host.closed;
    expect(code).toBe(0);
    expect(host.messages).toEqual([
      {
        type: 'pong',
        clis: {
          claude: { version: '9.9.9 (Claude Code)' },
          codex: null,
          grok: null,
        },
      },
    ]);
  });
});

/**
 * @param {string} file
 * @returns {Promise<number>}
 */
async function waitForPid(file) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      const pid = Number(fs.readFileSync(file, 'utf8'));
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`pid file missing: ${file}`);
}
