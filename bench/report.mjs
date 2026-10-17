// node report.mjs file.jsonl...  rescoring every answer with inputs.mjs
import fs from 'node:fs';
import { INPUTS } from './inputs.mjs';
const rows = process.argv.slice(2).flatMap((f) =>
  fs
    .readFileSync(f, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l)),
);
const pass = (r) => !r.error && INPUTS.find((i) => i.name === r.input).pass(r.text);
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const sec = (ms) => (ms / 1000).toFixed(1);
console.log(
  '| Setup | Score | Avg | Median | p90 | Max | First text (median) | Input tok | Output tok | Misses |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const setup of [...new Set(rows.map((r) => r.setup))]) {
  const rs = rows.filter((r) => r.setup === setup);
  const ms = rs.map((r) => r.ms);
  const firsts = rs.map((r) => r.firstMs).filter((x) => x !== null);
  const tok = (r, k) => {
    const u = r.usage?.usage ?? r.usage;
    if (!u) return 0;
    return k === 'in'
      ? (u.input_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0)
      : (u.output_tokens ?? 0);
  };
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const misses =
    INPUTS.map((i) => {
      const ir = rs.filter((r) => r.input === i.name);
      const p = ir.filter(pass).length;
      return p < ir.length ? `${i.name} ${p}/${ir.length}` : null;
    })
      .filter(Boolean)
      .join(', ') || 'none';
  console.log(
    `| ${setup} | ${rs.filter(pass).length}/${rs.length} | ${sec(avg(ms))} s | ${sec(pct(ms, 0.5))} s | ${sec(pct(ms, 0.9))} s | ${sec(Math.max(...ms))} s | ${sec(pct(firsts, 0.5))} s | ${Math.round(avg(rs.map((r) => tok(r, 'in'))))} | ${Math.round(avg(rs.map((r) => tok(r, 'out'))))} | ${misses} |`,
  );
}
const costs = rows.filter((r) => typeof r.usage?.cost === 'number');
for (const setup of [...new Set(costs.map((r) => r.setup))]) {
  const c = costs.filter((r) => r.setup === setup).map((r) => r.usage.cost);
  console.log(
    `cost reported by CLI, ${setup}: avg $${(c.reduce((a, b) => a + b, 0) / c.length).toFixed(5)} per request`,
  );
}
const codex = rows.filter((r) => r.usage && 'cached_input_tokens' in r.usage);
for (const setup of [...new Set(codex.map((r) => r.setup))]) {
  const u = codex.filter((r) => r.setup === setup).map((r) => r.usage);
  const a = (k) => Math.round(u.reduce((s, x) => s + (x[k] ?? 0), 0) / u.length);
  console.log(
    `codex tokens, ${setup}: input ${a('input_tokens')} (cached ${a('cached_input_tokens')}), output ${a('output_tokens')}, reasoning ${a('reasoning_output_tokens')}`,
  );
}
