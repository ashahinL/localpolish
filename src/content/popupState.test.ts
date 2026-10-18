import { describe, expect, it } from 'vitest';
import {
  canAccept,
  initialState,
  isUnchanged,
  pickAction,
  popupNotes,
  popupReducer,
  type Choice,
  type PopupAction,
  type PopupState,
} from './popupState';

function run(state: PopupState, ...actions: PopupAction[]): PopupState {
  return actions.reduce(popupReducer, state);
}

const fresh = initialState('i has went home', 'fix');

describe('popupReducer', () => {
  it('streams chunks and then takes the cleaned done text as the result', () => {
    const streaming = run(
      fresh,
      { type: 'chunk', text: 'I went' },
      { type: 'chunk', text: ' home' },
    );
    expect(streaming.streamed).toBe('I went home');
    expect(canAccept(streaming)).toBe(false);

    const done = popupReducer(streaming, { type: 'done', text: 'I went home.' });
    expect(done.phase).toBe('done');
    expect(done.result).toBe('I went home.');
    expect(canAccept(done)).toBe(true);
  });

  it('shows an error and keeps accept disabled', () => {
    const failed = run(
      fresh,
      { type: 'chunk', text: 'I' },
      { type: 'error', message: 'No bridge' },
    );
    expect(failed.phase).toBe('error');
    expect(failed.error).toBe('No bridge');
    expect(canAccept(failed)).toBe(false);
  });

  it('ignores events that arrive after the request finished', () => {
    const done = run(fresh, { type: 'done', text: 'I went home.' });
    expect(run(done, { type: 'chunk', text: 'x' }, { type: 'error', message: 'gone' })).toBe(done);
  });

  it('resets the output but keeps the saved answers and the view when a new choice starts', () => {
    const failedAccept = run(
      fresh,
      { type: 'done', text: 'I went home.' },
      { type: 'accept-failed', reason: 'changed', copied: false },
      { type: 'copy', copy: 'copied' },
    );
    const restarted = popupReducer(failedAccept, { type: 'start', choice: 'rephrase:formal' });
    expect(restarted).toEqual({
      ...initialState('i has went home', 'rephrase:formal'),
      cache: { fix: 'I went home.' },
      view: 'final',
    });
  });

  it('records an accept failure only once the result is done', () => {
    expect(
      run(fresh, { type: 'accept-failed', reason: 'rejected', copied: false }).acceptFailure,
    ).toBeNull();
    const done = run(
      fresh,
      { type: 'done', text: 'I went home.' },
      { type: 'accept-failed', reason: 'rejected', copied: false },
    );
    expect(done.acceptFailure).toBe('rejected');
    expect(done.acceptCopied).toBe(false);
    const copied = popupReducer(done, {
      type: 'accept-failed',
      reason: 'changed',
      copied: true,
    });
    expect(copied.acceptCopied).toBe(true);
  });

  it('shows the changes by default and switches to the final text', () => {
    const done = run(fresh, { type: 'done', text: 'I went home.' });
    expect(done.view).toBe('changes');
    const final = popupReducer(done, { type: 'view', view: 'final' });
    expect(final.view).toBe('final');
    expect(final.result).toBe('I went home.');
    expect(popupReducer(final, { type: 'view', view: 'changes' }).view).toBe('changes');
  });

  it('switches to the final text only when an accept failed and copying failed too', () => {
    const done = run(fresh, { type: 'done', text: 'I went home.' });
    expect(
      popupReducer(done, { type: 'accept-failed', reason: 'rejected', copied: true }).view,
    ).toBe('changes');
    expect(
      popupReducer(done, { type: 'accept-failed', reason: 'rejected', copied: false }).view,
    ).toBe('final');
  });

  it('stores the copy button state', () => {
    const copied = popupReducer(fresh, { type: 'copy', copy: 'copied' });
    expect(copied.copy).toBe('copied');
    expect(popupReducer(copied, { type: 'copy', copy: 'failed' }).copy).toBe('failed');
    expect(popupReducer(copied, { type: 'copy', copy: 'idle' }).copy).toBe('idle');
  });

  it('marks a result equal to the input as unchanged', () => {
    expect(isUnchanged(run(fresh, { type: 'done', text: 'i has went home' }))).toBe(true);
    expect(isUnchanged(run(fresh, { type: 'done', text: 'I went home.' }))).toBe(false);
    expect(isUnchanged(fresh)).toBe(false);
  });
});

