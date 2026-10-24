import { type ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { CHAT_QUICK_ASKS } from '../core/prompts';
import { SendIcon, StopIcon } from '../popup/icons';

export function Composer({
  running,
  followUp,
  error,
  picker,
  onSend,
  onStop,
}: {
  running: boolean;
  followUp: boolean;
  error: string | null;
  picker: ComponentChildren;
  /** Returns false when the message was not sent, so the draft stays. */
  onSend(text: string): boolean;
  onStop(): void;
}) {
  const [draft, setDraft] = useState('');
  const empty = draft.trim() === '';

  const submit = () => {
    if (!empty && onSend(draft)) setDraft('');
  };

  return (
    <form
      class="c-foot"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div class="quick" role="group" aria-label="Quick asks">
        {CHAT_QUICK_ASKS.map((ask) => (
          <button
            key={ask.label}
            type="button"
            class="chip"
            disabled={running}
            onClick={() => onSend(ask.text)}
          >
            {ask.label}
          </button>
        ))}
      </div>
      {error && (
        <p class="notice error" role="alert">
          {error}
        </p>
      )}
      <div class="box">
        <textarea
          aria-label="Your question"
          placeholder={followUp ? 'Ask a follow-up' : 'Ask a question'}
          rows={2}
          value={draft}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
            event.preventDefault();
            submit();
          }}
        />
        <div class="box-row">
          {picker}
          {running ? (
            <button type="button" class="send stop" aria-label="Stop" onClick={onStop}>
              <StopIcon />
            </button>
          ) : (
            <button type="submit" class="send" aria-label="Send" disabled={empty}>
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
