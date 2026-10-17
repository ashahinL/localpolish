#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { TIMEOUT_MS } from './constants.mjs';
import {
  buildCommand,
  codexHomeFor,
  createDecoder,
  encodeMessage,
  findOnPath,
  parseLine,
} from './lib.mjs';

const CLI_NAMES = ['claude', 'codex', 'grok'];
const KILL_AFTER_MS = 2000;

let started = false;
/** @type {(() => void) | null} */
let onDisconnect = null;

// stdout is the native-messaging channel. Anything that is not a frame breaks it.
/**
 * @param {unknown} message
 */
function sendAndExit(message) {
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
    execFile(bin, ['--version'], { timeout: 5000 }, (_err, stdout) => {
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

  if (!findOnPath(cli, process.env.PATH)) {
    sendAndExit({
      type: 'error',
      message: `${cli} CLI not found. Install it, log in, then run "npm run bridge:install" again.`,
    });
    return;
  }

  const env = { ...process.env };
  if (cli === 'codex') {
    const codexHome = codexHomeFor(os.homedir());
    if (!fs.existsSync(path.join(codexHome, 'auth.json'))) {
      sendAndExit({
        type: 'error',
        message: `Codex needs its own login for LocalPolish. In a terminal run: CODEX_HOME="${codexHome}" codex login`,
      });
      return;
    }
    env.CODEX_HOME = codexHome;
  }

  const { cmd, args } = buildCommand(cli, { model, effort, system });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'localpolish-'));
  const child = spawn(cmd, args, {
    cwd: dir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderrTail = '';
  /** @type {string | null} */
  let rememberedError = null;
  let settled = false;
  let stdinClosed = false;
  let spawnFailed = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let killTimer;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let runTimer;

  const removeDir = () => {
    fs.rmSync(dir, { recursive: true, force: true });
  };

  // A CLI can ignore SIGTERM. SIGKILL follows if it is still running.
  const killChild = () => {
    if (killTimer) return;
    try {
      child.kill('SIGTERM');
    } catch {
      // Already gone.
    }
    killTimer = setTimeout(() => {
      try {
        if (child.exitCode === null) child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    }, KILL_AFTER_MS);
  };

  /**
   * @param {unknown} message
   */
  const finish = (message) => {
    if (settled) return;
    settled = true;
    clearTimeout(runTimer);
    const done = () => {
      clearTimeout(killTimer);
      removeDir();
      if (message) {
        process.stdout.write(encodeMessage(message), () => {
          process.exit(0);
        });
        return;
      }
      exitWhenFlushed();
    };
    if (spawnFailed || child.exitCode !== null || child.signalCode !== null) {
      done();
      return;
    }
    child.once('close', done);
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
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    const parsed = parseLine(cli, line);
    if (!parsed) return;
    if ('text' in parsed) {
      process.stdout.write(encodeMessage({ type: 'chunk', text: parsed.text }));
      return;
    }
    rememberedError = parsed.error;
  });

  child.on('error', (err) => {
    spawnFailed = true;
    finish({ type: 'error', message: err.message });
  });

  child.on('close', (code) => {
    clearTimeout(killTimer);
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

process.stdin.on(
  'data',
  createDecoder((msg) => {
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
  }),
);

process.stdin.on('end', () => {
  if (onDisconnect) {
    onDisconnect();
    return;
  }
  if (!started) process.exit(0);
});
