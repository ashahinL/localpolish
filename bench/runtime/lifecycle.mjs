// Offline lifecycle probe. Synthetic delays only. No paid provider and no installed rewrite CLI.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CODEX_DISABLED_FEATURES,
  codexHomeFor,
  createDecoder,
  encodeMessage,
} from '../../bridge/lib.mjs';
import { compile } from './compile.mjs';
import { small } from './fixtures.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const hostPath = path.join(root, 'bridge/host.mjs');
const DELAYS = {
  usageSaveMs: 80,
  firstTextMs: 120,
  completionMs: 70,
  posixExitHoldMs: 250,
  syntheticCacheRefreshMs: 150,
};
const HANG_GUARD_MS = 30_000;
const MODELS = ['gpt-6-luna', 'gpt-6-sol'];
const CACHES = ['fresh', 'missing', 'stale'];
const REWRITE_CONFIG = [
  'skills.include_instructions=false',
  'agents.enabled=false',
  'include_permissions_instructions=false',
  'include_apps_instructions=false',
  'include_collaboration_mode_instructions=false',
  'include_environment_context=false',
  'tools.update_plan.enabled=false',
  'tools.experimental_request_user_input.enabled=false',
  'web_search=disabled',
];

const HELP = `Usage: npm run bench:lifecycle -- [--core-only] [--out-dir DIRECTORY]

Synthetic offline lifecycle report. It does not call a paid model, an installed rewrite CLI, or an external network. Injected delays are not Luna or Sol latency.

The core probe runs the compiled production runRewrite and cliProvider. Fake Chrome storage delays the real usage write. Fake connectNative spawns bridge/host.mjs. The host gets a private HOME, USERPROFILE, temp directory, and a PATH that contains only an owned fake codex and Node.

Cases cover gpt-6-luna and gpt-6-sol at effort none. Each model runs with a fresh models cache, a missing cache, and a stale cache. Fresh cache must put model_catalog_json on the real child argv and strip tool metadata. Fallback must omit that override. The fake adds ${DELAYS.syntheticCacheRefreshMs} ms only on fallback. That wait is labeled synthetic. It is not a Codex refresh.

Injected waits: usage save ${DELAYS.usageSaveMs} ms, first text ${DELAYS.firstTextMs} ms, completion ${DELAYS.completionMs} ms, POSIX exit hold ${DELAYS.posixExitHoldMs} ms after SIGTERM. Windows does not add an exit hold, because the host uses taskkill /F.

Phases stay separate: usage save, native and CLI startup, first model text, model stop and output ready, child exit, host exit. Output ready is not UI ready. Process close is not UI ready.

The default command also runs the existing browser rewrite-small probe. Native messaging stays stubbed there, and the provider is the local API mock. Those Accept and first-preview counters are not CLI UI latency and are not added to the native phases.

--core-only skips the browser and records the UI fields as null.
--out-dir DIRECTORY is the report directory. The default is bench/results.

Prerequisites: Node 22 or later and the installed project dependencies. The default command also needs npm run build and Playwright Chromium. The macOS Codex sandbox cannot launch that browser. A ${HANG_GUARD_MS} ms hang guard only stops a stuck case. It is not a speed limit.
`;

function parseArgs(argv) {
  const options = { coreOnly: false, outDir: path.join(root, 'bench/results'), help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--core-only') options.coreOnly = true;
    else if (arg === '--out-dir') {
      const value = argv[++index];
      if (!value || value.startsWith('--'))
        throw new Error('--out-dir needs a directory. Use --help.');
      options.outDir = path.resolve(value);
    } else throw new Error(`Unknown option: ${arg}. Use --help.`);
  }
  return options;
}

function cairoStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value ?? '';
  const offset = value('timeZoneName').replace(/^GMT/, '');
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}${offset}`;
}

function waitUntil(ms) {
  const end = Date.now() + ms;
  return new Promise((resolve) => {
    const step = () => {
      if (Date.now() >= end) resolve();
      else setTimeout(step, 5);
    };
    step();
  });
}

function hangGuard(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `${label} exceeded the ${HANG_GUARD_MS} ms hang guard. This is not a latency limit.`,
          ),
        ),
      HANG_GUARD_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

function stopPid(pid) {
  const targets = process.platform === 'win32' ? [pid] : [-pid, pid];
  for (const target of targets) {
    try {
      process.kill(target, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

function readState(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function filesUnder(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(filename) : [filename];
    });
}

function hashFiles(files) {
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    hash.update(path.relative(root, file)).update('\0').update(fs.readFileSync(file)).update('\0');
  }
  return hash.digest('hex');
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function playwrightVersion() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(root, 'node_modules/@playwright/test/package.json'), 'utf8'),
    ).version;
  } catch {
    return null;
  }
}

function environment(coreOnly) {
  const dist = path.join(root, 'dist');
  const hasBuild = fs.existsSync(path.join(dist, 'manifest.json'));
  return {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    node: process.version,
    cpu: os.cpus()[0]?.model ?? null,
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    playwrightPackage: playwrightVersion(),
    chromium: null,
    chromiumReason: coreOnly
      ? '--core-only does not launch a browser.'
      : 'Filled only when the separate browser probe launches Chromium.',
    sourceCommit: git(['rev-parse', 'HEAD']),
    dirty: git(['status', '--porcelain']) !== '',
    sourceHash: hashFiles([
      ...filesUnder(path.join(root, 'src')),
      ...filesUnder(path.join(root, 'bridge')),
      ...filesUnder(path.join(root, 'bench/runtime')).filter((file) => file.endsWith('.mjs')),
    ]),
    buildHash: hasBuild ? hashFiles(filesUnder(dist)) : null,
    buildHashReason: hasBuild
      ? 'SHA-256 of the checkout dist directory.'
      : 'dist/manifest.json is missing.',
  };
}

function cacheDocument(model, kind) {
  if (kind === 'missing') return null;
  const fetchedAt =
    kind === 'fresh'
      ? new Date().toISOString()
      : new Date(Date.now() - 10 * 60 * 1000).toISOString();
  return {
    fetched_at: fetchedAt,
    models: [
      { slug: 'other-model', tool_mode: 'leave-unselected' },
      {
        slug: model,
        context_window: 1000000,
        supported_reasoning_levels: [{ effort: 'none' }],
        tool_mode: 'code_mode_only',
        apply_patch_tool_type: 'freeform',
        experimental_supported_tools: ['clock'],
      },
    ],
  };
}

function expectedCatalog(model) {
  return {
    models: [
      {
        slug: model,
        context_window: 1000000,
        supported_reasoning_levels: [{ effort: 'none' }],
        tool_mode: null,
        apply_patch_tool_type: null,
        experimental_supported_tools: [],
      },
    ],
  };
}

function fakeSource(config) {
  return `const fs = require('node:fs');
const config = ${JSON.stringify(config)};
const state = {
  pid: process.pid,
  argv: process.argv.slice(2),
  env: {
    HOME: process.env.HOME || null,
    USERPROFILE: process.env.USERPROFILE || null,
    PATH: process.env.PATH || null,
    CODEX_HOME: process.env.CODEX_HOME || null,
    TMPDIR: process.env.TMPDIR || null,
    TMP: process.env.TMP || null,
    TEMP: process.env.TEMP || null,
  },
  events: [],
  stdin: '',
  catalog: null,
  instructions: null,
};
function persist() {
  const temporary = config.stateFile + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(state));
  fs.renameSync(temporary, config.stateFile);
}
function record(name, extra) {
  state.events.push({ name, atMs: Date.now(), clock: 'epoch-ms', source: 'fake-codex', ...extra });
  persist();
}
function wait(ms) {
  const end = Date.now() + ms;
  return new Promise((resolve) => {
    const step = () => {
      if (Date.now() >= end) resolve();
      else setTimeout(step, 5);
    };
    step();
  });
}
record('start');
if (config.exitHoldMs > 0) {
  process.on('SIGTERM', () => {
    record('sigterm');
    const startedAtMs = state.events.at(-1).atMs;
    const step = () => {
      if (Date.now() >= startedAtMs + config.exitHoldMs) {
        record('exit');
        process.exit(0);
      } else setTimeout(step, 5);
    };
    step();
  });
}
setInterval(() => {}, 1000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  state.stdin += chunk;
});
process.stdin.on('end', async () => {
  record('stdin', { bytes: Buffer.byteLength(state.stdin) });
  const instructionsArg = state.argv.find((arg) => arg.startsWith('model_instructions_file='));
  if (instructionsArg) {
    const file = JSON.parse(instructionsArg.slice('model_instructions_file='.length));
    state.instructions = { file, text: fs.readFileSync(file, 'utf8') };
    persist();
  }
  const catalogArg = state.argv.find((arg) => arg.startsWith('model_catalog_json='));
  if (catalogArg) {
    const file = JSON.parse(catalogArg.slice('model_catalog_json='.length));
    state.catalog = { file, document: JSON.parse(fs.readFileSync(file, 'utf8')) };
    persist();
  } else {
    const startedAtMs = Date.now();
    await wait(config.refreshMs);
    record('syntheticCacheRefresh', {
      startedAtMs,
      delayMs: config.refreshMs,
      label: 'synthetic',
      notRealRefresh: true,
    });
  }
  await wait(config.firstTextMs);
  record('firstText');
  process.stdout.write(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: config.answer },
  }) + '\\n');
  await wait(config.completionMs);
  record('stop');
  process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }) + '\\n');
});
`;
}

function installFakeCodex(bin, source) {
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'package.json'), '{"type":"commonjs"}\n');
  if (process.platform === 'win32') {
    fs.copyFileSync(process.execPath, path.join(bin, 'node.exe'));
    fs.writeFileSync(path.join(bin, 'codex.js'), source);
    fs.writeFileSync(
      path.join(bin, 'codex.cmd'),
      '@echo off\r\n"%~dp0node.exe" "%~dp0\\codex.js" %*\r\n',
    );
    return;
  }
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  fs.writeFileSync(path.join(bin, 'codex'), `#!/usr/bin/env node\n${source}`, { mode: 0o755 });
}

