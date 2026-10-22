import { useState } from 'preact/hooks';
import { CHAT_QUICK_ASKS } from '../core/prompts';

export function Composer({
  running,
  onSend,
  onStop,
}: {
  running: boolean;
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
      class="composer"
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
            class="sm chip"
            disabled={running}
            onClick={() => onSend(ask.text)}
          >
            {ask.label}
          </button>
        ))}
      </div>
      <div class="compose-row">
        <textarea
          aria-label="Your question"
          placeholder="Ask a question"
          rows={1}
          value={draft}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
            event.preventDefault();
            submit();
          }}
        />
        {running ? (
          <button type="button" class="stop" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="submit" class="primary" disabled={empty}>
            Send
          </button>
        )}
      </div>
    </form>
  );
}