describe('choosing a tab or chip', () => {
  function click(state: PopupState, choice: Choice): [PopupAction, PopupState] {
    const action = pickAction(state, choice);
    return [action, popupReducer(state, action)];
  }

  const fixed = run(fresh, { type: 'done', text: 'I went home.' });

  it('opens the Rephrase tab without a request and keeps showing the last answer', () => {
    const opened = popupReducer(fixed, { type: 'tab', tab: 'rephrase' });
    expect(opened.tab).toBe('rephrase');
    expect(opened.choice).toBe('fix');
    expect(opened.result).toBe('I went home.');
    expect(canAccept(opened)).toBe(true);
  });

  it('sends a request when a chip is picked', () => {
    const opened = popupReducer(fixed, { type: 'tab', tab: 'rephrase' });
    const [action, picked] = click(opened, 'rephrase:polite');
    expect(action).toEqual({ type: 'start', choice: 'rephrase:polite' });
    expect(picked.tab).toBe('rephrase');
    expect(picked.choice).toBe('rephrase:polite');
    expect(picked.phase).toBe('streaming');
    expect(canAccept(picked)).toBe(false);
  });

  it('shows a saved answer again without a request', () => {
    const polite = run(
      fixed,
      { type: 'start', choice: 'rephrase:polite' },
      { type: 'done', text: 'Kindly, I went home.' },
      { type: 'copy', copy: 'copied' },
    );
    const [action, back] = click(polite, 'fix');
    expect(action).toEqual({ type: 'restore', choice: 'fix' });
    expect(back).toEqual({
      ...initialState('i has went home', 'fix'),
      phase: 'done',
      result: 'I went home.',
      cache: { fix: 'I went home.', 'rephrase:polite': 'Kindly, I went home.' },
    });
    expect(click(back, 'rephrase:polite')[0]).toEqual({
      type: 'restore',
      choice: 'rephrase:polite',
    });
  });

  it('only moves the tab when the shown choice is clicked again', () => {
    const opened = popupReducer(fixed, { type: 'tab', tab: 'rephrase' });
    const [action, back] = click(opened, 'fix');
    expect(action).toEqual({ type: 'tab', tab: 'fix' });
    expect(back).toEqual(fixed);
  });

  it('retries the shown choice, keeps the open tab and replaces the saved answer', () => {
    const opened = popupReducer(fixed, { type: 'tab', tab: 'rephrase' });
    const retrying = popupReducer(opened, { type: 'retry' });
    expect(retrying.tab).toBe('rephrase');
    expect(retrying.choice).toBe('fix');
    expect(retrying.phase).toBe('streaming');
    expect(retrying.cache).toEqual({});
    const redone = popupReducer(retrying, { type: 'done', text: 'I went home!' });
    expect(redone.cache).toEqual({ fix: 'I went home!' });
  });

  it('keeps the view across a new, retried or saved answer', () => {
    const final = popupReducer(fixed, { type: 'view', view: 'final' });
    const shorter = run(
      final,
      { type: 'start', choice: 'shorter' },
      { type: 'done', text: 'Home.' },
    );
    expect(shorter.view).toBe('final');
    expect(popupReducer(shorter, { type: 'retry' }).view).toBe('final');
    expect(click(shorter, 'fix')[1].view).toBe('final');
  });

  it('does not save an answer that ended in an error', () => {
    const failed = run(
      fixed,
      { type: 'start', choice: 'shorter' },
      { type: 'error', message: 'No bridge' },
    );
    expect(failed.cache).toEqual({ fix: 'I went home.' });
    const [, back] = click(failed, 'fix');
    expect(click(back, 'shorter')[0]).toEqual({ type: 'start', choice: 'shorter' });
    expect(click(failed, 'shorter')[0]).toEqual({ type: 'start', choice: 'shorter' });
  });

  it('drops a streaming choice that is left before it finishes', () => {
    const streaming = run(
      fixed,
      { type: 'start', choice: 'shorter' },
      { type: 'chunk', text: 'I went' },
    );
    expect(click(streaming, 'shorter')[0]).toEqual({ type: 'tab', tab: 'shorter' });
    const [, back] = click(streaming, 'fix');
    expect(back.choice).toBe('fix');
    expect(back.result).toBe('I went home.');
    expect(back.cache).toEqual({ fix: 'I went home.' });
    expect(popupReducer(back, { type: 'done', text: 'late' })).toBe(back);
    expect(click(back, 'shorter')[0]).toEqual({ type: 'start', choice: 'shorter' });
  });
});

