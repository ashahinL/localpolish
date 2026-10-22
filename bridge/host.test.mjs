import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_CLI_EVENT_BYTES, MAX_NATIVE_FRAME_BYTES } from './constants.mjs';
import { agyHomeFor, agyLoginCommand, codexHomeFor, createDecoder, encodeMessage } from './lib.mjs';

const windows = process.platform === 'win32';
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
  if (windows) {
    fs.writeFileSync(path.join(binDir, `${name}.js`), body);
    const shim = ['@ECHO off', 'SETLOCAL', 'SET dp0=%~dp0', `"node" "%dp0%\\${name}.js" %*`, ''];
    fs.writeFileSync(path.join(binDir, `${name}.cmd`), shim.join('\r\n'));
    return;
  }
  if (!fs.existsSync(path.join(binDir, 'node'))) {
    fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
  }
  const file = path.join(binDir, name);
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
}

/**
 * @param {string} binDir
 * @param {number} closeMs
 */
function startHost(binDir, closeMs = 5000, home = tempDir('lp-home-')) {
  const hostTemp = tempDir('lp-host-temp-');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'),
  );
  const child = spawn(process.execPath, [hostPath], {
    env: {
      ...env,
      HOME: home,
      USERPROFILE: home,
      PATH: binDir,
      TMPDIR: hostTemp,
      TMP: hostTemp,
      TEMP: hostTemp,
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
  return { child, messages, closed, hostTemp, stderr };
}

function rewrite(cli, user) {
  return encodeMessage({ type: 'rewrite', cli, model: 'm1', system: 'S', user });
}

const writeBytesSource = `
async function writeBytes(count) {
  const chunk = Buffer.alloc(16384, 120);
  while (count > 0) {
    const size = Math.min(count, chunk.length);
    if (!process.stdout.write(chunk.subarray(0, size))) {
      await new Promise((resolve) => process.stdout.once('drain', resolve));
    }
    count -= size;
  }
}
`;

const writeTextEventsSource = `
async function writeTextEvents(chunks) {
  for (const text of chunks) {
    const event = { type: 'stream_event', event: {
      type: 'content_block_delta', delta: { type: 'text_delta', text }
    } };
    if (!process.stdout.write(JSON.stringify(event) + '\\n')) {
      await new Promise((resolve) => process.stdout.once('drain', resolve));
    }
  }
}
`;

describe('host total output limit', () => {
  it.each([
    { script: 'ASCII', unit: 'a', unitBytes: 1, extra: 0 },
    { script: 'ASCII', unit: 'a', unitBytes: 1, extra: 1 },
    { script: 'Arabic', unit: 'م', unitBytes: 2, extra: 0 },
    { script: 'Arabic', unit: 'م', unitBytes: 2, extra: 1 },
    { script: 'emoji', unit: '😀', unitBytes: 4, extra: 0 },
    { script: 'emoji', unit: '😀', unitBytes: 4, extra: 1 },
    { script: 'split emoji', unit: 'a', unitBytes: 1, extra: 0, split: true },
    { script: 'split emoji', unit: 'a', unitBytes: 1, extra: 1, split: true },
    {
      script: 'split emoji with empty events',
      unit: 'a',
      unitBytes: 1,
      extra: 0,
      split: true,
      empty: true,
    },
    {
      script: 'split emoji with empty events',
      unit: 'a',
      unitBytes: 1,
      extra: 1,
      split: true,
      empty: true,
    },
  ])(
    'bounds many $script events at 1048576 + $extra bytes',
    async ({ unit, unitBytes, extra, split, empty }) => {
      const bin = tempDir('lp-bin-');
      const pidFile = path.join(bin, 'pid');
      const block = unit.repeat(1024 / unitBytes);
      const tail = split
        ? ['a'.repeat(1020 + extra), '\ud83d', ...(empty ? ['', ''] : []), '\ude00']
        : extra
          ? ['a']
          : [];
      const chunks = [...Array(split ? 1023 : 1024).fill(block), ...tail];
      writeCli(
        bin,
        'claude',
        `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
${writeTextEventsSource}
process.stdin.resume();
process.stdin.on('end', async () => {
  await writeTextEvents([...Array(${split ? 1023 : 1024}).fill(${JSON.stringify(block)}), ...${JSON.stringify(tail)}]);
  process.stdout.write(JSON.stringify({ type: 'result' }) + '\\n');
  setInterval(() => {}, 1000);
});
`,
      );
      const host = startHost(bin);
      host.child.stdin.write(rewrite('claude', 'hello'));
      const pid = await waitForPid(pidFile);
      pids.push(pid);
      expect(await host.closed).toBe(0);
      expect(host.messages).toEqual([
        ...(extra ? chunks.slice(0, -1) : chunks).map((text) => ({ type: 'chunk', text })),
        extra
          ? {
              type: 'error',
              message:
                'The generated text is over the 1 MiB output limit. Try again with a shorter text.',
            }
          : { type: 'done' },
      ]);
      if (!extra) {
        expect(
          host.messages
            .filter((message) => message.type === 'chunk')
            .map((message) => message.text)
            .join(''),
        ).toBe(split ? 'a'.repeat(1048572) + '😀' : unit.repeat(1048576 / unitBytes));
      }
      expect(() => process.kill(pid, 0)).toThrow();
      expect(fs.readdirSync(host.hostTemp)).toEqual([]);
      expect(Buffer.concat(host.stderr).toString()).toBe('');
    },
  );
});

function oversizedHeader() {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(MAX_NATIVE_FRAME_BYTES + 1);
  return header;
}

function invalidJsonFrame() {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(4);
  return Buffer.concat([header, Buffer.from('{bad')]);
}

describe('host frame and CLI line limits', () => {
  it.each(['oversized header', 'malformed JSON', 'unknown request followed by bad header'])(
    'returns one framed error for initial %s without starting a CLI',
    async (failure) => {
      const bin = tempDir('lp-bin-');
      const marker = path.join(bin, 'started');
      writeCli(
        bin,
        'claude',
        `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(marker)}, 'started');
`,
      );
      const host = startHost(bin);
      const bad =
        failure === 'unknown request followed by bad header'
          ? Buffer.concat([encodeMessage({ type: 'unknown' }), oversizedHeader()])
          : failure === 'oversized header'
            ? oversizedHeader()
            : invalidJsonFrame();
      // More bytes after the failure must not start the valid request or send another error.
      host.child.stdin.write(Buffer.concat([bad, bad, rewrite('claude', 'hello')]));
      expect(await host.closed).toBe(0);
      expect(host.messages).toEqual([{ type: 'error', message: expect.any(String) }]);
      if (failure === 'oversized header') {
        expect(host.messages[0].message).toBe('Native JSON payload exceeds the 8 MiB limit.');
      }
      if (failure === 'unknown request followed by bad header') {
        expect(host.messages[0].message).toBe('Unknown request.');
      }
      expect(fs.existsSync(marker)).toBe(false);
      expect(fs.readdirSync(host.hostTemp)).toEqual([]);
      expect(Buffer.concat(host.stderr).toString()).toBe('');
    },
  );

  it.each(['LF', 'CRLF', 'EOF'])(
    'accepts an exact-cap CLI event ending with %s',
    async (ending) => {
      const bin = tempDir('lp-bin-');
      const prefix =
        '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}},"padding":"';
      const suffix = '"}';
      const padding = MAX_CLI_EVENT_BYTES - Buffer.byteLength(prefix + suffix);
      writeCli(
        bin,
        'claude',
        `#!/usr/bin/env node
${writeBytesSource}
process.stdin.resume();
process.stdin.on('end', async () => {
  process.stdout.write(${JSON.stringify(prefix)});
  await writeBytes(${padding});
  process.stdout.write(${JSON.stringify(suffix)});
  ${ending === 'EOF' ? 'process.stdout.end();' : `process.stdout.write(${JSON.stringify(ending === 'LF' ? '\n' : '\r\n')});`}
});
`,
      );
      const host = startHost(bin);
      host.child.stdin.write(rewrite('claude', 'hello'));
      expect(await host.closed).toBe(0);
      expect(host.messages).toEqual([{ type: 'chunk', text: 'ok' }, { type: 'done' }]);
      expect(fs.readdirSync(host.hostTemp)).toEqual([]);
      expect(Buffer.concat(host.stderr).toString()).toBe('');
    },
  );

  it('rejects a line one byte over the cap without a newline and cleans up', async () => {
    const bin = tempDir('lp-bin-');
    const pidFile = path.join(bin, 'pid');
    writeCli(
      bin,
      'claude',
      `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
${writeBytesSource}
process.stdin.resume();
process.stdin.on('end', async () => {
  await writeBytes(${MAX_CLI_EVENT_BYTES + 1});
  setInterval(() => {}, 1000);
});
`,
    );
    const host = startHost(bin);
    host.child.stdin.write(rewrite('claude', 'hello'));
    const pid = await waitForPid(pidFile);
    pids.push(pid);
    expect(await host.closed).toBe(0);
    expect(host.messages).toEqual([
      { type: 'error', message: 'CLI event line exceeds the 8 MiB limit.' },
    ]);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(fs.readdirSync(host.hostTemp)).toEqual([]);
    expect(Buffer.concat(host.stderr).toString()).toBe('');
  });

  it('preserves split UTF-8, CR, split CRLF, multiple lines and JSON at EOF', async () => {
    const bin = tempDir('lp-bin-');
    const event = (text) =>
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text },
        },
      });
    const first = Buffer.from(event('م😀'));
    const split = first.indexOf(Buffer.from('😀')) + 2;
    const pieces = [
      first.subarray(0, split),
      first.subarray(split),
      Buffer.from('\r'),
      Buffer.from('\n' + event('second') + '\r' + event('third') + '\n' + event('EOF')),
    ];
    writeCli(
      bin,
      'claude',
      `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on('end', async () => {
  for (const bytes of ${JSON.stringify(pieces.map((piece) => [...piece]))}) {
    process.stdout.write(Buffer.from(bytes));
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  process.stdout.end();
});
`,
    );
    const host = startHost(bin);
    host.child.stdin.write(rewrite('claude', 'hello'));
    expect(await host.closed).toBe(0);
    expect(host.messages).toEqual(
      ['م😀', 'second', 'third', 'EOF']
        .map((text) => ({ type: 'chunk', text }))
        .concat({ type: 'done' }),
    );
    expect(fs.readdirSync(host.hostTemp)).toEqual([]);
  });

  it('keeps a valid final event ahead of oversized trailing garbage', async () => {
    const bin = tempDir('lp-bin-');
    writeCli(
      bin,
      'claude',
      `#!/usr/bin/env node
${writeBytesSource}
process.stdin.resume();
process.stdin.on('end', async () => {
  process.stdout.write('{"type":"result"}\\n' + 'x'.repeat(16384));
  await writeBytes(${MAX_CLI_EVENT_BYTES + 1});
});
`,
    );
    const host = startHost(bin);
    host.child.stdin.write(rewrite('claude', 'hello'));
    expect(await host.closed).toBe(0);
    expect(host.messages).toEqual([{ type: 'done' }]);
    expect(fs.readdirSync(host.hostTemp)).toEqual([]);
    expect(Buffer.concat(host.stderr).toString()).toBe('');
  });
});

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

  it('sends done at the end_turn stop and stops a cli that keeps running', async () => {
    const bin = tempDir('lp-bin-');
    const pidFile = path.join(bin, 'pid');
    writeCli(
      bin,
      'claude',
      `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
process.stdin.resume();
process.stdin.on('end', () => {
  const delta = { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Fixed.' } };
  process.stdout.write(JSON.stringify({ type: 'stream_event', event: delta }) + '\\n');
  const stop = { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
  process.stdout.write(JSON.stringify({ type: 'stream_event', event: stop }) + '\\n');
  setTimeout(() => {}, 30000);
});
`,
    );
    const host = startHost(bin, 4000);
    const started = Date.now();
    host.child.stdin.write(rewrite('claude', 'hello'));
    const pid = await waitForPid(pidFile);
    pids.push(pid);
    await host.closed;
    expect(Date.now() - started).toBeLessThan(3000);
    expect(host.messages).toEqual([{ type: 'chunk', text: 'Fixed.' }, { type: 'done' }]);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('forwards a grok init model and then the answer', async () => {
    const bin = tempDir('lp-bin-');
    writeCli(
      bin,
      'grok',
      `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on('end', () => {
  const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
  send({ type: 'system', subtype: 'init', model: 'grok-4.7' });
  const delta = { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Fixed.' } };
  send({ type: 'stream_event', event: delta });
  const stop = { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
  send({ type: 'stream_event', event: stop });
});
`,
    );
    const host = startHost(bin);
    host.child.stdin.write(rewrite('grok', 'hello'));
    expect(await host.closed).toBe(0);
    expect(host.messages).toEqual([
      { type: 'model', model: 'grok-4.7' },
      { type: 'chunk', text: 'Fixed.' },
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

  it
    .skipIf(windows)
    .each([
      'disconnect',
      'malformed frame',
      'oversized header',
      'CLI overflow',
      'total output overflow',
    ])('kills a resistant grandchild and removes the temp directory after %s', async (failure) => {
    const bin = tempDir('lp-bin-');
    const pidFile = path.join(bin, 'pid');
    const script = `
process.on('SIGTERM', () => {});
require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 1000);
`;
    writeCli(
      bin,
      'claude',
      `#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
${writeBytesSource}
${writeTextEventsSource}
spawn(process.execPath, ['-e', ${JSON.stringify(script)}], { stdio: 'ignore' });
const ready = setInterval(() => {
  if (fs.existsSync(${JSON.stringify(pidFile)})) {
    clearInterval(ready);
    ${failure === 'CLI overflow' ? `writeBytes(${MAX_CLI_EVENT_BYTES + 1});` : ''}
    ${failure === 'total output overflow' ? `writeTextEvents([...Array(1024).fill('a'.repeat(1024)), 'a']);` : ''}
    setInterval(() => {}, 1000);
  }
}, 20);
`,
    );
    const host = startHost(bin, 4000);
    host.child.stdin.write(rewrite('claude', 'hello'));
    const pid = await waitForPid(pidFile);
    pids.push(pid);
    if (failure === 'disconnect') host.child.stdin.end();
    if (failure === 'malformed frame') {
      host.child.stdin.write(invalidJsonFrame());
    }
    if (failure === 'oversized header') {
      host.child.stdin.write(oversizedHeader());
    }
    await host.closed;
    expect(fs.readdirSync(host.hostTemp)).toEqual([]);
    expect(Buffer.concat(host.stderr).toString()).toBe('');
    if (failure === 'disconnect') expect(host.messages).toEqual([]);
    else {
      if (failure !== 'total output overflow') {
        expect(host.messages).toEqual([{ type: 'error', message: expect.any(String) }]);
      }
      const terminals = host.messages.filter((message) => message.type !== 'chunk');
      expect(terminals).toEqual([{ type: 'error', message: expect.any(String) }]);
      if (failure === 'total output overflow') {
        expect(terminals[0].message).toBe(
          'The generated text is over the 1 MiB output limit. Try again with a shorter text.',
        );
        expect(
          host.messages
            .filter((message) => message.type === 'chunk')
            .map((message) => message.text)
            .join(''),
        ).toBe('a'.repeat(1048576));
      }
      if (failure !== 'malformed frame') {
        expect(terminals[0].message).toContain(
          failure === 'total output overflow' ? '1 MiB output limit' : '8 MiB limit',
        );
      }
    }
    await expect
      .poll(
        () => {
          try {
            process.kill(pid, 0);
            return 'alive';
          } catch (err) {
            return err.code;
          }
        },
        { timeout: 3000 },
      )
      .toBe('ESRCH');
  });

  it.runIf(process.platform === 'win32')(
    'kills a grandchild on Windows when Chrome closes stdin',
    async () => {
      const bin = tempDir('lp-bin-');
      const pidFile = path.join(bin, 'pid');
      const script = `
require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 1000);
`;
      writeCli(
        bin,
        'claude',
        `#!/usr/bin/env node
const { spawn } = require('child_process');
spawn(process.execPath, ['-e', ${JSON.stringify(script)}], { stdio: 'ignore' });
setInterval(() => {}, 1000);
`,
      );
      const host = startHost(bin, 4000);
      host.child.stdin.write(rewrite('claude', 'hello'));
      const pid = await waitForPid(pidFile);
      pids.push(pid);
      host.child.stdin.end();
      await host.closed;
      await expect
        .poll(
          () => {
            try {
              process.kill(pid, 0);
              return 'alive';
            } catch (err) {
              return err.code;
            }
          },
          { timeout: 5000 },
        )
        .toBe('ESRCH');
    },
    10000,
  );

  it.skipIf(windows)('kills the processes the cli started', async () => {
    const bin = tempDir('lp-bin-');
    const pidFile = path.join(bin, 'pid');
    writeCli(
      bin,
      'claude',
      `#!/usr/bin/env node
const { spawn } = require('child_process');
const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
setTimeout(() => {}, 30000);
`,
    );
    const host = startHost(bin, 4000);
    host.child.stdin.write(rewrite('claude', 'hello'));
    const pid = await waitForPid(pidFile);
    pids.push(pid);
    host.child.stdin.end();
    await host.closed;
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0);
          return 'alive';
        } catch {
          return 'gone';
        }
      })
      .toBe('gone');
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
    expect(/** @type {{ message: string }} */ (host.messages[0]).message).toMatch(
      windows
        ? /\$env:CODEX_HOME=".*codex-home"; mkdir -Force \$env:CODEX_HOME \| Out-Null; codex login$/
        : /mkdir -p ".*codex-home" && CODEX_HOME=".*codex-home" codex login$/,
    );
  });

  it('runs codex with the LocalPolish codex home', async () => {
    const bin = tempDir('lp-bin-');
    const home = tempDir('lp-home-');
    const codexHome = windows
      ? path.join(home, 'AppData', 'Local', 'LocalPolish', 'codex-home')
      : path.join(home, 'Library', 'Application Support', 'LocalPolish', 'codex-home');
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

  it('uses a temporary tool-free catalog and preserves the selected model and original cache', async () => {
    const bin = tempDir('lp-bin-');
    const home = tempDir('lp-home-');
    const codexHome = codexHomeFor(home);
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(path.join(codexHome, 'auth.json'), '{}');
    const cache = {
      fetched_at: new Date().toISOString(),
      models: [
        { slug: 'other' },
        {
          slug: 'm1',
          context_window: 1000000,
          supported_reasoning_levels: [{ effort: 'medium' }],
          tool_mode: 'code_mode_only',
          apply_patch_tool_type: 'freeform',
          experimental_supported_tools: ['clock'],
        },
      ],
    };
    const cachePath = path.join(codexHome, 'models_cache.json');
    fs.writeFileSync(cachePath, JSON.stringify(cache));
    writeCli(
      bin,
      'codex',
      `#!/usr/bin/env node
const fs = require('node:fs');
process.stdin.resume();
process.stdin.on('end', () => {
  const option = process.argv.find((arg) => arg.startsWith('model_catalog_json='));
  const file = JSON.parse(option.slice('model_catalog_json='.length));
  const text = JSON.stringify({ file, catalog: JSON.parse(fs.readFileSync(file, 'utf8')) });
  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: {} }) + '\\n');
});
`,
    );
    const host = startHost(bin, 5000, home);
    host.child.stdin.write(rewrite('codex', 'hello'));
    await host.closed;
    expect(host.messages).toHaveLength(2);
    expect(host.messages[0]).toMatchObject({ type: 'chunk' });
    const { file, catalog } = JSON.parse(host.messages[0].text);
    expect(catalog).toEqual({
      models: [
        {
          slug: 'm1',
          context_window: 1000000,
          supported_reasoning_levels: [{ effort: 'medium' }],
          tool_mode: null,
          apply_patch_tool_type: null,
          experimental_supported_tools: [],
        },
      ],
    });
    expect(fs.readFileSync(cachePath, 'utf8')).toBe(JSON.stringify(cache));
    expect(fs.existsSync(file)).toBe(false);
    expect(host.messages[1]).toEqual({ type: 'done' });
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

  it.each(['all finish', 'codex hangs'])(
    'starts all version probes together when %s',
    async (mode) => {
      const bin = tempDir('lp-bin-');
      const log = path.join(bin, 'versions.jsonl');
      const deadline = path.join(bin, 'version-deadline');
      for (const name of ['claude', 'codex', 'grok']) {
        writeCli(
          bin,
          name,
          `#!/usr/bin/env node
const fs = require('fs');
const log = (phase) => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ name: ${JSON.stringify(name)}, phase, at: Date.now(), pid: process.pid, args: process.argv.slice(2) }) + '\\n');
log('start');
${mode === 'codex hangs' && name === 'codex' ? 'setInterval(() => {}, 1000);' : `setTimeout(() => { log('finish'); process.stdout.write('${name} 1.2.3\\n'); }, Math.max(0, Number(fs.readFileSync(${JSON.stringify(deadline)}, 'utf8')) - Date.now()));`}
`,
        );
      }
      const host = startHost(bin, 9500);
      const started = performance.now();
      // Include interpreter startup in the fake command's four-second response delay.
      fs.writeFileSync(deadline, String(Date.now() + 4000));
      host.child.stdin.write(encodeMessage({ type: 'ping' }));
      try {
        expect(await host.closed).toBe(0);
      } finally {
        if (fs.existsSync(log)) {
          for (const event of fs
            .readFileSync(log, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))) {
            if (event.phase === 'start') pids.push(event.pid);
          }
        }
      }
      expect(performance.now() - started).toBeLessThan(10_000);
      const events = fs
        .readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events.slice(0, 3).map((event) => event.phase)).toEqual(['start', 'start', 'start']);
      expect(events.filter((event) => event.phase === 'start').map((event) => event.args)).toEqual([
        ['--version'],
        ['--version'],
        ['--version'],
      ]);
      expect(host.messages, JSON.stringify(events)).toEqual([
        {
          type: 'pong',
          clis: {
            claude: { version: 'claude 1.2.3' },
            codex: { version: mode === 'codex hangs' ? '' : 'codex 1.2.3' },
            grok: { version: 'grok 1.2.3' },
            agy: null,
          },
        },
      ]);
      for (const event of events.filter((event) => event.phase === 'start')) {
        expect(() => process.kill(event.pid, 0)).toThrow();
      }
      expect(fs.readdirSync(host.hostTemp)).toEqual([]);
      expect(Buffer.concat(host.stderr).toString()).toBe('');
    },
    12_000,
  );

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
          agy: null,
        },
      },
    ]);
  });
});

