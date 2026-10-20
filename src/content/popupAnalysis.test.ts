import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wordDiff } from '../core/diff';
import { findMissingTokens, lostArabicScript } from '../core/tokens';
import { createPopupAnalysis, type PopupAnalysis } from './popupAnalysis';
import {
  initialState,
  isUnchanged,
  popupNotes,
  popupReducer,
  type PopupAction,
  type PopupState,
} from './popupState';

// Call-through spies: the counts below come from the real diff and token code.
vi.mock('../core/diff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/diff')>();
  return { ...actual, wordDiff: vi.fn(actual.wordDiff) };
});
vi.mock('../core/tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/tokens')>();
  return {
    ...actual,
    findMissingTokens: vi.fn(actual.findMissingTokens),
    lostArabicScript: vi.fn(actual.lostArabicScript),
  };
});

function run(state: PopupState, ...actions: PopupAction[]): PopupState {
  return actions.reduce(popupReducer, state);
}

/** What one Popup render asks for: notes always, the diff only in a changed Changes view. */
function render(analysis: PopupAnalysis, state: PopupState, isMac = true) {
  const answer = analysis.answer(state);
  const notes = popupNotes(state, isMac, answer?.notes);
  const diff =
    answer && !isUnchanged(state) && state.view === 'changes' ? answer.diff() : undefined;
  return { notes, diff };
}

const counts = () => ({
  diffs: vi.mocked(wordDiff).mock.calls.length,
  tokenScans: vi.mocked(findMissingTokens).mock.calls.length,
  arabicChecks: vi.mocked(lostArabicScript).mock.calls.length,
});

