import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { type ChatAttachment, type ChatTurn } from '../core/prompts';
import { MarkdownView } from './MarkdownView';
import { type TurnStatus } from './useChat';

const COPIED_MS = 1500;
const SHORT_ATTACHMENT = 240;
// Within this many pixels of the end, new text keeps the view pinned to the bottom.
const PIN_PX = 48;

export function Attachment({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { text, title, url } = attachment;
  const long = text.length > SHORT_ATTACHMENT || text.split('\n').length > 4;
  return (
    <section class="attach" aria-label="Attached">
      <div class="attach-head">
        <span class="attach-label">{onRemove ? 'Attached' : 'Sent with this chat'}</span>
        {onRemove && (
          <button type="button" class="link" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      {title && <p class="attach-title">{title}</p>}
      {url && <p class="attach-url">{url}</p>}
      {text && <p class={open || !long ? 'attach-text' : 'attach-text clamp'}>{text}</p>}
      {text && long && (
        <button type="button" class="link" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show all text'}
        </button>
      )}
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), COPIED_MS);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => setState('copied'),
      () => setState('failed'),
    );
  };
  return (
    <button type="button" class="sm" onClick={copy}>
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
    </button>
  );
}

function InsertButton({ text, onInsert }: { text: string; onInsert(text: string): Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const insert = async () => {
    setBusy(true);
    setMessage('');
    try {
      await onInsert(text);
      setFailed(false);
      setMessage('Inserted into the text field.');
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : 'Could not insert. Use Copy instead.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        class="sm"
        title="Replace the last text field with this answer"
        disabled={busy}
        onClick={() => void insert()}
      >
        {busy ? 'Inserting…' : 'Insert into field'}
      </button>
      {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
    </>
  );
}

export function Conversation({
  turns,
  attachment,
  status,
  saveError,
  onRemoveAttachment,
  onInsert,
  onRetry,
  onNewChat,
  onNewChatWithAnswer,
}: {
  turns: ChatTurn[];
  attachment?: ChatAttachment;
  status: TurnStatus;
  saveError: string | null;
  onRemoveAttachment(): void;
  onInsert(text: string): Promise<void>;
  onRetry(): void;
  onNewChat(): void;
  onNewChatWithAnswer(answer: string): void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const partial = status.kind === 'running' ? status.partial : '';
  const unanswered = turns.at(-1)?.role === 'user';
  const lastAnswer = turns.findLast((turn) => turn.role === 'assistant')?.content;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [turns, partial, status.kind, saveError]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_PX;
  };

  return (
    <div class="conversation" ref={scroller} onScroll={onScroll}>
      {attachment && (
        <Attachment
          attachment={attachment}
          onRemove={turns.length === 0 ? onRemoveAttachment : undefined}
        />
      )}
      {turns.length === 0 && (
        <p class="empty muted">
          {attachment
            ? 'Ask about the attached text.'
            : 'Ask anything. Nothing is sent until you ask.'}
        </p>
      )}
      {turns.map((turn, index) =>
        turn.role === 'user' ? (
          <div key={index} class="turn user">
            <p>{turn.content}</p>
          </div>
        ) : (
          <div key={index} class="turn answer">
            <MarkdownView text={turn.content} />
            <div class="answer-actions">
              <CopyButton text={turn.content} />
              <InsertButton text={turn.content} onInsert={onInsert} />
            </div>
          </div>
        ),
      )}
      {status.kind === 'running' && (
        <div class="turn answer" aria-busy="true">
          {partial && <MarkdownView text={partial} />}
          <p class="writing muted" role="status">
            Writing…
          </p>
        </div>
      )}
      {status.kind === 'stopped' && unanswered && (
        <div class="notice">
          <p>Stopped.</p>
          <div class="notice-actions">
            <button type="button" class="sm" onClick={onRetry}>
              Retry
            </button>
          </div>
        </div>
      )}
      {status.kind === 'failed' && (
        <div class="notice error" role="alert">
          <p>{status.message}</p>
          <div class="notice-actions">
            {status.tooBig ? (
              lastAnswer !== undefined && (
                <button type="button" class="sm" onClick={() => onNewChatWithAnswer(lastAnswer)}>
                  New chat with last answer
                </button>
              )
            ) : (
              <button type="button" class="sm" onClick={onRetry}>
                Retry
              </button>
            )}
          </div>
        </div>
      )}
      {saveError && (
        <div class="notice warn" role="alert">
          <p>This chat was not saved to history. {saveError}</p>
          <div class="notice-actions">
            <button type="button" class="sm" onClick={onNewChat}>
              New chat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
