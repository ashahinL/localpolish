import { useCallback, useEffect, useState } from 'preact/hooks';
import { deleteAllChats, deleteChat, listChats, type SavedChat } from '../core/chatHistory';
import { errorMessage } from '../options/chrome';
import { CloseIcon } from '../popup/icons';

const WHEN = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Africa/Cairo',
});

export function History({
  onOpen,
  onDeleted,
}: {
  onOpen(chat: SavedChat): void;
  /** Called with the deleted id, or with nothing after Delete all. */
  onDeleted(id?: string): void;
}) {
  const [chats, setChats] = useState<SavedChat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    try {
      setChats(await listChats());
    } catch (err) {
      setError(`Could not load history: ${errorMessage(err)}`);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id?: string) => {
    setBusy(true);
    setError(null);
    try {
      if (id === undefined) await deleteAllChats();
      else await deleteChat(id);
      onDeleted(id);
      setConfirmAll(false);
      await load();
    } catch (err) {
      setError(`Could not delete: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="history" aria-labelledby="history-h">
      <div class="history-head">
        <h2 id="history-h">History</h2>
        {chats && chats.length > 0 && !confirmAll && (
          <button
            type="button"
            class="link danger"
            disabled={busy}
            onClick={() => setConfirmAll(true)}
          >
            Delete all
          </button>
        )}
      </div>
      {confirmAll && (
        <div class="notice warn" role="alert">
          <p>Delete every saved chat?</p>
          <div class="notice-actions">
            <button
              type="button"
              class="sm danger-fill"
              disabled={busy}
              onClick={() => void remove()}
            >
              Delete all
            </button>
            <button type="button" class="sm" disabled={busy} onClick={() => setConfirmAll(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p class="notice error" role="alert">
          {error}
        </p>
      )}
      {chats === null && !error && <p class="muted pad">Loading…</p>}
      {chats?.length === 0 && <p class="muted pad">No saved chats yet.</p>}
      {chats && chats.length > 0 && (
        <ul class="history-list">
          {chats.map((chat) => (
            <li key={chat.id}>
              <button
                type="button"
                class="history-open"
                disabled={busy}
                onClick={() => onOpen(chat)}
              >
                <span class="history-title">{chat.title}</span>
                <span class="history-when">{WHEN.format(chat.updatedAt)}</span>
              </button>
              <button
                type="button"
                class="icon-btn"
                aria-label={`Delete ${chat.title}`}
                title="Delete"
                disabled={busy}
                onClick={() => void remove(chat.id)}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p class="help pad">Saved in this browser only. Up to 50 chats, kept for 30 days.</p>
    </section>
  );
}