const input = 'i has went home';
const fixDiff = [
  { type: 'del', text: 'i' },
  { type: 'add', text: 'I' },
  { type: 'same', text: ' ' },
  { type: 'del', text: 'has ' },
  { type: 'same', text: 'went home' },
  { type: 'add', text: '.' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createPopupAnalysis', () => {
  it('never diffs while only Final is shown', () => {
    const analysis = createPopupAnalysis();
    let state = run(initialState(input, 'fix'), { type: 'view', view: 'final' });
    render(analysis, state);
    state = run(state, { type: 'chunk', text: 'I went' }, { type: 'done', text: 'I went home.' });
    for (const copy of ['copied', 'idle'] as const) {
      expect(render(analysis, run(state, { type: 'copy', copy }))).toEqual({
        notes: [],
        diff: undefined,
      });
    }
    expect(counts()).toEqual({ diffs: 0, tokenScans: 1, arabicChecks: 1 });
  });

  it('diffs once when Changes and Final are shown three times each', () => {
    const analysis = createPopupAnalysis();
    let state = run(initialState(input, 'fix'), { type: 'done', text: 'I went home.' });
    for (let repeat = 0; repeat < 3; repeat++) {
      state = run(state, { type: 'view', view: 'final' });
      expect(render(analysis, state).diff).toBeUndefined();
      state = run(state, { type: 'view', view: 'changes' });
      expect(render(analysis, state).diff).toEqual(fixDiff);
      state = run(state, { type: 'copy', copy: 'copied' });
      expect(render(analysis, state).diff).toEqual(fixDiff);
    }
    expect(counts()).toEqual({ diffs: 1, tokenScans: 1, arabicChecks: 1 });
  });

  it('keeps multilingual notes and diff while Accept and copy warnings stay live', () => {
    const analysis = createPopupAnalysis();
    const done = run(initialState('مرحبا @sam كيف حالك', 'fix'), {
      type: 'done',
      text: 'مرحبا، كيف حالك؟',
    });
    const missing = { kind: 'missing', tokens: ['@sam'] };
    expect(render(analysis, done)).toEqual({
      notes: [missing],
      diff: [
        { type: 'same', text: 'مرحبا' },
        { type: 'add', text: '،' },
        { type: 'same', text: ' ' },
        { type: 'del', text: '@sam ' },
        { type: 'same', text: 'كيف حالك' },
        { type: 'add', text: '؟' },
      ],
    });

    const copied = run(done, { type: 'accept-failed', reason: 'rejected', copied: true });
    expect(render(analysis, copied, false).notes).toEqual([
      missing,
      {
        kind: 'warning',
        text: 'This site did not accept the change. The new text is copied. Paste it with Ctrl+V.',
      },
    ]);
    const failed = run(copied, { type: 'accept-failed', reason: 'changed', copied: false });
    expect(failed.view).toBe('final');
    expect(render(analysis, failed)).toEqual({
      notes: [
        missing,
        {
          kind: 'warning',
          text: 'The text in the field changed since you selected it. Copying failed too. Select the new text in this popup and copy it.',
        },
      ],
      diff: undefined,
    });
    expect(counts()).toEqual({ diffs: 1, tokenScans: 1, arabicChecks: 1 });
  });

  it('reuses a saved choice and keeps per-choice notes for identical text', () => {
    const analysis = createPopupAnalysis();
    const fixed = run(initialState(input, 'fix'), { type: 'done', text: 'I went home.' });
    const fixAnswer = analysis.answer(fixed);
    expect(fixAnswer?.diff()).toEqual(fixDiff);

    const shorter = run(fixed, { type: 'start', choice: 'shorter' });
    render(analysis, shorter);
    const shortDone = run(shorter, { type: 'done', text: 'I went home.' });
    expect(render(analysis, shortDone).notes).toEqual([
      { kind: 'count', text: '15 → 12 characters', over: false },
    ]);

    const back = run(shortDone, { type: 'restore', choice: 'fix' });
    expect(analysis.answer(back)).toBe(fixAnswer);
    expect(render(analysis, back)).toEqual({ notes: [], diff: fixDiff });
    expect(counts()).toEqual({ diffs: 2, tokenScans: 2, arabicChecks: 2 });
  });

  it('drops an answer on retry, replacement and input change', () => {
    const analysis = createPopupAnalysis();
    const done = run(initialState(input, 'fix'), { type: 'done', text: 'I went home.' });
    const first = analysis.answer(done);
    first?.diff();

    const retrying = run(done, { type: 'retry' });
    expect(render(analysis, retrying)).toEqual({ notes: [], diff: undefined });
    const again = run(retrying, { type: 'done', text: 'I went home.' });
    const second = analysis.answer(again);
    expect(second).not.toBe(first);
    expect(second?.diff()).toEqual(fixDiff);

    const rephrasing = run(again, { type: 'start', choice: 'rephrase:polite' });
    render(analysis, rephrasing);
    const polite = run(rephrasing, { type: 'done', text: 'Polite text.' });
    const firstPolite = analysis.answer(polite);
    expect(analysis.answer(run(polite, { type: 'restore', choice: 'fix' }))).toBe(second);

    const replacing = run(polite, { type: 'retry' });
    render(analysis, replacing);
    const replaced = run(replacing, { type: 'done', text: 'Kind text.' });
    expect(analysis.answer(replaced)).not.toBe(firstPolite);
    expect(analysis.answer(run(replaced, { type: 'restore', choice: 'fix' }))).toBe(second);

    const otherInput = { ...replaced, input: 'i has gone home' };
    expect(analysis.answer(otherInput)).not.toBe(analysis.answer(replaced));
    expect(counts()).toEqual({ diffs: 2, tokenScans: 6, arabicChecks: 6 });
  });

  it('recomputes after clear', () => {
    const analysis = createPopupAnalysis();
    const done = run(initialState(input, 'fix'), { type: 'done', text: 'I went home.' });
    const first = analysis.answer(done);
    analysis.clear();
    expect(analysis.answer(done)).not.toBe(first);
    expect(counts().tokenScans).toBe(2);
  });
});
