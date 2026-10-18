import { type Tone } from '../core/settings';
import { findMissingTokens, lostArabicScript } from '../core/tokens';

export type Phase = 'streaming' | 'done' | 'error';
export type AcceptFailure = 'changed' | 'rejected';
export type Tab = 'fix' | 'rephrase' | 'shorter';
export type Choice = 'fix' | 'shorter' | 'rephrase:keep' | `rephrase:${Tone}`;
/** How a changed answer is shown: as a word diff, or as the plain new text. */
export type View = 'changes' | 'final';

export interface PopupState {
  input: string;
  tab: Tab;
  /** The choice whose answer the body shows; Accept, Copy and Retry act on it. */
  choice: Choice;
  phase: Phase;
  streamed: string;
  result: string;
  error: string;
  cache: Partial<Record<Choice, string>>;
  acceptFailure: AcceptFailure | null;
  acceptCopied: boolean;
  copy: 'idle' | 'copied' | 'failed';
  view: View;
}

export type PopupAction =
  | { type: 'tab'; tab: Tab }
  | { type: 'view'; view: View }
  | { type: 'start'; choice: Choice }
  | { type: 'retry' }
  | { type: 'restore'; choice: Choice }
  | { type: 'chunk'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string }
  | { type: 'accept-failed'; reason: AcceptFailure; copied: boolean }
  | { type: 'copy'; copy: 'idle' | 'copied' | 'failed' };

export type Note =
  | { kind: 'count'; text: string; over: boolean }
  | { kind: 'missing'; tokens: string[] }
  | { kind: 'warning'; text: string };

const SHORTER_LIMIT = 280;

export function tabOf(choice: Choice): Tab {
  return choice === 'fix' || choice === 'shorter' ? choice : 'rephrase';
}

export function initialState(input: string, choice: Choice): PopupState {
  return {
    input,
    tab: tabOf(choice),
    choice,
    phase: 'streaming',
    streamed: '',
    result: '',
    error: '',
    cache: {},
    acceptFailure: null,
    acceptCopied: false,
    copy: 'idle',
    view: 'changes',
  };
}

export function popupReducer(state: PopupState, action: PopupAction): PopupState {
  switch (action.type) {
    case 'tab':
      return { ...state, tab: action.tab };
    case 'view':
      return { ...state, view: action.view };
    case 'start':
      return {
        ...initialState(state.input, action.choice),
        cache: without(state.cache, action.choice),
        view: state.view,
      };
    case 'retry':
      return {
        ...initialState(state.input, state.choice),
        tab: state.tab,
        cache: without(state.cache, state.choice),
        view: state.view,
      };
    case 'restore': {
      const result = state.cache[action.choice];
      if (result === undefined) return state;
      return {
        ...initialState(state.input, action.choice),
        cache: state.cache,
        view: state.view,
        phase: 'done',
        result,
      };
    }
    case 'chunk':
      if (state.phase !== 'streaming') return state;
      return { ...state, streamed: state.streamed + action.text };
    case 'done':
      if (state.phase !== 'streaming') return state;
      return {
        ...state,
        phase: 'done',
        result: action.text,
        cache: { ...state.cache, [state.choice]: action.text },
      };
    case 'error':
      if (state.phase !== 'streaming') return state;
      return { ...state, phase: 'error', error: action.message };
    case 'accept-failed':
      if (state.phase !== 'done') return state;
      // Without a copy the user must select the new text, so show it without the deleted words.
      return {
        ...state,
        acceptFailure: action.reason,
        acceptCopied: action.copied,
        view: action.copied ? state.view : 'final',
      };
    case 'copy':
      return { ...state, copy: action.copy };
  }
}

function without(cache: PopupState['cache'], choice: Choice): PopupState['cache'] {
  const next = { ...cache };
  delete next[choice];
  return next;
}

export function pickAction(state: PopupState, choice: Choice): PopupAction {
  if (choice === state.choice && state.phase !== 'error')
    return { type: 'tab', tab: tabOf(choice) };
  if (state.cache[choice] !== undefined) return { type: 'restore', choice };
  return { type: 'start', choice };
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
  if (state.choice === 'shorter') {
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
    notes.push({
      kind: 'warning',
      text: acceptFailureText(state.acceptFailure, isMac, state.acceptCopied),
    });
  }
  return notes;
}

function acceptFailureText(reason: AcceptFailure, isMac: boolean, copied: boolean): string {
  const ending = copied
    ? `The new text is copied. Paste it with ${isMac ? '⌘V' : 'Ctrl+V'}.`
    : 'Copying failed too. Select the new text in this popup and copy it.';
  if (reason === 'changed') {
    return `The text in the field changed since you selected it. ${ending}`;
  }
  return `This site did not accept the change. ${ending}`;
}
