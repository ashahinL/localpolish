// Fix-mode speed, score and usage benchmark. Runs the same commands the bridge runs.
// node bench.mjs <repoDir> <outFile> <runs> [setupFilter]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { INPUTS } from './inputs.mjs';

const [repoDir, outFile, runsArg, filter] = process.argv.slice(2);
const lib = await import(pathToFileURL(path.join(repoDir, 'bridge', 'lib.mjs')).href);
const SYSTEM =
  'Fix the grammar, spelling, punctuation and capitalization of the text inside the <text> tags. Do not translate it. Return only the corrected text.';

const SETUPS = [
  { name: 'Haiku 5.5 low', cli: 'claude', model: 'haiku', effort: 'low' },
  { name: 'GPT-6 Luna none', cli: 'codex', model: 'gpt-6-luna', effort: 'none' },
  { name: 'GPT-6.1 Sol low', cli: 'codex', model: 'gpt-6.1-sol', effort: 'low' },
  { name: 'Grok 4.7 low', cli: 'grok', model: 'grok-4.7', effort: 'low' },
  { name: 'Grok 4.6 low', cli: 'grok', model: 'grok-4.6', effort: 'low' },
].filter((s) => !filter || s.name.toLowerCase().includes(filter.toLowerCase()));

function runOnce(setup, input) {
  return new Promise((resolve) => {
    const bin = lib.findOnPath(setup.cli, process.env.PATH);
    const run = lib.resolveCommand(bin);
    const { args } = lib.buildCommand(setup.cli, {
      model: setup.model,
      effort: setup.effort,
      system: SYSTEM,
    });
    const env = { ...process.env };
    if (setup.cli === 'grok') Object.assign(env, { GROK_MEMORY: '0', GROK_WORKFLOWS: '0' });
    if (setup.cli === 'codex') env.CODEX_HOME = lib.codexHomeFor(os.homedir());
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-bench-'));
    const start = performance.now();
    let first = null;
    let text = '';
    let error = null;
    let buf = '';
    const raw = [];
    const child = spawn(run.cmd, [...run.args, ...args], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) raw.push(line);
        const parsed = lib.parseLine(setup.cli, line);
        if (parsed && 'text' in parsed) {
          first ??= performance.now();
          text += parsed.text;
        } else if (parsed && 'error' in parsed) error = parsed.error;
      }
    });
    let stderr = '';
    child.stderr.on('data', (c) => (stderr += c));
    const timer = setTimeout(() => child.kill(), 90_000);
    child.on('close', () => {
      clearTimeout(timer);
      fs.rmSync(cwd, { recursive: true, force: true });
      const end = performance.now();
      resolve({
        setup: setup.name,
        input: input.name,
        ms: Math.round(end - start),
        firstMs: first === null ? null : Math.round(first - start),
        text: text.trim(),
        pass: !error && input.pass(text.trim()),
        error: error ?? (text ? null : stderr.slice(-400)),
        usage: usageOf(setup.cli, raw),
        tail: raw.slice(-3),
      });
    });
    child.stdin.end(`<text>\n${input.text}\n</text>`);
  });
}

function usageOf(cli, raw) {
  for (const line of [...raw].reverse()) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (cli === 'codex' && msg.type === 'turn.completed') return msg.usage;
    if (cli !== 'codex' && msg.type === 'result') {
      return { usage: msg.usage, cost: msg.total_cost_usd, modelUsage: msg.modelUsage };
    }
  }
  return null;
}

const runs = Number(runsArg);
const out = fs.createWriteStream(outFile, { flags: 'a' });
// Round-robin so each setup sees the same network conditions.
for (let r = 0; r < runs; r++) {
  for (const input of INPUTS) {
    for (const setup of SETUPS) {
      const result = await runOnce(setup, input);
      out.write(`${JSON.stringify({ run: r, ...result })}\n`);
      console.log(
        `${result.setup} | ${result.input} | ${result.ms} ms | ${result.pass ? 'pass' : 'FAIL'}`,
      );
    }
  }
}
out.end();
