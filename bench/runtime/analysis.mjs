// P05 offline work count for popup analysis. Usage: node bench/runtime/analysis.mjs [--out FILE]
// Runs the actual compiled diff, token and popup-state code on synthetic text. No browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from './compile.mjs';
import { large, multilingual } from './fixtures.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const out = process.argv[2] === '--out' ? path.resolve(process.argv[3]) : undefined;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'localpolish-analysis-'));

try {
  const load = compile(root, temp);
  const diff = load('src/core/diff');
  const tokens = load('src/core/tokens');
  const { initialState, isUnchanged, popupNotes, popupReducer } = load('src/content/popupState');
  const { createPopupAnalysis } = load('src/content/popupAnalysis');

  const work = { wordDiff: [], findMissingTokens: 0, lostArabicScript: 0 };
  const wordDiff = diff.wordDiff;
  diff.wordDiff = (...args) => {
    const start = performance.now();
    const parts = wordDiff(...args);
    work.wordDiff.push({ ms: performance.now() - start, parts: parts.length });
    return parts;
  };
  for (const name of ['findMissingTokens', 'lostArabicScript']) {
    const actual = tokens[name];
    tokens[name] = (...args) => {
      work[name]++;
      return actual(...args);
    };
  }

  const run = (state, ...actions) => actions.reduce(popupReducer, state);
  const render = (analysis, state) => {
    const answer = analysis.answer(state);
    popupNotes(state, true, answer?.notes);
    if (answer && !isUnchanged(state) && state.view === 'changes') answer.diff();
  };
  const measure = (name, fixture, steps) => {
    work.wordDiff = [];
    work.findMissingTokens = 0;
    work.lostArabicScript = 0;
    const analysis = createPopupAnalysis();
    steps(
      analysis,
      run(initialState(fixture.input, 'fix'), { type: 'done', text: fixture.output }),
    );
    return {
      name,
      inputWords: fixture.input.split(/\s+/u).length,
      wordDiffCalls: work.wordDiff.length,
      wordDiffMs: work.wordDiff.map((call) => call.ms),
      wordDiffParts: work.wordDiff.map((call) => call.parts),
      findMissingTokensCalls: work.findMissingTokens,
      lostArabicScriptCalls: work.lostArabicScript,
    };
  };
  const views = (analysis, state) => {
    for (let repeat = 0; repeat < 3; repeat++) {
      for (const view of ['final', 'changes']) {
        state = run(state, { type: 'view', view }, { type: 'copy', copy: 'copied' });
        render(analysis, state);
      }
    }
    return state;
  };

  const results = [
    measure('final-only', large, (analysis, state) => {
      state = run(state, { type: 'view', view: 'final' });
      for (let i = 0; i < 3; i++) render(analysis, run(state, { type: 'copy', copy: 'copied' }));
    }),
    measure('changes-final-3x', large, views),
    measure('changes-final-3x-multilingual', multilingual, views),
    measure('retry-then-views', large, (analysis, state) => {
      state = views(analysis, state);
      state = run(state, { type: 'retry' });
      render(analysis, state);
      views(analysis, run(state, { type: 'done', text: large.output }));
    }),
    measure('replaced-choice-then-restore', large, (analysis, state) => {
      state = views(analysis, state);
      state = run(state, { type: 'start', choice: 'shorter' });
      render(analysis, state);
      state = views(analysis, run(state, { type: 'done', text: large.output }));
      state = run(state, { type: 'retry' });
      render(analysis, state);
      state = views(analysis, run(state, { type: 'done', text: large.input }));
      views(analysis, run(state, { type: 'restore', choice: 'fix' }));
    }),
  ];
  const expected = {
    'final-only': [0, 1],
    'changes-final-3x': [1, 1],
    'changes-final-3x-multilingual': [1, 1],
    'retry-then-views': [2, 2],
    // fix and the first shorter answer diff once each; the unchanged retry needs no diff.
    'replaced-choice-then-restore': [2, 3],
  };
  for (const result of results) {
    assert.deepEqual(
      [result.wordDiffCalls, result.findMissingTokensCalls],
      expected[result.name],
      result.name,
    );
    assert.equal(result.lostArabicScriptCalls, result.findMissingTokensCalls, result.name);
  }

  const report = {
    syntheticOnly: true,
    timezone: 'Africa/Cairo',
    finishedCairo: new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Cairo' }),
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    cpu: os.cpus()[0]?.model,
    baseline: 'runtime-full-202610200817580300-63158.json',
    baselineNote:
      'Baseline browser diff-1500-no-overlap reran the diff on every Changes click: cold median script time about 201 ms per click, three clicks.',
    scope:
      'Calls through the actual compiled wordDiff, findMissingTokens and lostArabicScript, driven by the real popup reducer and analysis cache. One render asks for notes, and for the diff only in a changed Changes view. Excludes Preact rendering, DOM and layout.',
    results,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (out) fs.writeFileSync(out, json);
  else process.stdout.write(json);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