const LIMIT_MESSAGE =
  'This text is over the 256 KiB limit, so it was not sent. Shorten it and try again.';

describe('host input limit', () => {
  it.each([
    { name: 'ASCII', unit: 'a', unitBytes: 1, delta: -1 },
    { name: 'ASCII', unit: 'a', unitBytes: 1, delta: 0 },
    { name: 'ASCII', unit: 'a', unitBytes: 1, delta: 1 },
    { name: 'Arabic', unit: 'م', unitBytes: 2, delta: -1 },
    { name: 'Arabic', unit: 'م', unitBytes: 2, delta: 0 },
    { name: 'Arabic', unit: 'م', unitBytes: 2, delta: 1 },
    { name: 'emoji', unit: '😀', unitBytes: 4, delta: -1 },
    { name: 'emoji', unit: '😀', unitBytes: 4, delta: 0 },
    { name: 'emoji', unit: '😀', unitBytes: 4, delta: 1 },
  ])(
    'claude keeps a framed $name prompt at raw delta $delta',
    async ({ unit, unitBytes, delta }) => {
      const targetBytes = 262144 + delta;
      const text =
        unit.repeat(Math.floor(targetBytes / unitBytes)) + 'a'.repeat(targetBytes % unitBytes);
      expect(Buffer.byteLength(unit)).toBe(unitBytes);
      expect(Buffer.byteLength(text)).toBe(262144 + delta);
      const prompt = `<text>\n${text}\n</text>`;
      expect(Buffer.byteLength(prompt)).toBe(Buffer.byteLength(text) + 15);

      const run = await runFramed('claude', prompt);
      if (delta <= 0) {
        expect(run.host.messages).toEqual([{ type: 'chunk', text: 'ok' }, { type: 'done' }]);
        expect(fs.readFileSync(run.stdinFile)).toEqual(Buffer.from(prompt, 'utf8'));
        expect(fs.readFileSync(run.marker, 'utf8')).toBe('started');
        return;
      }
      expect(run.host.messages).toEqual([{ type: 'error', message: LIMIT_MESSAGE }]);
      expect(fs.existsSync(run.marker)).toBe(false);
      expect(fs.existsSync(run.stdinFile)).toBe(false);
    },
  );

  it('accepts a direct prompt at the wrapped cap and rejects one byte over it', async () => {
    const exact = 'a'.repeat(262159);
    const over = 'b'.repeat(262160);
    expect(Buffer.byteLength(exact)).toBe(262159);
    expect(Buffer.byteLength(over)).toBe(262160);

    const allowed = await runFramed('claude', exact);
    expect(allowed.host.messages).toEqual([{ type: 'chunk', text: 'ok' }, { type: 'done' }]);
    expect(fs.readFileSync(allowed.stdinFile)).toEqual(Buffer.from(exact, 'utf8'));
    expect(fs.readFileSync(allowed.marker, 'utf8')).toBe('started');

    const rejected = await runFramed('claude', over);
    expect(rejected.host.messages).toEqual([{ type: 'error', message: LIMIT_MESSAGE }]);
    expect(fs.existsSync(rejected.marker)).toBe(false);
  });

  it('rejects an oversized Codex prompt before the login check', async () => {
    const prompt = `<text>\n${'a'.repeat(262145)}\n</text>`;
    expect(Buffer.byteLength(prompt)).toBe(262160);
    const run = await runFramed('codex', prompt);
    expect(run.host.messages).toEqual([{ type: 'error', message: LIMIT_MESSAGE }]);
    expect(fs.existsSync(run.marker)).toBe(false);
    expect(fs.existsSync(run.stdinFile)).toBe(false);
  });
});