describe('popupNotes', () => {
  it('has no notes while streaming', () => {
    expect(popupNotes(initialState('a', 'shorter'), true)).toEqual([]);
  });

  it('counts characters in Shorter mode and flags results over 280', () => {
    const short = run(initialState('é'.repeat(142), 'shorter'), {
      type: 'done',
      text: 'a'.repeat(98),
    });
    expect(popupNotes(short, true)).toEqual([
      { kind: 'count', text: '142 → 98 characters', over: false },
    ]);

    const long = run(initialState('a', 'shorter'), {
      type: 'done',
      text: 'a'.repeat(300),
    });
    expect(popupNotes(long, true)).toEqual([
      { kind: 'count', text: '1 → 300 characters · over 280', over: true },
    ]);
  });

  it('lists missing tokens and a lost Arabic script', () => {
    const state = run(initialState('مرحبا @sam see https://x.io', 'fix'), {
      type: 'done',
      text: 'marhaba, see you',
    });
    expect(popupNotes(state, true)).toEqual([
      { kind: 'missing', tokens: ['@sam', 'https://x.io'] },
      {
        kind: 'warning',
        text: 'The Arabic text was changed to another script. Check it before you accept.',
      },
    ]);
  });

  it('explains accept failures with the platform paste shortcut', () => {
    const done = run(fresh, { type: 'done', text: 'I went home.' });
    const changed = popupReducer(done, { type: 'accept-failed', reason: 'changed', copied: true });
    expect(popupNotes(changed, true)).toEqual([
      {
        kind: 'warning',
        text: 'The text in the field changed since you selected it. The new text is copied. Paste it with ⌘V.',
      },
    ]);
    const rejected = popupReducer(done, {
      type: 'accept-failed',
      reason: 'rejected',
      copied: true,
    });
    expect(popupNotes(rejected, false)).toEqual([
      {
        kind: 'warning',
        text: 'This site did not accept the change. The new text is copied. Paste it with Ctrl+V.',
      },
    ]);
  });

  it('tells the user to copy from the popup when copying failed', () => {
    const done = run(fresh, { type: 'done', text: 'I went home.' });
    const changed = popupReducer(done, { type: 'accept-failed', reason: 'changed', copied: false });
    expect(popupNotes(changed, true)).toEqual([
      {
        kind: 'warning',
        text: 'The text in the field changed since you selected it. Copying failed too. Select the new text in this popup and copy it.',
      },
    ]);
    const rejected = popupReducer(done, {
      type: 'accept-failed',
      reason: 'rejected',
      copied: false,
    });
    expect(popupNotes(rejected, false)).toEqual([
      {
        kind: 'warning',
        text: 'This site did not accept the change. Copying failed too. Select the new text in this popup and copy it.',
      },
    ]);
  });
});
