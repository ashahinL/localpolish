import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { wordDiff } from '../../core/diff';
import { type Mode, type Tone } from '../../core/settings';
import { placePopup, type Rect } from '../position';
import { canAccept, isUnchanged, popupNotes, type Note, type PopupState } from '../popupState';

const MODES: Array<[Mode, string]> = [
  ['fix', 'Fix'],
  ['rephrase', 'Rephrase'],
  ['shorter', 'Shorter'],
  ['tone', 'Tone'],
];

const TONES: Array<[Tone, string]> = [
  ['polite', 'Polite'],
  ['formal', 'Formal'],
  ['casual', 'Casual'],
  ['angry-civil', 'Angry but civil'],
];

export interface PopupProps {
  state: PopupState;
  anchor: Rect;
  isMac: boolean;
  onMode(mode: Mode): void;
  onTone(tone: Tone): void;
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

  return (
    <div class="lp-popup" ref={ref} role="dialog" aria-label="LocalPolish" tabIndex={-1}>
      <div class="lp-header">
        <div class="lp-tabs" role="group" aria-label="Mode">
          {MODES.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              class="lp-tab"
              aria-pressed={state.mode === mode}
              onClick={() => props.onMode(mode)}
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
      {state.mode === 'tone' && (
        <div class="lp-chips" role="group" aria-label="Tone">
          {TONES.map(([tone, label]) => (
            <button
              key={tone}
              type="button"
              class="lp-chip"
              aria-pressed={state.tone === tone}
              onClick={() => props.onTone(tone)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div class="lp-body">
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
          {state.copied ? 'Copied' : 'Copy'}
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