/**
 * @param {string} cli
 * @param {string} user
 */
async function runFramed(cli, user) {
  const bin = tempDir('lp-bin-');
  const marker = path.join(bin, 'started');
  const stdinFile = path.join(bin, 'stdin.txt');
  writeCli(
    bin,
    cli,
    `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(marker)}, 'started');
const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(stdinFile)}, Buffer.concat(chunks));
  const send = (event) => JSON.stringify({ type: 'stream_event', event }) + '\\n';
  process.stdout.write(
    send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }) +
      send({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
    () => process.exit(0),
  );
});
`,
  );
  const host = startHost(bin, 5000, tempDir('lp-home-'));
  const frame = rewrite(cli, user);
  if (!host.child.stdin.write(frame)) {
    await new Promise((resolve) => host.child.stdin.once('drain', resolve));
  }
  await host.closed;
  return { host, marker, stdinFile };
}

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

describe('Antigravity host', () => {
  const id = '12345678-abcd-abcd-abcd-123456789abc';
  const agent =
    '---\nname: localpolish\ndescription: LocalPolish rewrite.\ntools: []\nmainAgent: true\nsubagent: false\n---\n\nS';

  function setup(body) {
    const bin = tempDir('lp-agy-bin-');
    const home = tempDir('lp-agy-home-');
    const agyHome = agyHomeFor(home);
    const saved = path.join(agyHome, '.gemini', 'antigravity-cli');
    writeCli(
      bin,
      'agy',
      `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const send = (event) => console.log(JSON.stringify(event));
const saved = path.join(process.env.HOME, '.gemini', 'antigravity-cli');
const id = ${JSON.stringify(id)};
const persist = () => {
  fs.mkdirSync(path.join(saved, 'conversations'), { recursive: true });
  fs.mkdirSync(path.join(saved, 'brain', id), { recursive: true });
  fs.writeFileSync(path.join(saved, 'conversations', id + '.db'), 'fake draft');
  fs.writeFileSync(path.join(saved, 'brain', id, 'draft'), 'fake draft');
  send({ event: 'init', conversation_id: id, init: { model: 'm1' } });
};
${body.replaceAll('AGY_HOME_EXPECTED', JSON.stringify(agyHome)).replaceAll('BIN_EXPECTED', JSON.stringify(bin))}
`,
    );
    return { host: startHost(bin, 5000, home), agyHome, saved, bin };
  }

  function expectDeleted(saved) {
    expect(fs.existsSync(path.join(saved, 'conversations', id + '.db'))).toBe(false);
    expect(fs.existsSync(path.join(saved, 'brain', id))).toBe(false);
  }

  it('passes one JSON user line and an isolated agent, streams and deletes the saved conversation', async () => {
    const { host, agyHome, saved } = setup(`
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => input += chunk);
process.stdin.on('end', () => {
  assert.equal(input, JSON.stringify({ event: 'user', message: { content: 'fake draft\\nsecond line' } }) + '\\n');
  assert.equal(process.env.HOME, AGY_HOME_EXPECTED);
  assert.equal(process.env.SSH_TTY, 'localpolish');
  assert.equal(fs.readFileSync('.agents/agents/localpolish.md', 'utf8'), ${JSON.stringify(agent)});
  persist();
  send({ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: 'Fixed.' } });
  send({ event: 'step_update', step_update: { step_type: 'agent_response', state: 'DONE', text_delta: '\\n' } });
  send({ event: 'result', result: { status: 'SUCCESS' } });
});
`);
    host.child.stdin.write(rewrite('agy', 'fake draft\nsecond line'));
    await host.closed;
    expect(host.messages).toEqual([
      { type: 'model', model: 'm1' },
      { type: 'chunk', text: 'Fixed.' },
      { type: 'chunk', text: '\n' },
      { type: 'done' },
    ]);
    expectDeleted(saved);
    expect(fs.existsSync(path.join(agyHome, '.agents'))).toBe(false);
    expect(fs.readdirSync(host.hostTemp)).toEqual([]);
  });

  it('kills a waiting login and returns the private login command', async () => {
    const { host, agyHome, saved, bin } = setup(`
persist();
fs.writeFileSync(path.join(BIN_EXPECTED, 'pid'), String(process.pid));
process.stderr.write('Authentication required');
setInterval(() => {}, 1000);
`);
    const start = Date.now();
    host.child.stdin.write(rewrite('agy', 'fake draft'));
    await host.closed;
    expect(Date.now() - start).toBeLessThan(3000);
    expect(host.messages.at(-1)).toEqual({
      type: 'error',
      message:
        'Antigravity needs its own login for LocalPolish. In a terminal run: ' +
        agyLoginCommand(agyHome),
    });
    expect(() => process.kill(Number(fs.readFileSync(path.join(bin, 'pid'), 'utf8')), 0)).toThrow();
    expectDeleted(saved);
  });

  it('returns an error status and still deletes the saved conversation', async () => {
    const { host, saved } = setup(`
persist();
send({ event: 'result', result: { status: 'ERROR', error: 'fake error' } });
`);
    host.child.stdin.write(rewrite('agy', 'fake draft'));
    await host.closed;
    expect(host.messages.at(-1)).toEqual({ type: 'error', message: 'fake error' });
    expectDeleted(saved);
  });

  it('cleans up on disconnect', async () => {
    const { host, saved, bin } = setup(`
persist();
fs.writeFileSync(path.join(BIN_EXPECTED, 'pid'), String(process.pid));
setInterval(() => {}, 1000);
`);
    host.child.stdin.write(rewrite('agy', 'fake draft'));
    pids.push(await waitForPid(path.join(bin, 'pid')));
    await expect.poll(() => host.messages).toContainEqual({ type: 'model', model: 'm1' });
    host.child.stdin.end();
    await host.closed;
    expectDeleted(saved);
  });

  it('cleans up after the rewrite timeout', async () => {
    const bin = tempDir('lp-agy-timeout-bin-');
    const home = tempDir('lp-agy-timeout-home-');
    const saved = path.join(agyHomeFor(home), '.gemini', 'antigravity-cli');
    writeCli(
      bin,
      'agy',
      `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const saved = ${JSON.stringify(saved)};
const id = ${JSON.stringify(id)};
fs.mkdirSync(path.join(saved, 'conversations'), { recursive: true });
fs.mkdirSync(path.join(saved, 'brain', id), { recursive: true });
fs.writeFileSync(path.join(saved, 'conversations', id + '.db'), 'fake draft');
fs.writeFileSync(path.join(saved, 'brain', id, 'draft'), 'fake draft');
console.log(JSON.stringify({ event: 'init', conversation_id: id, init: { model: 'm1' } }));
setInterval(() => {}, 1000);
`,
    );
    const host = startHost(bin, 65_000, home);
    host.child.stdin.write(rewrite('agy', 'fake draft'));
    await host.closed;
    expect(host.messages.at(-1)).toEqual({ type: 'error', message: 'Timed out after 60 seconds.' });
    expectDeleted(saved);
    expect(fs.readdirSync(host.hostTemp)).toEqual([]);
  }, 65_000);

  it.each(['../../x', '../../../../x'])(
    'ignores unsafe conversation id %s',
    async (conversation) => {
      const { host, agyHome } = setup(`
send({ event: 'init', conversation_id: ${JSON.stringify(conversation)}, init: { model: 'm1' } });
send({ event: 'result', result: { status: 'SUCCESS' } });
`);
      const outside = path.join(
        agyHome,
        '.gemini',
        'antigravity-cli',
        'conversations',
        conversation + '.db',
      );
      fs.mkdirSync(path.dirname(outside), { recursive: true });
      fs.writeFileSync(outside, 'keep');
      host.child.stdin.write(rewrite('agy', 'fake draft'));
      await host.closed;
      expect(host.messages.at(-1)).toEqual({ type: 'done' });
      expect(fs.readFileSync(outside, 'utf8')).toBe('keep');
    },
  );
});

