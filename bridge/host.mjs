#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  INPUT_LIMIT_MESSAGE,
  MAX_CLI_EVENT_BYTES,
  MAX_OUTPUT_BYTES,
  MAX_USER_PROMPT_BYTES,
  OUTPUT_LIMIT_MESSAGE,
  TIMEOUT_MS,
} from './constants.mjs';
import {
  buildCommand,
  codexHomeFor,
  codexLoginCommand,
  codexRewriteCatalog,
  createDecoder,
  encodeMessage,
  findOnPath,
  GROK_IMPORTS_OFF,
  parseLine,
  resolveCommand,
  splitText,
} from './lib.mjs';

const CLI_NAMES = ['claude', 'codex', 'grok'];
const KILL_AFTER_MS = 2000;
// Chrome drops a native message over 1 MB. JSON can grow a character to 6 bytes.
const CHUNK_CHARS = 100_000;

let started = false;
let exitReplySent = false;
/** @type {(() => void) | null} */
let onDisconnect = null;
/** @type {((message: { type: string, message: string }) => void) | null} */
let onInputFailure = null;

// stdout is the native-messaging channel. Anything that is not a frame breaks it.
/**
 * @param {unknown} message
 */
function sendAndExit(message) {
  if (exitReplySent) return;
  exitReplySent = true;
  process.stdout.write(encodeMessage(message), () => {
    process.exit(0);
  });
}

function exitWhenFlushed() {
  // Queues behind chunk writes. The callback runs only after those frames have flushed.
  process.stdout.write('', () => {
    process.exit(0);
  });
}

/**
 * @param {string} bin
 * @returns {Promise<string>}
 */
function readVersion(bin) {
  return new Promise((resolve) => {
    let run;
    try {
      run = resolveCommand(bin);
    } catch {
      resolve('');
      return;
    }
    execFile(run.cmd, [...run.args, '--version'], { timeout: 5000 }, (_err, stdout) => {
      const text = typeof stdout === 'string' ? stdout : '';
      resolve(text.split('\n')[0].trim());
    });
  });
}

async function handlePing() {
  /** @type {Record<string, { version: string } | null>} */
  const clis = {};
  for (const name of CLI_NAMES) {
    const bin = findOnPath(name, process.env.PATH);
    clis[name] = bin ? { version: await readVersion(bin) } : null;
  }
  sendAndExit({ type: 'pong', clis });
}

/**
 * @param {Record<string, unknown>} msg
 */
