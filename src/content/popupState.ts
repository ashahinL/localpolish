import { type Mode, type Tone } from '../core/settings';
import { findMissingTokens, lostArabicScript } from '../core/tokens';

export type Phase = 'streaming' | 'done' | 'error';
export type AcceptFailure = 'changed' | 'rejected';

export interface PopupState {
  input: string;
  mode: Mode;
  tone: Tone;
  phase: Phase;
  streamed: string;
  result: string;
  error: string;
  acceptFailure: AcceptFailure | null;
  copied: boolean;
}

export type PopupAction =
  | { type: 'start'; mode: Mode; tone: Tone }
  | { type: 'chunk'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string }
  | { type: 'accept-failed'; reason: AcceptFailure }
  | { type: 'copied'; copied: boolean };

export type Note =
  | { kind: 'count'; text: string; over: boolean }
  | { kind: 'missing'; tokens: string[] }
  | { kind: 'warning'; text: string };

const SHORTER_LIMIT = 280;

export function initialState(input: string, mode: Mode, tone: Tone): PopupState {
  return {
    input,
    mode,
    tone,
    phase: 'streaming',
    streamed: '',
    result: '',
    error: '',
    acceptFailure: null,
    copied: false,
  };
}

export function popupReducer(state: PopupState, action: PopupAction): PopupState {
  switch (action.type) {
    case 'start':
      return initialState(state.input, action.mode, action.tone);
    case 'chunk':
      if (state.phase !== 'streaming') return state;
      return { ...state, streamed: state.streamed + action.text };
    case 'done':
      if (state.phase !== 'streaming') return state;
      return { ...state, phase: 'done', result: action.text };
    case 'error':
      if (state.phase !== 'streaming') return state;
      return { ...state, phase: 'error', error: action.message };
    case 'accept-failed':
      if (state.phase !== 'done') return state;
      return { ...state, acceptFailure: action.reason };
    case 'copied':
      return { ...state, copied: action.copied };
  }
}

export function canAccept(state: PopupState): boolean {
  return state.phase === 'done';
}

export function isUnchanged(state: PopupState): boolean {
  return state.phase === 'done' && state.result === state.input;
}

export function popupNotes(state: PopupState, isMac: boolean): Note[] {
  if (state.phase !== 'done') return [];
  const notes: Note[] = [];
  if (state.mode === 'shorter') {
    const before = [...state.input].length;
    const after = [...state.result].length;
    const over = after > SHORTER_LIMIT;
    notes.push({
      kind: 'count',
      text: `${before} → ${after} characters${over ? ` · over ${SHORTER_LIMIT}` : ''}`,
      over,
    });
  }
  const missing = findMissingTokens(state.input, state.result);
  if (missing.length > 0) notes.push({ kind: 'missing', tokens: missing });
  if (lostArabicScript(state.input, state.result)) {
    notes.push({
      kind: 'warning',
      text: 'The Arabic text was changed to another script. Check it before you accept.',
    });
  }
  if (state.acceptFailure) {
    notes.push({ kind: 'warning', text: acceptFailureText(state.acceptFailure, isMac) });
  }
  return notes;
}

function acceptFailureText(reason: AcceptFailure, isMac: boolean): string {
  const paste = `The new text is copied. Paste it with ${isMac ? '⌘V' : 'Ctrl+V'}.`;
  if (reason === 'changed') {
    return `The text in the field changed since you selected it. ${paste}`;
  }
  return `This site did not accept the change. ${paste}`;
}
