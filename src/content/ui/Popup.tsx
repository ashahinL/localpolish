import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { wordDiff } from '../../core/diff';
import { placePopup, type Rect } from '../position';
import {
  canAccept,
  isUnchanged,
  popupNotes,
  tabOf,
  type Choice,
  type Note,
  type PopupState,
  type Tab,
  type View,
} from '../popupState';

const TABS: Array<[Tab, string]> = [
  ['fix', 'Fix'],
  ['rephrase', 'Rephrase'],
  ['shorter', 'Shorter'],
];

const VIEWS: Array<[View, string]> = [
  ['changes', 'Changes'],
  ['final', 'Final'],
];

const CHIPS: Array<[Choice, string]> = [
  ['rephrase:keep', 'Keep tone'],
  ['rephrase:polite', 'Polite'],
  ['rephrase:formal', 'Formal'],
  ['rephrase:casual', 'Casual'],
  ['rephrase:angry-civil', 'Angry but civil'],
];

function choiceLabel(choice: Choice): string {
  const tab = TABS.find(([value]) => value === choice);
  if (tab) return tab[1];
  return `Rephrase · ${CHIPS.find(([value]) => value === choice)?.[1] ?? ''}`;
}

export interface PopupProps {
  state: PopupState;
  anchor: Rect;
  isMac: boolean;
  onTab(tab: Tab): void;
  onChoice(choice: Choice): void;
  onView(view: View): void;
  onClose(): void;
  onAccept(): void;
  onCopy(): void;
  onRetry(): void;
}

export function Popup(props: PopupProps) {
  const { state, anchor, isMac } = props;
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const point = placePopup(
        anchor,
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      el.style.top = `${point.top}px`;
      el.style.left = `${point.left}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [anchor]);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  const ready = canAccept(state);
  const notes = popupNotes(state, isMac);
  // No pressed tab or chip names the shown answer, so the body says which one it is.
  const showCaption = tabOf(state.choice) !== state.tab;
  const showViews = state.phase === 'done' && !isUnchanged(state);

  return (
    <div class="lp-popup" ref={ref} role="dialog" aria-label="LocalPolish" tabIndex={-1}>
      <div class="lp-header">
        <div class="lp-tabs" role="group" aria-label="Mode">
          {TABS.map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              class="lp-tab"
              aria-pressed={state.tab === tab}
              onClick={() => props.onTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          class="lp-close"
          aria-label="Close"
          title="Close"
          onClick={props.onClose}
        >
          ×
        </button>
      </div>
      {state.tab === 'rephrase' && (
        <div class="lp-chips" role="group" aria-label="Tone">
          {CHIPS.map(([choice, label]) => (
            <button
              key={choice}
              type="button"
              class="lp-chip"
              aria-pressed={state.choice === choice}
              onClick={() => props.onChoice(choice)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {showViews && (
        <div class="lp-views" role="group" aria-label="View">
          {VIEWS.map(([view, label]) => (
            <button
              key={view}
              type="button"
              class="lp-view"
              aria-pressed={state.view === view}
              onClick={() => props.onView(view)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div class="lp-body">
        {showCaption && <p class="lp-caption">Showing: {choiceLabel(state.choice)}</p>}
        <Body state={state} />
      </div>
      {notes.length > 0 && (
        <div class="lp-notes">
          {notes.map((note, index) => (
            <NoteLine key={index} note={note} />
          ))}
        </div>
      )}
      <div class="lp-footer">
        <button
          type="button"
          class="lp-button lp-primary"
          disabled={!ready}
          onClick={props.onAccept}
        >
          Accept
        </button>
        <button type="button" class="lp-button" disabled={!ready} onClick={props.onCopy}>
          {state.copy === 'copied' ? 'Copied' : state.copy === 'failed' ? 'Copy failed' : 'Copy'}
        </button>
        <button type="button" class="lp-button" onClick={props.onRetry}>
          Retry
        </button>
        <span class="lp-hint">Esc to close · {isMac ? '⌘↵' : 'Ctrl+↵'} to accept</span>
      </div>
    </div>
  );
}

function Body({ state }: { state: PopupState }) {
  if (state.phase === 'error') {
    return (
      <p class="lp-error" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.phase === 'streaming') {
    return (
      <>
        {state.streamed !== '' && <div class="lp-text">{state.streamed}</div>}
        <div class="lp-working" role="status">
          <span class="lp-dot" aria-hidden="true" />
          Working…
        </div>
      </>
    );
  }
  if (isUnchanged(state)) return <p class="lp-muted">No changes needed.</p>;
  if (state.view === 'final') return <div class="lp-text lp-final">{state.result}</div>;
  return (
    <div class="lp-text lp-diff">
      {wordDiff(state.input, state.result).map((part, index) => {
        if (part.type === 'add') return <ins key={index}>{part.text}</ins>;
        if (part.type === 'del') return <del key={index}>{part.text}</del>;
        return <span key={index}>{part.text}</span>;
      })}
    </div>
  );
}

function NoteLine({ note }: { note: Note }) {
  if (note.kind === 'count') {
    return <p class={note.over ? 'lp-note lp-count lp-over' : 'lp-note lp-count'}>{note.text}</p>;
  }
  if (note.kind === 'missing') {
    return (
      <p class="lp-note lp-warning">
        Missing from the new text:{' '}
        {note.tokens.map((token) => (
          <code key={token}>{token}</code>
        ))}
      </p>
    );
  }
  return <p class="lp-note lp-warning">{note.text}</p>;
}