function handleRewrite(msg) {
  const cli = typeof msg.cli === 'string' ? msg.cli : '';
  const model = typeof msg.model === 'string' ? msg.model : '';
  const effort = typeof msg.effort === 'string' ? msg.effort : '';
  const system = typeof msg.system === 'string' ? msg.system : '';
  const user = typeof msg.user === 'string' ? msg.user : '';
  if (user.length > MAX_USER_PROMPT_BYTES || Buffer.byteLength(user) > MAX_USER_PROMPT_BYTES) {
    sendAndExit({ type: 'error', message: INPUT_LIMIT_MESSAGE });
    return;
  }

  const bin = findOnPath(cli, process.env.PATH);
  if (!bin) {
    sendAndExit({
      type: 'error',
      message: `${cli} CLI not found. Install it, log in, then run "npm run bridge:install" again.`,
    });
    return;
  }

  const env = { ...process.env };
  if (cli === 'grok') {
    Object.assign(env, GROK_IMPORTS_OFF);
    env.GROK_MEMORY = '0';
    env.GROK_WORKFLOWS = '0';
  }
  if (cli === 'codex') {
    const codexHome = codexHomeFor(os.homedir());
    if (!fs.existsSync(path.join(codexHome, 'auth.json'))) {
      sendAndExit({
        type: 'error',
        message: `Codex needs its own login for LocalPolish. In a terminal run: ${codexLoginCommand(codexHome)}`,
      });
      return;
    }
    env.CODEX_HOME = codexHome;
  }

  let run;
  try {
    run = resolveCommand(bin);
  } catch (err) {
    sendAndExit({ type: 'error', message: /** @type {Error} */ (err).message });
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'localpolish-'));
  let instructionsFile;
  let modelCatalogFile;
  if (cli === 'codex') {
    instructionsFile = path.join(dir, 'instructions.md');
    fs.writeFileSync(instructionsFile, system);
    const catalog = codexRewriteCatalog(env.CODEX_HOME, model);
    if (catalog) {
      modelCatalogFile = path.join(dir, 'models.json');
      fs.writeFileSync(modelCatalogFile, JSON.stringify(catalog));
    }
  }
  const { args } = buildCommand(cli, { model, effort, system, instructionsFile, modelCatalogFile });
  const child = spawn(run.cmd, [...run.args, ...args], {
    cwd: dir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    // Its own process group, so a kill also reaches the processes the CLI started.
    detached: process.platform !== 'win32',
  });

  let stderrTail = '';
  /** @type {string | null} */
  let rememberedError = null;
  let settled = false;
  let stdinClosed = false;
  let spawnFailed = false;
  let killed = false;
  let outputBytes = 0;
  let endsWithHighSurrogate = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let killTimer;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let runTimer;

  const removeDir = () => {
    fs.rmSync(dir, { recursive: true, force: true });
  };

  const killGroup = (/** @type {NodeJS.Signals} */ signal) => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, signal);
    } catch {
      // Already gone.
    }
  };

  // A CLI can ignore SIGTERM. SIGKILL follows if it is still running.
  const killChild = () => {
    if (killed) return;
    killed = true;
    if (process.platform === 'win32') {
      // Windows does not kill child processes with the parent, and npm shims run the CLI as one.
      const system32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
      execFile(
        path.join(system32, 'taskkill.exe'),
        ['/pid', String(child.pid), '/T', '/F'],
        () => {},
      );
      return;
    }
    killGroup('SIGTERM');
    killTimer = setTimeout(() => killGroup('SIGKILL'), KILL_AFTER_MS);
  };

  /**
   * @param {unknown} message
   */
  const finish = (message) => {
    if (settled) return;
    settled = true;
    clearTimeout(runTimer);
    if (message) process.stdout.write(encodeMessage(message));
    const done = () => {
      if (killed && process.platform !== 'win32') {
        clearTimeout(killTimer);
        killGroup('SIGKILL');
      }
      removeDir();
      exitWhenFlushed();
    };
    if (spawnFailed || child.exitCode !== null || child.signalCode !== null) {
      done();
      return;
    }
    child.once('close', done);
  };

  onInputFailure = (message) => {
    if (settled) return;
    killChild();
    finish(message);
  };

  runTimer = setTimeout(() => {
    killChild();
    finish({ type: 'error', message: 'Timed out after 60 seconds.' });
  }, TIMEOUT_MS);

  onDisconnect = () => {
    if (settled) return;
    stdinClosed = true;
    killChild();
  };

  child.stdin.on('error', () => {
    // The child can exit before it reads the prompt, which closes this pipe.
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk).slice(-2000);
  });

  // 'close' fires after stdout is finished, so every line is parsed before done.
  const handleLine = (/** @type {string} */ line) => {
    if (settled) return;
    const parsed = parseLine(cli, line);
    if (!parsed) return;
    if ('text' in parsed) {
      const text = parsed.text;
      const remainingBytes = MAX_OUTPUT_BYTES - outputBytes;
      const first = text.charCodeAt(0);
      // Separate encodings count a split pair as 3 + 3 bytes instead of 4.
      const correction = endsWithHighSurrogate && first >= 0xdc00 && first <= 0xdfff ? 2 : 0;
      const bytes = text.length > remainingBytes ? Infinity : Buffer.byteLength(text) - correction;
      if (bytes > remainingBytes) {
        killChild();
        finish({ type: 'error', message: OUTPUT_LIMIT_MESSAGE });
        return;
      }
      outputBytes += bytes;
      if (text.length > 0) {
        const last = text.charCodeAt(text.length - 1);
        endsWithHighSurrogate = last >= 0xd800 && last <= 0xdbff;
      }
      for (const text of splitText(parsed.text, CHUNK_CHARS)) {
        process.stdout.write(encodeMessage({ type: 'chunk', text }));
      }
      return;
    }
    if ('end' in parsed) {
      // Send done now. Claude Code writes a summary after the answer, which delays its exit by seconds.
      if (rememberedError !== null) return;
      killChild();
      finish({ type: 'done' });
      return;
    }
    rememberedError = parsed.error;
  };

  let lineBuffer = Buffer.alloc(0);
  let lineBytes = 0;
  let afterCR = false;
  const appendLine = (
    /** @type {Buffer} */ chunk,
    /** @type {number} */ start,
    /** @type {number} */ end,
  ) => {
    const needed = lineBytes + end - start;
    if (needed > MAX_CLI_EVENT_BYTES) {
      killChild();
      finish({ type: 'error', message: 'CLI event line exceeds the 8 MiB limit.' });
      return false;
    }
    if (needed > lineBuffer.length) {
      const capacity = Math.min(MAX_CLI_EVENT_BYTES, Math.max(needed, lineBuffer.length * 2, 1024));
      const next = Buffer.alloc(capacity);
      lineBuffer.copy(next, 0, 0, lineBytes);
      lineBuffer = next;
    }
    chunk.copy(lineBuffer, lineBytes, start, end);
    lineBytes = needed;
    return true;
  };
  child.stdout.on('data', (/** @type {Buffer} */ chunk) => {
    if (settled) return;
    let start = 0;
    for (let at = 0; at < chunk.length; at++) {
      const byte = chunk[at];
      if (afterCR && byte === 10) {
        afterCR = false;
        start = at + 1;
        continue;
      }
      afterCR = false;
      if (byte !== 10 && byte !== 13) continue;
      if (!appendLine(chunk, start, at)) return;
      const line = lineBuffer.toString('utf8', 0, lineBytes);
      lineBytes = 0;
      afterCR = byte === 13;
      handleLine(line);
      if (settled) return;
      start = at + 1;
    }
    appendLine(chunk, start, chunk.length);
  });
  child.stdout.on('end', () => {
    if (settled || lineBytes === 0) return;
    const line = lineBuffer.toString('utf8', 0, lineBytes);
    lineBytes = 0;
    handleLine(line);
  });

  child.on('error', (err) => {
    spawnFailed = true;
    finish({ type: 'error', message: err.message });
  });

  child.on('close', (code) => {
    if (settled) return;
    if (stdinClosed) {
      finish(null);
      return;
    }
    if (code === 0 && rememberedError === null) {
      finish({ type: 'done' });
      return;
    }
    const message =
      rememberedError === null
        ? `${cli} exited with code ${code}: ${stderrTail.trim().slice(-500)}`
        : rememberedError;
    finish({ type: 'error', message });
  });

  child.stdin.write(user);
  child.stdin.end();
}

const decode = createDecoder((msg) => {
  if (started) return;
  started = true;
  if (!msg || typeof msg !== 'object') {
    sendAndExit({ type: 'error', message: 'Unknown request.' });
    return;
  }
  const type = /** @type {{ type?: unknown }} */ (msg).type;
  if (type === 'ping') {
    void handlePing();
    return;
  }
  if (type === 'rewrite') {
    handleRewrite(/** @type {Record<string, unknown>} */ (msg));
    return;
  }
  sendAndExit({ type: 'error', message: 'Unknown request.' });
});

let inputFailed = false;
process.stdin.on('data', (chunk) => {
  if (inputFailed) return;
  try {
    decode(chunk);
  } catch (err) {
    inputFailed = true;
    const message = { type: 'error', message: /** @type {Error} */ (err).message };
    if (onInputFailure) onInputFailure(message);
    else sendAndExit(message);
  }
});

process.stdin.on('end', () => {
  if (inputFailed) return;
  if (onDisconnect) {
    onDisconnect();
    return;
  }
  if (!started) process.exit(0);
});
