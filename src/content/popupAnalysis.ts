import { wordDiff, type DiffPart } from '../core/diff';
import { answerNotes, type Choice, type Note, type PopupState } from './popupState';

/** Work for one completed answer: static notes now, the word diff on first use. */
export interface Answer {
  readonly notes: readonly Note[];
  diff(): DiffPart[];
}

interface Entry extends Answer {
  input: string;
  result: string;
}

export interface PopupAnalysis {
  /** The shown completed answer, or null while streaming or after an error. */
  answer(state: PopupState): Answer | null;
  clear(): void;
}

/**
 * Holds at most one entry per choice, only while `state.cache` still has that exact answer.
 * A retry, a new request or a different input drops the entry on the next lookup.
 */
export function createPopupAnalysis(): PopupAnalysis {
  const entries = new Map<Choice, Entry>();

  return {
    answer(state) {
      for (const [choice, entry] of entries) {
        if (entry.input !== state.input || entry.result !== state.cache[choice]) {
          entries.delete(choice);
        }
      }
      if (state.phase !== 'done') return null;
      let entry = entries.get(state.choice);
      if (!entry) {
        const { input, result } = state;
        let parts: DiffPart[] | undefined;
        entry = {
          input,
          result,
          notes: answerNotes(input, result, state.choice),
          diff: () => (parts ??= wordDiff(input, result)),
        };
        entries.set(state.choice, entry);
      }
      return entry;
    },
    clear() {
      entries.clear();
    },
  };
}
