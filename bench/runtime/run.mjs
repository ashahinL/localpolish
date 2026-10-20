import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, fork } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { compile } from './compile.mjs';
import { browserSession } from './browser.mjs';
import { browserNames, coreNames } from './fixtures.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const options = { smoke: false, outDir: path.join(root, 'bench/results') };
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--smoke') options.smoke = true;
  else if (arg === '--out-dir' && process.argv[i + 1] && !process.argv[i + 1].startsWith('--'))
    options.outDir = path.resolve(process.argv[++i]);
  else if (arg === '--help') {
    console.log(
      'Usage: npm run bench:runtime -- [--smoke] [--out-dir DIRECTORY]\nRequires Node >=22, npm run build, and Playwright Chromium. All inputs and providers are synthetic.',
    );
    process.exit(0);
  } else throw new Error(`Unknown or incomplete option: ${arg}. Use --help.`);
}
if (Number(process.versions.node.split('.')[0]) < 22)
  throw new Error('Runtime benchmark requires Node >=22.');
if (!fs.existsSync(path.join(root, 'dist/manifest.json')))
  throw new Error('Built extension missing. Run npm run build, then npm run bench:runtime.');

function cairoTime() {
  if (process.platform !== 'win32') {
    return execFileSync('date', ['+%Y-%m-%dT%H:%M:%S%z'], {
      env: { ...process.env, TZ: 'Africa/Cairo' },
      encoding: 'utf8',
    }).trim();
  }
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'short',
    timeStyle: 'long',
    hour12: false,
  }).format(new Date());
}
function filesUnder(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(filename) : [filename];
    });
}
function hashFiles(files) {
  const hash = createHash('sha256');
  for (const file of files.sort())
    hash.update(path.relative(root, file)).update('\0').update(fs.readFileSync(file)).update('\0');
  return hash.digest('hex');
}
function summarize(samples) {
  const values = new Map();
  const visit = (value, key = '') => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (!values.has(key)) values.set(key, []);
      values.get(key).push(value);
    } else if (value && typeof value === 'object') {
      for (const [name, child] of Object.entries(value))
        visit(child, key ? `${key}.${name}` : name);
    }
  };
  for (const sample of samples)
    if (sample.status === 'passed') visit({ setupMs: sample.setupMs, ...sample.result });
  return Object.fromEntries(
    [...values].map(([name, list]) => {
      list.sort((a, b) => a - b);
      const mid = Math.floor(list.length / 2);
      return [
        name,
        {
          count: list.length,
          median: list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2,
          max: list.at(-1),
        },
      ];
    }),
  );
}
async function coreProcess(temp) {
  const child = fork(fileURLToPath(new URL('./worker.mjs', import.meta.url)), [root, temp], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const closed = once(child, 'close');
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr = (stderr + data).slice(-8000);
  });
  await new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      child.off('message', ready);
      child.off('exit', exited);
      child.off('error', failed);
      if (error) reject(error);
      else resolve();
    };
    const ready = () => finish();
    const exited = () => finish(new Error(`Core worker failed during setup: ${stderr}`));
    const failed = (error) => finish(error);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Core worker setup exceeded 15s'));
    }, 15_000);
    child.once('message', ready);
    child.once('exit', exited);
    child.once('error', failed);
  });
  return {
    async run(name) {
      return new Promise((resolve, reject) => {
        const done = (error, result) => {
          clearTimeout(timer);
          child.off('message', onMessage);
          child.off('exit', onExit);
          child.off('error', onError);
          if (error) reject(error);
          else resolve(result);
        };
        const onMessage = (message) =>
          done(message.error ? new Error(message.error) : null, message.result);
        const onExit = (code, signal) =>
          done(new Error(`Core worker exited (${code}, ${signal}): ${stderr}`));
        const onError = (error) => done(error);
        const timer = setTimeout(
          () => done(new Error(`Core scenario ${name} exceeded 30s: ${stderr}`)),
          30_000,
        );
        child.once('message', onMessage);
        child.once('exit', onExit);
        child.once('error', onError);
        child.send({ name });
      });
    },
    async close() {
      if (child.connected) child.send({ close: true });
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      try {
        await closed;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

fs.mkdirSync(options.outDir, { recursive: true });
const startedCairo = cairoTime();
const stamp = startedCairo.replace(/[^0-9]/g, '');
const stem = `runtime-${options.smoke ? 'smoke' : 'full'}-${stamp}-${process.pid}`;
const reportFile = path.join(options.outDir, `${stem}.json`);
const rawFile = path.join(options.outDir, `${stem}.samples.jsonl`);
const report = {
  schemaVersion: 1,
  status: 'running',
  syntheticOnly: true,
  mode: options.smoke ? 'smoke' : 'full',
  repetitionsPerTemperature: options.smoke ? 1 : 10,
  startedCairo,
  timezone: 'Africa/Cairo',
  environment: {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    node: process.version,
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    playwright: JSON.parse(
      fs.readFileSync(path.join(root, 'node_modules/@playwright/test/package.json')),
    ).version,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    dirty:
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== '',
    sourceHash: hashFiles([
      ...filesUnder(path.join(root, 'src')),
      ...filesUnder(path.join(root, 'bridge')),
      ...filesUnder(path.join(root, 'bench/runtime')).filter((file) => /\.(mjs|ts)$/.test(file)),
      ...['package.json', 'tests/e2e/extension-runtime.ts', 'tests/e2e/mock-openai.ts'].map(
        (file) => path.join(root, file),
      ),
    ]),
    buildHash: hashFiles(filesUnder(path.join(root, 'dist'))),
  },
  definitions: {
    browserCold:
      'Fresh Chromium persistent context, unique profile, extension service worker and editor for each sample. ms measures the operation; setupMs records launch/setup separately.',
    browserWarm:
      'Reuses the final cold session. Repeated operation in the same browser, profile, extension worker and editor; no reload between samples.',
    coreCold:
      'Fresh Node worker and compiled actual functions for each sample; fake Chrome storage boundary.',
    coreWarm:
      'Same Node worker, imported functions and storage boundary across repeated operations.',
    hostWarm:
      'Warm Node harness only. The production native host is single-use and is fresh for EVERY operation, including warm samples. No persistent-host latency claim.',
    counters:
      'Loose work-count ceilings and exact outputs/requests guard smoke. Known inefficiencies are recorded; timings and GC-dependent heap bytes never gate.',
    snapshots:
      'Heap snapshots run only on retention iteration 0 of each temperature, before and after three open/close cycles. Snapshotting can trigger GC and perturb memory observations.',
    offline:
      'Loopback HTTP and synthetic SSE only. No provider credentials or real rewrite CLIs. Browser loads an isolated dist copy with only the native-boundary stub prepended to its built worker; manifest bytes and all following production bytes stay unchanged. buildHash identifies the original checkout dist. Host PATH contains only the fake CLI; HOME/CODEX_HOME and temp are isolated.',
  },
  scenarios: [],
};
fs.writeFileSync(rawFile, '');
const save = () => fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'localpolish-runtime-'));
let active;
let interrupted = false;
const stop = () => {
  interrupted = true;
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  const load = compile(root, path.join(temp, 'fixtures'));
  let browserBlocked;
  for (const name of [...coreNames, ...browserNames]) {
    if (interrupted) throw new Error('Benchmark interrupted');
    const browser = browserNames.includes(name);
    const scenario = {
      name,
      kind: browser ? 'browser' : 'core',
      expectedPerTemperature: report.repetitionsPerTemperature,
      samples: [],
      summaries: {},
    };
    report.scenarios.push(scenario);
    if (browser && browserBlocked) {
      scenario.status = 'blocked';
      scenario.blocker = browserBlocked;
      scenario.missingSamples = report.repetitionsPerTemperature * 2;
      console.log(`${name}: blocked (0/${report.repetitionsPerTemperature * 2})`);
      save();
      continue;
    }
    for (const temperature of ['cold', 'warm']) {
      for (let iteration = 0; iteration < report.repetitionsPerTemperature; iteration++) {
        if (interrupted) throw new Error('Benchmark interrupted');
        const sample = { temperature, iteration, startedCairo: cairoTime() };
        try {
          if (!active) {
            const at = performance.now();
            active = browser
              ? await browserSession(root, load, options.outDir, `${stem}-${temperature}`)
              : await coreProcess(temp);
            sample.setupMs = performance.now() - at;
            if (browser) report.environment.chromium = active.browserVersion;
          }
          if (interrupted) throw new Error('Benchmark interrupted');
          if (temperature === 'warm' && sample.setupMs !== undefined)
            sample.warmup = await active.run(name, -1);
          if (interrupted) throw new Error('Benchmark interrupted');
          sample.result = await active.run(name, iteration);
          sample.status = 'passed';
        } catch (error) {
          sample.status = 'failed';
          sample.error = error.stack;
          if (browser && !active) browserBlocked = error.stack;
        } finally {
          scenario.samples.push(sample);
          fs.appendFileSync(rawFile, `${JSON.stringify({ scenario: name, ...sample })}\n`);
          if (
            interrupted ||
            (temperature === 'cold' && iteration < report.repetitionsPerTemperature - 1) ||
            sample.status !== 'passed' ||
            (temperature === 'warm' && iteration === report.repetitionsPerTemperature - 1)
          ) {
            await active?.close();
            active = undefined;
          }
          save();
        }
        if (browserBlocked || interrupted) break;
      }
      scenario.summaries[temperature] = summarize(
        scenario.samples.filter((sample) => sample.temperature === temperature),
      );
      if (browserBlocked || interrupted) break;
    }
    scenario.missingSamples = report.repetitionsPerTemperature * 2 - scenario.samples.length;
    scenario.status =
      scenario.samples.every((sample) => sample.status === 'passed') &&
      scenario.missingSamples === 0
        ? 'passed'
        : browserBlocked
          ? 'blocked'
          : 'failed';
    console.log(
      `${name}: ${scenario.status} (${scenario.samples.filter((sample) => sample.status === 'passed').length}/${report.repetitionsPerTemperature * 2})`,
    );
    save();
  }
  if (interrupted) throw new Error('Benchmark interrupted');
  report.status = report.scenarios.every((scenario) => scenario.status === 'passed')
    ? 'passed'
    : 'incomplete';
} catch (error) {
  report.status = 'incomplete';
  report.error = error.stack;
} finally {
  try {
    await active?.close();
  } catch (error) {
    report.status = 'incomplete';
    report.cleanupError = error.stack;
  }
  fs.rmSync(temp, { recursive: true, force: true });
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  report.finishedCairo = cairoTime();
  report.cleanup =
    "Closed sessions and removed only this run's unique temporary directories, extension copies, and profiles. Heap/report artifacts retained.";
  save();
  console.log(`${report.status}: ${reportFile}`);
  if (report.status !== 'passed') process.exitCode = 1;
}
