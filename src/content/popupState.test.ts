import { describe, expect, it } from 'vitest';
import {
  canAccept,
  initialState,
  isUnchanged,
  popupNotes,
  popupReducer,
  type PopupAction,
  type PopupState,
} from './popupState';

function run(state: PopupState, ...actions: PopupAction[]): PopupState {
  return actions.reduce(popupReducer, state);
}

const fresh = initialState('i has went home', 'fix', 'polite');

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

  it('resets the output when a new mode starts', () => {
    const failedAccept = run(
      fresh,
      { type: 'done', text: 'I went home.' },
      { type: 'accept-failed', reason: 'changed', copied: false },
      { type: 'copy', copy: 'copied' },
    );
    const restarted = popupReducer(failedAccept, { type: 'start', mode: 'tone', tone: 'formal' });
    expect(restarted).toEqual(initialState('i has went home', 'tone', 'formal'));
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

describe('popupNotes', () => {
  it('has no notes while streaming', () => {
    expect(popupNotes(initialState('a', 'shorter', 'polite'), true)).toEqual([]);
  });

  it('counts characters in Shorter mode and flags results over 280', () => {
    const short = run(initialState('é'.repeat(142), 'shorter', 'polite'), {
      type: 'done',
      text: 'a'.repeat(98),
    });
    expect(popupNotes(short, true)).toEqual([
      { kind: 'count', text: '142 → 98 characters', over: false },
    ]);

    const long = run(initialState('a', 'shorter', 'polite'), {
      type: 'done',
      text: 'a'.repeat(300),
    });
    expect(popupNotes(long, true)).toEqual([
      { kind: 'count', text: '1 → 300 characters · over 280', over: true },
    ]);
  });

  it('lists missing tokens and a lost Arabic script', () => {
    const state = run(initialState('مرحبا @sam see https://x.io', 'fix', 'polite'), {
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