describe('rewrite timeout', () => {
  it('rejects a timeout past the cap before starting a CLI', async () => {
    const bin = tempDir('lp-bin-');
    const marker = path.join(bin, 'started');
    writeCli(
      bin,
      'claude',
      `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(marker)}, 'started');
setInterval(() => {}, 1000);
`,
    );
    const host = startHost(bin, 3000);
    host.child.stdin.write(
      encodeMessage({
        type: 'rewrite',
        cli: 'claude',
        model: 'm1',
        system: 'S',
        user: 'hello',
        timeoutMs: 180_001,
      }),
    );
    await host.closed;
    expect(host.messages).toEqual([
      {
        type: 'error',
        message: 'timeoutMs must be a positive whole number of milliseconds up to 180000.',
      },
    ]);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('uses a short supplied timeout and cleans up', async () => {
    const bin = tempDir('lp-bin-');
    const pidFile = path.join(bin, 'pid');
    writeCli(
      bin,
      'claude',
      `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 1000);
`,
    );
    const host = startHost(bin, 8000);
    host.child.stdin.write(
      encodeMessage({
        type: 'rewrite',
        cli: 'claude',
        model: 'm1',
        system: 'S',
        user: 'hello',
        timeoutMs: 2000,
      }),
    );
    const pid = await waitForPid(pidFile);
    pids.push(pid);
    const code = await host.closed;
    expect(code).toBe(0);
    expect(host.messages).toEqual([{ type: 'error', message: 'Timed out after 2 seconds.' }]);
    expect(fs.readdirSync(host.hostTemp)).toEqual([]);
    expect(() => process.kill(pid, 0)).toThrow();
  }, 10_000);
});