function eventAt(events, name) {
  const event = events.find((item) => item.name === name);
  assert.ok(event && typeof event.atMs === 'number', `missing ${name}`);
  return event.atMs;
}

function optionalAt(events, name) {
  const event = events.find((item) => item.name === name);
  return event ? event.atMs : null;
}

function assertGap(label, later, earlier, minimum) {
  assert.equal(typeof later, 'number', label);
  assert.equal(typeof earlier, 'number', label);
  assert.ok(
    later - earlier >= minimum,
    `${label}: ${later - earlier} ms is below the injected ${minimum} ms`,
  );
}

function assertAtOrAfter(label, later, earlier) {
  assert.ok(later >= earlier, `${label}: ${later} is before ${earlier}`);
}

function contained(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pushEvent(events, event) {
  events.push({ clock: 'epoch-ms', ...event });
}

function installChrome(chrome) {
  const had = Object.hasOwn(globalThis, 'chrome');
  const previous = globalThis.chrome;
  globalThis.chrome = chrome;
  return () => {
    if (had) globalThis.chrome = previous;
    else delete globalThis.chrome;
  };
}

async function runCase(ctx, model, cache) {
  const caseDir = fs.mkdtempSync(path.join(ctx.work, 'case-'));
  const bin = path.join(caseDir, 'bin');
  const home = path.join(caseDir, 'home');
  const hostTemp = path.join(caseDir, 'host-temp');
  const stateFile = path.join(caseDir, 'fake-state.json');
  const codexHome = codexHomeFor(home);
  for (const dir of [home, hostTemp, codexHome]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'auth.json'), '{}\n');
  const cacheBody = cacheDocument(model, cache);
  const cachePath = path.join(codexHome, 'models_cache.json');
  const cacheText = cacheBody === null ? null : JSON.stringify(cacheBody);
  if (cacheText !== null) fs.writeFileSync(cachePath, cacheText);
  installFakeCodex(
    bin,
    fakeSource({
      stateFile,
      answer: small.output,
      firstTextMs: DELAYS.firstTextMs,
      completionMs: DELAYS.completionMs,
      exitHoldMs: process.platform === 'win32' ? 0 : DELAYS.posixExitHoldMs,
      refreshMs: DELAYS.syntheticCacheRefreshMs,
    }),
  );

  const result = {
    model,
    cache,
    effort: 'none',
    status: 'running',
    syntheticOnly: true,
    events: [],
    uiReadyAtMs: null,
    uiReadyReason: 'This core probe has no page. UI ready is only the separate browser probe.',
  };
  const rows = [];
  let hostChild;
  let watcher;
  let fakePid;
  let stderr = '';
  const controller = new AbortController();
  const closed = { promise: null };

  const storage = {
    async get(key) {
      return key === 'usage' ? { usage: structuredClone(rows) } : {};
    },
    async set(items) {
      pushEvent(result.events, { name: 'usageSaveStart', atMs: Date.now(), source: 'parent' });
      await waitUntil(DELAYS.usageSaveMs);
      rows.splice(0, rows.length, ...structuredClone(items.usage));
      pushEvent(result.events, { name: 'usageSaveEnd', atMs: Date.now(), source: 'parent' });
    },
  };

  const connectNative = (hostName) => {
    assert.equal(hostName, ctx.hostName);
    const hostSpawnAtMs = Date.now();
    hostChild = spawn(process.execPath, [hostPath], {
      env: {
        PATH: bin,
        HOME: home,
        USERPROFILE: home,
        TMPDIR: hostTemp,
        TMP: hostTemp,
        TEMP: hostTemp,
        ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    pushEvent(result.events, {
      name: 'hostSpawn',
      atMs: hostSpawnAtMs,
      pid: hostChild.pid,
      source: 'parent',
    });
    hostChild.stdin.on('error', () => {});
    hostChild.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    closed.promise = new Promise((resolve) => {
      hostChild.once('close', (code, signal) => {
        pushEvent(result.events, {
          name: 'hostClose',
          atMs: Date.now(),
          code,
          signal,
          source: 'parent',
        });
        resolve({ code, signal });
      });
    });
    const listeners = [];
    const disconnects = [];
    let live = true;
    hostChild.once('error', (error) => {
      for (const listener of listeners) listener({ type: 'error', message: error.message });
    });
    hostChild.once('close', () => {
      if (!live) return;
      live = false;
      for (const listener of disconnects) listener();
    });
    const decode = createDecoder((message) => {
      const atMs = Date.now();
      if (message?.type === 'chunk' && !result.events.some((item) => item.name === 'nativeChunk')) {
        pushEvent(result.events, {
          name: 'nativeChunk',
          atMs,
          text: message.text,
          source: 'parent',
        });
      }
      if (message?.type === 'done') {
        const state = readState(stateFile);
        fakePid = state?.pid;
        let aliveAtReady = null;
        let aliveReason = null;
        if (!fakePid) aliveReason = 'The fake state file had no pid when the done frame arrived.';
        else {
          try {
            aliveAtReady = alive(fakePid);
          } catch (error) {
            aliveReason = error.message;
          }
        }
        pushEvent(result.events, {
          name: 'nativeDone',
          atMs,
          aliveAtReady,
          aliveReason,
          source: 'parent',
        });
      }
      if (message?.type === 'error') {
        pushEvent(result.events, {
          name: 'nativeError',
          atMs,
          message: message.message,
          source: 'parent',
        });
      }
      if (live) for (const listener of listeners) listener(message);
    });
    hostChild.stdout.on('data', (chunk) => {
      try {
        decode(chunk);
      } catch (error) {
        pushEvent(result.events, {
          name: 'nativeDecodeError',
          atMs: Date.now(),
          message: error.message,
          source: 'parent',
        });
      }
    });
    return {
      postMessage(message) {
        hostChild.stdin.write(encodeMessage(message));
      },
      disconnect() {
        if (!live) return;
        live = false;
        hostChild.stdin.end();
        for (const listener of disconnects) listener();
      },
      onMessage: { addListener: (listener) => listeners.push(listener) },
      onDisconnect: { addListener: (listener) => disconnects.push(listener) },
    };
  };

  globalThis.chrome = { runtime: { connectNative }, storage: { local: storage } };
  watcher = setInterval(() => {
    try {
      const state = readState(stateFile);
      if (!state?.pid || result.events.some((item) => item.name === 'parentObservedChildGone'))
        return;
      fakePid = state.pid;
      if (!alive(state.pid)) {
        pushEvent(result.events, {
          name: 'parentObservedChildGone',
          atMs: Date.now(),
          pid: state.pid,
          source: 'parent',
        });
      }
    } catch (error) {
      pushEvent(result.events, {
        name: 'pidWatchError',
        atMs: Date.now(),
        message: error.message,
        source: 'parent',
      });
    }
  }, 10);

  const posted = [];
  const work = (async () => {
    const settings = {
      ...ctx.defaults,
      provider: 'codex-cli',
      models: { ...ctx.defaults.models, 'codex-cli': model },
      efforts: { ...ctx.defaults.efforts, 'codex-cli': 'none' },
      blocklist: [...ctx.defaults.blocklist],
    };
    pushEvent(result.events, { name: 'requestAccepted', atMs: Date.now(), source: 'parent' });
    await ctx.runRewrite(
      { mode: 'fix', tone: 'polite', text: small.input },
      settings,
      ctx.cliProvider('codex'),
      (event) => {
        posted.push(event);
        if (event.type === 'chunk') {
          pushEvent(result.events, {
            name: 'backgroundChunk',
            atMs: Date.now(),
            text: event.text,
            source: 'parent',
          });
        } else if (event.type === 'done') {
          pushEvent(result.events, {
            name: 'backgroundDone',
            atMs: Date.now(),
            text: event.text,
            source: 'parent',
          });
        } else {
          pushEvent(result.events, {
            name: 'backgroundError',
            atMs: Date.now(),
            message: event.message,
            source: 'parent',
          });
        }
      },
      controller.signal,
    );
    const exit = await closed.promise;
    const state = readState(stateFile);
    assert.ok(state, `Fake Codex wrote no state. ${stderr}`);
    for (const event of state.events) result.events.push(event);
    if (state.pid && !result.events.some((event) => event.name === 'parentObservedChildGone')) {
      assert.equal(alive(state.pid), false, 'fake Codex was still alive after host close');
      pushEvent(result.events, {
        name: 'parentObservedChildGone',
        atMs: Date.now(),
        pid: state.pid,
        source: 'parent',
      });
    }
    const failure = posted.find((event) => event.type === 'error');
    assert.equal(failure, undefined, `${failure?.message ?? ''} ${stderr}`);
    assert.equal(exit.code, 0, stderr);
    assert.equal(posted.filter((event) => event.type === 'done').length, 1);
    assert.equal(posted.find((event) => event.type === 'done').text, small.output);
    assert.equal(
      posted
        .filter((event) => event.type === 'chunk')
        .map((event) => event.text)
        .join(''),
      small.output,
    );
    assert.deepEqual(rows, [{ provider: 'codex-cli', model, requests: 1 }]);
    finishCase(result, {
      model,
      cache,
      state,
      home,
      bin,
      hostTemp,
      cachePath,
      cacheText,
      prompt: ctx.prompt,
    });
  })();

  try {
    await hangGuard(work, `${model} ${cache}`);
    result.status = 'passed';
    return result;
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof Error ? error.message : String(error);
    const state = readState(stateFile);
    if (state?.events) {
      for (const event of state.events) {
        if (!result.events.includes(event)) result.events.push(event);
      }
    }
    if (error && typeof error === 'object') error.partial = result;
    throw error;
  } finally {
    clearInterval(watcher);
    controller.abort();
    fakePid ??= readState(stateFile)?.pid;
    if (hostChild && hostChild.exitCode === null && hostChild.signalCode === null)
      hostChild.kill('SIGKILL');
    if (fakePid && alive(fakePid)) stopPid(fakePid);
    if (hostChild) await closed.promise;
    fs.rmSync(caseDir, { recursive: true, force: true });
    work.catch(() => {});
  }
}

function finishCase(result, ctx) {
  const { state, model, cache } = ctx;
  const events = result.events;
  const posix = process.platform !== 'win32';
  assert.equal(state.env.HOME, ctx.home);
  assert.equal(state.env.USERPROFILE, ctx.home);
  assert.notEqual(state.env.HOME, os.homedir());
  assert.equal(state.env.CODEX_HOME, codexHomeFor(ctx.home));
  assert.equal(state.env.PATH, ctx.bin);
  assert.equal(state.argv[0], 'exec');
  assert.equal(state.argv[state.argv.indexOf('-m') + 1], model);
  assert.equal(state.argv[state.argv.indexOf('-s') + 1], 'read-only');
  assert.ok(state.argv.includes('model_reasoning_effort=none'));
  assert.equal(
    state.argv.some((arg) => arg.startsWith('developer_instructions=')),
    false,
  );
  for (const flag of ['--skip-git-repo-check', '--ephemeral', '--json', ...REWRITE_CONFIG]) {
    assert.ok(state.argv.includes(flag), `missing ${flag}`);
  }
  for (const feature of CODEX_DISABLED_FEATURES) {
    assert.ok(
      state.argv.includes(`features.${feature}=false`),
      `missing features.${feature}=false`,
    );
  }
  assert.equal(state.stdin, ctx.prompt.user);
  assert.equal(state.instructions?.text, ctx.prompt.system);
  assert.ok(contained(ctx.hostTemp, state.instructions.file));
  const catalogArg = state.argv.find((arg) => arg.startsWith('model_catalog_json='));
  if (cache === 'fresh') {
    assert.ok(catalogArg, 'fresh cache did not produce model_catalog_json');
    assert.equal(JSON.parse(catalogArg.slice('model_catalog_json='.length)), state.catalog.file);
    assert.deepEqual(state.catalog.document, expectedCatalog(model));
    assert.ok(contained(ctx.hostTemp, state.catalog.file));
    assert.equal(
      events.some((event) => event.name === 'syntheticCacheRefresh'),
      false,
    );
  } else {
    assert.equal(catalogArg, undefined);
    assert.equal(state.catalog, null);
    assert.ok(
      events.some((event) => event.name === 'syntheticCacheRefresh' && event.label === 'synthetic'),
    );
  }
  if (ctx.cacheText === null) assert.equal(fs.existsSync(ctx.cachePath), false);
  else assert.equal(fs.readFileSync(ctx.cachePath, 'utf8'), ctx.cacheText);
  assert.equal(fs.existsSync(path.join(ctx.home, 'auth.json')), false);
  assert.equal(fs.existsSync(path.join(codexHomeFor(ctx.home), 'auth.json')), true);

  const accepted = eventAt(events, 'requestAccepted');
  const usageStart = eventAt(events, 'usageSaveStart');
  const usageEnd = eventAt(events, 'usageSaveEnd');
  const hostSpawn = eventAt(events, 'hostSpawn');
  const fakeStart = eventAt(events, 'start');
  const stdin = eventAt(events, 'stdin');
  const firstText = eventAt(events, 'firstText');
  const stop = eventAt(events, 'stop');
  const nativeChunk = eventAt(events, 'nativeChunk');
  const nativeDone = eventAt(events, 'nativeDone');
  const backgroundChunk = eventAt(events, 'backgroundChunk');
  const backgroundDone = eventAt(events, 'backgroundDone');
  const hostClose = eventAt(events, 'hostClose');
  const childGone = eventAt(events, 'parentObservedChildGone');
  const refresh = optionalAt(events, 'syntheticCacheRefresh');
  const sigterm = optionalAt(events, 'sigterm');
  const fakeExit = optionalAt(events, 'exit');
  const doneEvent = events.find((event) => event.name === 'nativeDone');

  assertAtOrAfter('usage save follows acceptance', usageStart, accepted);
  assertGap('usage save', usageEnd, usageStart, DELAYS.usageSaveMs);
  assertAtOrAfter('provider follows usage save', hostSpawn, usageEnd);
  assertAtOrAfter('fake start follows host spawn', fakeStart, hostSpawn);
  assertAtOrAfter('stdin follows fake start', stdin, fakeStart);
  if (cache === 'fresh') assertGap('first text', firstText, stdin, DELAYS.firstTextMs);
  else {
    assertGap('synthetic cache refresh', refresh, stdin, DELAYS.syntheticCacheRefreshMs);
    assertGap('first text after synthetic refresh', firstText, refresh, DELAYS.firstTextMs);
  }
  assertGap('completion', stop, firstText, DELAYS.completionMs);
  assertAtOrAfter('native chunk follows first text', nativeChunk, firstText);
  assertAtOrAfter('background chunk follows native chunk', backgroundChunk, nativeChunk);
  assertAtOrAfter('native done follows stop', nativeDone, stop);
  assertAtOrAfter('background done follows native done', backgroundDone, nativeDone);
  assert.equal(events.find((event) => event.name === 'backgroundDone').text, small.output);
  assert.equal(result.uiReadyAtMs, null);
  assert.equal(
    events.some((event) => event.name === 'uiReady'),
    false,
  );

  if (posix) {
    assert.equal(doneEvent.aliveAtReady, true, 'fake Codex must still be alive at output ready');
    assert.equal(typeof sigterm, 'number');
    assert.equal(typeof fakeExit, 'number');
    assertGap('POSIX exit hold', fakeExit, sigterm, DELAYS.posixExitHoldMs);
    assert.ok(fakeExit > nativeDone, 'output ready must precede child exit');
    assertAtOrAfter('child exit follows SIGTERM hold', childGone, fakeExit);
    assertAtOrAfter('host exit follows child exit', hostClose, fakeExit);
  } else {
    assert.equal(fakeExit, null);
    assert.equal(sigterm, null);
    assert.equal(typeof doneEvent.aliveAtReady, 'boolean');
  }
  assert.equal(alive(state.pid), false, 'fake pid still exists after host close');
  assert.deepEqual(fs.readdirSync(ctx.hostTemp), []);
  if (state.catalog?.file) assert.equal(fs.existsSync(state.catalog.file), false);
  assert.equal(fs.existsSync(state.instructions.file), false);

  const childExitAtMs = posix ? fakeExit : childGone;
  result.answer = small.output;
  result.usage = [{ provider: 'codex-cli', model, requests: 1 }];
  result.clock = 'epoch-ms';
  result.aliveAtReady = doneEvent.aliveAtReady;
  result.aliveAtReadyReason = posix
    ? 'Signal 0 succeeded when the parent decoded the host done frame.'
    : 'Windows taskkill /F can reap the child before the done frame is observed. This boolean is an observation, not an exit hold.';
  result.pidAbsentAfterClose = true;
  result.hostTempEmpty = true;
  result.observedArgv = state.argv;
  result.catalogOverride = cache === 'fresh';
  result.boundaries = {
    requestAcceptedAtMs: accepted,
    usageSaveStartAtMs: usageStart,
    usageSaveEndAtMs: usageEnd,
    hostSpawnAtMs: hostSpawn,
    fakeStartAtMs: fakeStart,
    stdinAtMs: stdin,
    syntheticCacheRefreshAtMs: refresh,
    firstTextAtMs: firstText,
    stopAtMs: stop,
    nativeChunkAtMs: nativeChunk,
    nativeDoneAtMs: nativeDone,
    backgroundChunkAtMs: backgroundChunk,
    backgroundDoneAtMs: backgroundDone,
    sigtermAtMs: sigterm,
    fakeExitAtMs: fakeExit,
    parentObservedChildGoneAtMs: childGone,
    hostCloseAtMs: hostClose,
    uiReadyAtMs: null,
    uiReadyReason: result.uiReadyReason,
    fakeExitReason: posix
      ? 'Fake Codex wrote this epoch time immediately before process.exit, after the SIGTERM hold.'
      : 'No fake exit timestamp. Windows does not run an exit hold. Use parentObservedChildGoneAtMs.',
  };
  result.durationsMs = {
    usageSave: usageEnd - usageStart,
    nativeStartupToFakeStart: fakeStart - hostSpawn,
    promptDelivery: stdin - fakeStart,
    syntheticCacheRefresh: refresh === null ? null : refresh - stdin,
    firstText: firstText - (refresh ?? stdin),
    completion: stop - firstText,
    outputReadyAfterStop: nativeDone - stop,
    outputReadyToChildExit: childExitAtMs - nativeDone,
    childExitToHostClose: hostClose - childExitAtMs,
  };
  result.durationDefinitions = {
    usageSave:
      'Actual storage set inside recordUsage, including the injected write wait. It ends before the provider starts.',
    nativeStartupToFakeStart:
      'Parent epoch time just before spawning bridge/host.mjs, until the fake Codex records start.',
    promptDelivery: 'Fake start until the production host has closed the prompt stdin.',
    syntheticCacheRefresh:
      'Null on a fresh cache. Otherwise, stdin end until the fake finishes its labeled synthetic wait, including any file reads before that wait. This is not a network refresh.',
    firstText:
      'End of stdin, or end of the synthetic refresh, until the fake writes item.completed.',
    completion: 'item.completed until turn.completed.',
    outputReadyAfterStop:
      'Fake stop until the parent decodes the host done frame. This is output ready.',
    outputReadyToChildExit: posix
      ? 'Host done until the fake records exit. The child is still alive at done.'
      : 'Host done until the parent sees the pid disappear. Taskkill can make this negative. It is still not UI ready.',
    childExitToHostClose:
      'POSIX subtracts the fake exit timestamp from host close. Windows subtracts the parent pid-gone timestamp. Host close is not UI ready.',
  };
  result.ordering = {
    outputReadyBeforeChildExit: posix ? nativeDone < fakeExit : null,
    outputReadyBeforeChildExitReason: posix
      ? 'The done frame was observed while the delayed SIGTERM hold kept the fake alive.'
      : 'Windows forced termination does not prove this order. The events are still stored separately.',
    hostCloseIsUiReady: false,
  };
  result.phaseNotes = {
    usageSave:
      'A future usage-storage change would have to move usageSave. It would not by itself move first text.',
    startup:
      'A future native or CLI startup change would have to move hostSpawn, fake start, or prompt delivery.',
    firstText:
      'A future model-token or prompt change would have to move firstText. This run injected the wait.',
    exit: 'Child exit and host close are tail shutdown. They are after output ready on POSIX and are not UI ready.',
  };
}

function absentUi(reason) {
  return {
    status: 'not-measured',
    measured: false,
    syntheticOnly: true,
    scenario: null,
    acceptEnabledMs: null,
    acceptEnabledReason: reason,
    firstPreviewMs: null,
    firstPreviewReason: reason,
    providerCompletionMs: null,
    providerCompletionReason: reason,
    endToEndCliUiMs: null,
    endToEndCliUiReason:
      'Native phases and the API page probe are not added together. This command does not measure end-to-end CLI UI latency.',
  };
}

async function measureBrowser(rootDir, load, browserSession) {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localpolish-lifecycle-ui-'));
  let session;
  try {
    session = await browserSession(rootDir, load, artifactDir, 'lifecycle-ui');
    const result = await session.run('rewrite-small');
    return {
      status: 'measured',
      measured: true,
      syntheticOnly: true,
      scenario: 'rewrite-small',
      scope:
        'Separate browser probe. Native messaging is the existing runtime stub. The provider is the local API mock. Accept enabled and first preview come from the isolated-world counters. These numbers are not CLI startup, first model text, child exit, or a total with the native phases.',
      acceptEnabledMs: typeof result.readyMs === 'number' ? result.readyMs : null,
      acceptEnabledReason:
        typeof result.readyMs === 'number'
          ? 'Milliseconds from the isolated-world reset until the Accept button was enabled.'
          : 'The rewrite-small probe did not return an Accept enabled time.',
      firstPreviewMs: typeof result.firstPreviewMs === 'number' ? result.firstPreviewMs : null,
      firstPreviewReason:
        typeof result.firstPreviewMs === 'number'
          ? 'Milliseconds from the isolated-world reset until the first non-empty preview.'
          : 'The rewrite-small probe did not return a first preview time.',
      providerCompletionMs: null,
      providerCompletionReason:
        'The local mock does not publish a provider completion time outside the page. Accept enabled is the UI counter.',
      requests: result.requests,
      outputBytes: result.outputBytes,
      browserVersion: session.browserVersion,
      nativeConnections: null,
      nativeConnectionsReason:
        'rewrite-small does not return the stub connection counter. The stub is not a CLI measurement.',
      clock: 'performance.now in the isolated world, milliseconds from that probe reset',
      endToEndCliUiMs: null,
      endToEndCliUiReason:
        'Native phases and this API probe use different providers and clocks. They are not added together.',
    };
  } finally {
    try {
      if (session) await session.close();
    } finally {
      fs.rmSync(artifactDir, { recursive: true, force: true });
    }
  }
}

function definitions() {
  return {
    clock:
      'Core atMs values are Date.now epoch milliseconds in the parent and the fake Codex. Durations subtract those values. performance.now origins are not compared across processes.',
    requestAccepted: 'Epoch time immediately before the production runRewrite call.',
    usageSave:
      'Start and end of the real chrome.storage.local.set inside recordUsage. The fake delays that write.',
    nativeStartup:
      'hostSpawn is the epoch time immediately before the parent spawns bridge/host.mjs. Fake start is the owned codex process.',
    firstText: 'The fake writes a Codex item.completed agent_message after the injected wait.',
    modelStopReady:
      'The fake writes turn.completed, the host sends done, and runRewrite posts done. That is output ready. It is not UI ready and not process exit.',
    childExit:
      'On POSIX the fake records exit after its SIGTERM hold. The parent also records when signal 0 stops finding the pid. Host close is a later event.',
    uiReady:
      'Only the separate browser probe, from its own reset until Accept is enabled. Null in --core-only and in every native case.',
    syntheticCacheRefresh:
      'A fixed fake wait when the production host omits model_catalog_json. It is not Codex network latency.',
    units: {
      timestamps: 'epoch-ms',
      durations: 'ms',
      cairo: 'Africa/Cairo via Intl, offset from timeZoneName',
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < 22)
    throw new Error('Lifecycle benchmark requires Node 22 or later.');
  if (!options.coreOnly && !fs.existsSync(path.join(root, 'dist/manifest.json'))) {
    throw new Error('Built extension missing. Run npm run build, then npm run bench:lifecycle.');
  }

  fs.mkdirSync(options.outDir, { recursive: true });
  const started = new Date();
  const report = {
    schemaVersion: 1,
    command: 'npm run bench:lifecycle',
    status: 'running',
    syntheticOnly: true,
    syntheticOnlyReason:
      'Owned fake Codex, delayed local storage, and on the default command a local API mock. No paid call, no installed rewrite CLI, and no real Luna or Sol latency.',
    scope: options.coreOnly ? 'core-native' : 'core-native plus a separate browser API probe',
    coreOnly: options.coreOnly,
    startedAtMs: started.getTime(),
    startedCairo: cairoStamp(started),
    timezone: 'Africa/Cairo',
    delaysInjected: {
      ...DELAYS,
      windowsExitHoldMs: 0,
      windowsExitHoldReason:
        'The production host uses taskkill /F. This probe does not add a fake exit hold on Windows.',
      hangGuardMs: HANG_GUARD_MS,
      hangGuardReason:
        'Stops a stuck case only. Not a latency limit and not asserted as a maximum.',
    },
    definitions: definitions(),
    interpretation: [
      'Usage save, native and CLI startup, first text, model stop, UI ready, and child exit are different measurements.',
      'The injected waits prove the report can place those phases. They do not predict Luna or Sol speed.',
      'A fresh catalog sends model_catalog_json and stripped tool metadata. A missing or stale cache omits the override and adds only the labeled synthetic refresh wait.',
      'On POSIX, output ready happens while the fake child is still alive. Host close comes after child exit. Neither event is UI ready.',
      'The browser probe is optional and separate. Do not add it to the native durations.',
      'No live provider run is included, and this report does not authorize one.',
    ],
    environment: environment(options.coreOnly),
    cases: [],
    browserUi: null,
    endToEndCliUiMs: null,
    endToEndCliUiReason:
      'This report keeps native/CLI phases and the API UI probe apart. It has no end-to-end CLI UI total.',
  };
  const stamp = report.startedCairo.replace(/[^0-9]/g, '');
  const reportFile = path.join(options.outDir, `lifecycle-${stamp}-${process.pid}.json`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'localpolish-lifecycle-'));
  let restoreChrome = () => {};
  try {
    const load = compile(root, path.join(work, 'compiled'));
    const { runRewrite } = load('src/background/rewrite');
    const { cliProvider } = load('src/background/providers/cli');
    const { DEFAULT_SETTINGS } = load('src/core/settings');
    const { HOST_NAME } = load('src/core/messages');
    const { buildPrompt } = load('src/core/prompts');
    restoreChrome = installChrome({});
    const ctx = {
      work,
      runRewrite,
      cliProvider,
      defaults: DEFAULT_SETTINGS,
      hostName: HOST_NAME,
      prompt: buildPrompt('fix', 'polite', small.input),
    };
    for (const model of MODELS) {
      for (const cache of CACHES) {
        try {
          report.cases.push(await runCase(ctx, model, cache));
        } catch (error) {
          if (error?.partial && !report.cases.includes(error.partial))
            report.cases.push(error.partial);
          throw error;
        }
      }
    }
    if (options.coreOnly) {
      report.browserUi = absentUi('--core-only skips the browser. UI ready was not measured.');
    } else {
      const { browserSession } = await import('./browser.mjs');
      report.browserUi = await measureBrowser(root, load, browserSession);
      report.environment.chromium = report.browserUi.browserVersion ?? null;
      report.environment.chromiumReason =
        'Chromium version reported by the separate browserSession. It is not a CLI measurement.';
    }
    assert.equal(report.cases.length, MODELS.length * CACHES.length);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error instanceof Error ? error.message : String(error);
    if (!report.browserUi) {
      report.browserUi = absentUi(
        'The browser probe did not run because the command stopped earlier, or --core-only was set.',
      );
    }
    throw error;
  } finally {
    restoreChrome();
    fs.rmSync(work, { recursive: true, force: true });
    const finished = new Date();
    report.finishedAtMs = finished.getTime();
    report.finishedCairo = cairoStamp(finished);
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${reportFile}\n`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
