// Probes: exit gap after the final event, Grok without imported rules, Codex with our own base prompt.
// node probe.mjs <repoDir> <outFile> <runs>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { INPUTS } from './inputs.mjs';

const [repoDir, outFile, runsArg] = process.argv.slice(2);
const lib = await import(pathToFileURL(path.join(repoDir, 'bridge', 'lib.mjs')).href);
const SYSTEM =
  'Fix the grammar, spelling, punctuation and capitalization of the text inside the <text> tags. Do not translate it. Return only the corrected text.';
const instructionsFile = path.join(os.tmpdir(), 'lp-bench-instructions.md');
fs.writeFileSync(instructionsFile, SYSTEM);

const GROK_IMPORTS_OFF = {};
for (const source of ['CLAUDE', 'CODEX', 'CURSOR']) {
  for (const kind of ['AGENTS', 'HOOKS', 'MCPS', 'RULES', 'SKILLS', 'SESSIONS']) {
    GROK_IMPORTS_OFF[`GROK_${source}_${kind}_ENABLED`] = '0';
  }
}

const VARIANTS = [
  { name: 'Haiku 5.5 low', cli: 'claude', model: 'haiku', effort: 'low' },
  { name: 'Luna none', cli: 'codex', model: 'gpt-6-luna', effort: 'none' },
  {
    name: 'Luna none + own base prompt',
    cli: 'codex',
    model: 'gpt-6-luna',
    effort: 'none',
    extraArgs: ['-c', `model_instructions_file=${JSON.stringify(instructionsFile)}`],
  },
  { name: 'Grok 4.6 low', cli: 'grok', model: 'grok-4.6', effort: 'low' },
  {
    name: 'Grok 4.6 low + imports off',
    cli: 'grok',
    model: 'grok-4.6',
    effort: 'low',
    env: GROK_IMPORTS_OFF,
  },
  {
    name: 'Grok 4.7 low + imports off',
    cli: 'grok',
    model: 'grok-4.7',
    effort: 'low',
    env: GROK_IMPORTS_OFF,
  },
];

function isFinal(cli, msg) {
  return cli === 'codex' ? msg.type === 'turn.completed' : msg.type === 'result';
}

function runOnce(v, input) {
  return new Promise((resolve) => {
    const run = lib.resolveCommand(lib.findOnPath(v.cli, process.env.PATH));
    const { args } = lib.buildCommand(v.cli, { model: v.model, effort: v.effort, system: SYSTEM });
    const env = { ...process.env, ...(v.env ?? {}) };
    if (v.cli === 'grok') Object.assign(env, { GROK_MEMORY: '0', GROK_WORKFLOWS: '0' });
    if (v.cli === 'codex') env.CODEX_HOME = lib.codexHomeFor(os.homedir());
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-probe-'));
    const start = performance.now();
    let first = null;
    let final = null;
    let usage = null;
    let text = '';
    let buf = '';
    const child = spawn(run.cmd, [...run.args, ...args, ...(v.extraArgs ?? [])], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c) => (stderr += c));
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const parsed = lib.parseLine(v.cli, line);
        if (parsed && 'text' in parsed) {
          first ??= performance.now();
          text += parsed.text;
        }
        try {
          const msg = JSON.parse(line);
          if (isFinal(v.cli, msg)) {
            final = performance.now();
            usage = msg.usage ?? null;
          }
        } catch {
          // Not a JSON line.
        }
      }
    });
    child.on('close', () => {
      const end = performance.now();
      fs.rmSync(cwd, { recursive: true, force: true });
      const r = (t) => (t === null ? null : Math.round(t - start));
      resolve({
        variant: v.name,
        input: input.name,
        firstMs: r(first),
        finalMs: r(final),
        closeMs: r(end),
        inputTokens: usage
          ? (usage.input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0)
          : null,
        cached: usage?.cached_input_tokens ?? usage?.cache_read_input_tokens ?? null,
        outputTokens: usage?.output_tokens ?? null,
        pass: input.pass(text.trim()),
        text: text.trim(),
        stderr: text ? '' : stderr.slice(-300),
      });
    });
    child.stdin.end(`<text>\n${input.text}\n</text>`);
  });
}

const out = fs.createWriteStream(outFile, { flags: 'a' });
const picks = INPUTS.filter((i) => ['past tense', 'tokens', 'email'].includes(i.name));
for (let n = 0; n < Number(runsArg); n++) {
  for (const input of picks) {
    for (const v of VARIANTS) {
      const res = await runOnce(v, input);
      out.write(`${JSON.stringify(res)}\n`);
      console.log(
        `${res.variant} | ${res.input} | first ${res.firstMs} final ${res.finalMs} close ${res.closeMs} | in ${res.inputTokens} out ${res.outputTokens} | ${res.pass ? 'pass' : 'FAIL'}`,
      );
    }
  }
}
out.end();
