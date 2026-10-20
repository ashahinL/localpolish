import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createDecoder, encodeMessage } from '../../bridge/lib.mjs';
import { compile } from './compile.mjs';
import { fragmentBytes, payload } from './fixtures.mjs';

export function coreSession(root, temp) {
  const load = compile(root, path.join(temp, 'compiled'));
  const { runRewrite } = load('src/background/rewrite');
  const { DEFAULT_SETTINGS } = load('src/core/settings');
  const { readSSE } = load('src/background/sse');
  const storage = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: storage[key] }),
        set: async (value) => Object.assign(storage, value),
      },
    },
  };
  return async (name) => {
    const start = performance.now();
    if (name.startsWith('rewrite-1000-')) {
      const counts = {};
      let output;
      const trigger = name.endsWith('-idle') ? 'idle' : undefined;
      await runRewrite(
        { text: 'synthetic draft only', mode: 'fix', tone: 'polite', trigger },
        DEFAULT_SETTINGS,
        async (_prompt, _settings, onText) => {
          for (let i = 0; i < 1000; i++) onText('x');
        },
        (event) => {
          counts[event.type] = (counts[event.type] ?? 0) + 1;
          if (event.type === 'done') output = event.text;
        },
        new AbortController().signal,
      );
      assert.equal(output, 'x'.repeat(1000));
      assert.equal(counts.done, 1);
      assert.ok(counts.chunk <= 1000);
      assert.equal(counts.error ?? 0, 0);
      return {
        ms: performance.now() - start,
        inputBytes: 20,
        chunks: 1000,
        counts,
        outputBytes: 1000,
      };
    }
    if (name === 'native-frame-1k') {
      const message = { type: 'rewrite', user: payload };
      const frame = encodeMessage(message);
      const received = [];
      const decode = createDecoder((message) => received.push(message));
      let copiedBytes = 0;
      let concatCalls = 0;
      let concatReturnedBytes = 0;
      let bufferCopyBytes = 0;
      let bufferCopyCalls = 0;
      const concat = Buffer.concat;
      const copy = Buffer.prototype.copy;
      Buffer.concat = function (buffers, ...args) {
        copiedBytes += buffers.reduce((total, buffer) => total + buffer.length, 0);
        concatCalls++;
        const result = Reflect.apply(concat, Buffer, [buffers, ...args]);
        concatReturnedBytes += result.length;
        return result;
      };
      Buffer.prototype.copy = function (...args) {
        const bytes = Reflect.apply(copy, this, args);
        bufferCopyBytes += bytes;
        bufferCopyCalls++;
        return bytes;
      };
      try {
        for (let at = 0; at < frame.length; at += fragmentBytes) {
          decode(frame.subarray(at, at + fragmentBytes));
        }
      } finally {
        Buffer.concat = concat;
        Buffer.prototype.copy = copy;
      }
      assert.deepEqual(received, [message]);
      return {
        ms: performance.now() - start,
        inputBytes: frame.length,
        fragmentBytes,
        received: received.length,
        concatCopiedBytes: copiedBytes,
        copyCountScope: 'Buffer.concat bytes only; initial Buffer.from copy excluded.',
        concatCalls,
        concatReturnedBytes,
        bufferCopyBytes,
        bufferCopyCalls,
        totalMeasuredCopyBytes: concatReturnedBytes + bufferCopyBytes,
        measuredCopyScope:
          'Decode only, after frame construction: Buffer.concat returned bytes plus Buffer.copy returned bytes, including header and payload copies. Other copying is excluded.',
      };
    }
    if (name === 'sse-1k') {
      // A pathological single line, split UTF-8, CRLF, then another event.
      const input = new TextEncoder().encode(`data: ${payload}\r\n\r\ndata: tail\n\n`);
      let at = 0;
      const stream = new ReadableStream({
        pull(controller) {
          if (at >= input.length) return controller.close();
          controller.enqueue(input.subarray(at, at + fragmentBytes));
          at += fragmentBytes;
        },
      });
      const events = [];
      for await (const event of readSSE(stream)) events.push(event);
      assert.deepEqual(events, [{ data: payload }, { data: 'tail' }]);
      return {
        ms: performance.now() - start,
        inputBytes: input.length,
        fragmentBytes,
        events: events.length,
        outputBytes: Buffer.byteLength(payload) + 4,
      };
    }
    if (name === 'host-ready-before-close') return hostProbe(root, temp);
    throw new Error(`Unknown core scenario: ${name}`);
  };
}

