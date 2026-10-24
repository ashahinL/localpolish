import { useCallback, useEffect, useState } from 'preact/hooks';
import { deleteAllChats, deleteChat, listChats, type SavedChat } from '../core/chatHistory';
import { deleteDocument, listDocuments, type SavedDocument } from '../core/documents';
import { shortWhen } from '../core/when';
import { errorMessage } from '../options/chrome';
import { CloseIcon } from '../popup/icons';

type List = 'chats' | 'documents';

const ZONE = 'Africa/Cairo';
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE });

function byDay<T extends { updatedAt: number }>(items: T[]): Array<{ label: string; items: T[] }> {
  const today = DAY.format(Date.now());
  const groups = [
    { label: 'Today', items: items.filter((item) => DAY.format(item.updatedAt) === today) },
    { label: 'Earlier', items: items.filter((item) => DAY.format(item.updatedAt) !== today) },
  ];
  return groups.filter((group) => group.items.length > 0);
}

function Rows<T extends { id: string; updatedAt: number }>({
  items,
  render,
}: {
  items: T[];
  render(item: T): preact.JSX.Element;
}) {
  return (
    <>
      {byDay(items).map((group) => (
        <div key={group.label}>
          <h3 class="history-group">{group.label}</h3>
          <ul class="history-list">{group.items.map(render)}</ul>
        </div>
      ))}
    </>
  );
}

function Row({
  title,
  updatedAt,
  busy,
  onOpen,
  onDelete,
}: {
  title: string;
  updatedAt: number;
  busy: boolean;
  onOpen(): void;
  onDelete(): void;
}) {
  return (
    <>
      <button type="button" class="history-open" disabled={busy} onClick={onOpen}>
        <span class="history-title" dir="auto">
          {title}
        </span>
        <span class="history-when">{shortWhen(updatedAt)}</span>
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label={`Delete ${title}`}
        title="Delete"
        disabled={busy}
        onClick={onDelete}
      >
        <CloseIcon />
      </button>
    </>
  );
}

export function History({
  initialList,
  onOpen,
  onDeleted,
  onOpenDocument,
  onDocumentDeleted,
}: {
  initialList: List;
  onOpen(chat: SavedChat): void;
  /** Called with the deleted id, or with nothing after Delete all. */
  onDeleted(id?: string): void;
  onOpenDocument(id: string): void;
  onDocumentDeleted(id: string): void;
}) {
  const [list, setList] = useState<List>(initialList);
  const [chats, setChats] = useState<SavedChat[] | null>(null);
  const [documents, setDocuments] = useState<SavedDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async (which: List) => {
    try {
      if (which === 'chats') setChats(await listChats());
      else setDocuments(await listDocuments());
    } catch (err) {
      setError(
        `Could not load ${which === 'chats' ? 'history' : 'documents'}: ${errorMessage(err)}`,
      );
    }
  }, []);

  useEffect(() => {
    void load(list);
  }, [load, list]);

  const show = (next: List) => {
    if (next === list) return;
    setError(null);
    setConfirmAll(false);
    setConfirmId(null);
    setList(next);
  };

  const remove = async (id?: string) => {
    setBusy(true);
    setError(null);
    try {
      if (id === undefined) await deleteAllChats();
      else await deleteChat(id);
      onDeleted(id);
      setConfirmAll(false);
      await load('chats');
    } catch (err) {
      setError(`Could not delete: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const removeDocument = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await deleteDocument(id);
      setConfirmId(null);
      await load('documents');
      onDocumentDeleted(id);
    } catch (err) {
      setError(`Could not delete: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="history" aria-labelledby="history-h">
      <h2 id="history-h" class="sr-only">
        History
      </h2>
      <div class="history-head">
        <div class="seg sm hist-seg" role="group" aria-label="History lists">
          <button type="button" aria-pressed={list === 'chats'} onClick={() => show('chats')}>
            Chats
          </button>
          <button
            type="button"
            aria-pressed={list === 'documents'}
            onClick={() => show('documents')}
          >
            Documents
          </button>
        </div>
        {list === 'chats' && chats && chats.length > 0 && !confirmAll && (
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
      {list === 'chats' ? (
        <>
          {chats === null && !error && <p class="muted pad">Loading…</p>}
          {chats?.length === 0 && <p class="muted pad">No saved chats yet.</p>}
          {chats && (
            <Rows
              items={chats}
              render={(chat) => (
                <li key={chat.id}>
                  <Row
                    title={chat.title}
                    updatedAt={chat.updatedAt}
                    busy={busy}
                    onOpen={() => onOpen(chat)}
                    onDelete={() => void remove(chat.id)}
                  />
                </li>
              )}
            />
          )}
          <p class="help pad">Saved in this browser only. Up to 50 chats, kept for 30 days.</p>
        </>
      ) : (
        <>
          {documents === null && !error && <p class="muted pad">Loading…</p>}
          {documents?.length === 0 && <p class="muted pad">No documents yet.</p>}
          {documents && (
            <Rows
              items={documents}
              render={(document) => {
                const title = document.title || 'Untitled';
                return (
                  <li key={document.id}>
                    <Row
                      title={title}
                      updatedAt={document.updatedAt}
                      busy={busy}
                      onOpen={() => onOpenDocument(document.id)}
                      onDelete={() => setConfirmId(document.id)}
                    />
                    {confirmId === document.id && (
                      <div class="notice warn" role="alert">
                        <p>Delete "{title}"? This cannot be undone.</p>
                        <div class="notice-actions">
                          <button
                            type="button"
                            class="sm danger-fill"
                            disabled={busy}
                            onClick={() => void removeDocument(document.id)}
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            class="sm"
                            disabled={busy}
                            onClick={() => setConfirmId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              }}
            />
          )}
          <p class="help pad">Saved in this browser only. Kept until you delete them.</p>
        </>
      )}
    </section>
  );
}