async function hostProbe(root, temp) {
  const bin = path.join(temp, 'bin');
  const home = path.join(temp, 'home');
  const hostTemp = path.join(temp, 'host-temp');
  for (const dir of [bin, home, hostTemp]) fs.mkdirSync(dir, { recursive: true });
  const log = path.join(temp, 'fake-calls.jsonl');
  fs.writeFileSync(log, '');
  const fake = path.join(bin, 'fake.cjs');
  fs.writeFileSync(
    fake,
    `const fs = require('node:fs');
const log = ${JSON.stringify(log)};
const record = (event) => fs.appendFileSync(log, JSON.stringify({event,pid:process.pid,at:Date.now(),args:process.argv.slice(2)})+'\\n');
record('start');
process.on('SIGTERM', () => { record('sigterm'); setTimeout(() => {record('exit');process.exit(0);}, 250); });
process.stdin.resume();
process.stdin.on('end', () => {
  console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'Synthetic answer.'}}}));
  record('completion');
  console.log(JSON.stringify({type:'stream_event',event:{type:'message_delta',delta:{stop_reason:'end_turn'}}}));
});
setInterval(() => {}, 1000);
`,
  );
  // resolveCommand follows a Node npm-style shim on Windows, and a shebang on POSIX.
  if (process.platform === 'win32') {
    fs.writeFileSync(
      path.join(bin, 'claude.cmd'),
      `@"${process.execPath}" "%~dp0\\fake.cjs" %*\r\n`,
    );
  } else {
    const cli = path.join(bin, 'claude');
    if (!fs.existsSync(path.join(bin, 'node')))
      fs.symlinkSync(process.execPath, path.join(bin, 'node'));
    fs.writeFileSync(cli, `#!/usr/bin/env node\n${fs.readFileSync(fake, 'utf8')}`, { mode: 0o755 });
  }
  const start = performance.now();
  const child = spawn(process.execPath, [path.join(root, 'bridge/host.mjs')], {
    env: {
      PATH: bin,
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: path.join(home, 'codex'),
      TMPDIR: hostTemp,
      TMP: hostTemp,
      TEMP: hostTemp,
      SystemRoot: process.env.SystemRoot,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  let readyMs;
  let aliveAtReady;
  const events = [];
  let stderr = '';
  child.stderr.on('data', (data) => (stderr += data));
  child.stdout.on(
    'data',
    createDecoder((event) => {
      events.push(event);
      if (event.type === 'done') {
        readyMs = performance.now() - start;
        // The fake delays exit after SIGTERM, so this checks the child too.
        const started = fs
          .readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map(JSON.parse)
          .find((event) => event.event === 'start');
        try {
          process.kill(started.pid, 0);
          aliveAtReady = true;
        } catch {
          aliveAtReady = false;
        }
      }
    }),
  );
  child.stdin.write(
    encodeMessage({ type: 'rewrite', cli: 'claude', user: 'synthetic draft', system: 'synthetic' }),
  );
  const disconnectTimeout = setTimeout(() => child.stdin.end(), 5000);
  let deadline;
  let result;
  let cleanupError;
  try {
    const exit = await Promise.race([
      closed,
      new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error('Fake host did not close in 9 seconds')),
          9000,
        );
      }),
    ]);
    const processCloseMs = performance.now() - start;
    assert.equal(exit[0], 0, stderr);
    assert.deepEqual(events, [{ type: 'chunk', text: 'Synthetic answer.' }, { type: 'done' }]);
    // taskkill /F on Windows can finish before the done frame reaches Node.
    if (process.platform !== 'win32') assert.equal(aliveAtReady, true);
    assert.ok(readyMs < processCloseMs);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.filter((call) => call.event === 'start').length, 1);
    assert.equal(calls.filter((call) => call.event === 'completion').length, 1);
    assert.deepEqual(fs.readdirSync(hostTemp), []);
    result = {
      readyMs,
      processCloseMs,
      aliveAtReady,
      processes: 2,
      processCountScope: 'Native host and fake rewrite CLI only; OS cleanup utilities excluded.',
      fakeExitBehavior:
        process.platform === 'win32'
          ? 'taskkill /F; liveness at ready is an observation'
          : '250ms graceful SIGTERM delay',
      events: events.length,
      fakeEvents: calls.map(({ event, args }) => ({ event, args })),
      hostTempClean: true,
      inputBytes: 15,
      outputBytes: 17,
    };
  } finally {
    clearTimeout(disconnectTimeout);
    clearTimeout(deadline);
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    const pid = lines.find((line) => line.event === 'start')?.pid;
    if (pid) {
      try {
        process.kill(process.platform === 'win32' ? pid : -pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') cleanupError = error;
      }
    }
    await closed;
  }
  if (cleanupError) throw cleanupError;
  return result;
}
