import { useEffect, useRef, useState } from 'preact/hooks';
import { loadDocument, saveDocument } from '../core/documents';
import { ChatIcon } from '../popup/icons';
import { CopyButton, InsertButton } from './Conversation';
import { startDocumentFix } from './documentFix';
import { insertAnswer } from './insert';
import { MarkdownView } from './MarkdownView';
import { readChatTarget } from './pending';

const SAVE_DELAY_MS = 800;
const EMPTY: Draft = { title: '', body: '' };

interface Draft {
  title: string;
  body: string;
}

type Note =
  { kind: 'none' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'failed'; message: string };

interface Autosave {
  change(patch: Partial<Draft>): Draft;
  /** Saves any unsaved edit now. Resolves to false when the last save failed. */
  flush(): Promise<boolean>;
}

let fixStarted: Promise<unknown> | undefined;

// Fix adds document listeners it never removes, so it starts once per panel page.
function startFixOnce(): void {
  fixStarted ??= startDocumentFix(
    (el) => el instanceof HTMLTextAreaElement && el.classList.contains('d-text'),
  );
}

function createAutosave(
  draft: Draft,
  id: string | undefined,
  onNote: (note: Note) => void,
  onCreated: (id: string) => void,
): Autosave {
  let dirty = false;
  let ok = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Saves run one after another; each reads the newest draft when it starts.
  let queue: Promise<boolean> = Promise.resolve(true);

  const saveOnce = async (): Promise<boolean> => {
    const { title, body } = draft;
    // An empty new document is never created; an existing one is saved empty.
    if (id === undefined && !title.trim() && !body.trim()) {
      onNote({ kind: 'none' });
      return (ok = true);
    }
    onNote({ kind: 'saving' });
    try {
      const saved = await saveDocument({ id, title, body });
      if (id === undefined) {
        id = saved.id;
        onCreated(saved.id);
      }
      if (!dirty && timer === undefined) onNote({ kind: 'saved' });
      return (ok = true);
    } catch (error) {
      onNote({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
      return (ok = false);
    }
  };

  const flush = (): Promise<boolean> => {
    clearTimeout(timer);
    timer = undefined;
    if (!dirty) return queue.then(() => ok);
    dirty = false;
    queue = queue.then(saveOnce);
    return queue;
  };

  return {
    change(patch) {
      draft = { ...draft, ...patch };
      onNote({ kind: 'none' });
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
      return draft;
    },
    flush,
  };
}

function wordCount(body: string): number {
  return body.trim().split(/\s+/u).filter(Boolean).length;
}

function SaveNote({ note }: { note: Note }) {
  if (note.kind === 'failed')
    return (
      <span key="failed" class="grow failed" role="alert">
        Not saved: {note.message}
      </span>
    );
  return (
    <span class="grow">
      {note.kind === 'saving' ? 'Saving…' : note.kind === 'saved' ? 'Saved' : ''}
    </span>
  );
}

export function DocumentView({
  id,
  insertSequence,
  flushRef,
  onSaved,
  onAskInChat,
}: {
  id?: string;
  insertSequence?: string;
  flushRef: { current: (() => Promise<boolean>) | undefined };
  onSaved(id: string): void;
  onAskInChat(document: { title: string; body: string }): void;
}) {
  const [loaded, setLoaded] = useState<{ draft: Draft; missing: boolean } | undefined>();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [note, setNote] = useState<Note>({ kind: 'none' });
  const [preview, setPreview] = useState(false);
  const [canInsert, setCanInsert] = useState(false);
  const autosave = useRef<Autosave | undefined>(undefined);
  const savedCallback = useRef(onSaved);
  savedCallback.current = onSaved;

  useEffect(() => startFixOnce(), []);

  // Only the id the editor opened with is loaded; a later id comes from this editor's own save.
  useEffect(() => {
    let alive = true;
    const open = (start: Draft, savedId: string | undefined, missing: boolean) => {
      autosave.current = createAutosave(start, savedId, setNote, (newId) =>
        savedCallback.current(newId),
      );
      flushRef.current = autosave.current.flush;
      setDraft(start);
      setNote(savedId ? { kind: 'saved' } : { kind: 'none' });
      setLoaded({ draft: start, missing });
    };
    if (id === undefined) open(EMPTY, undefined, false);
    else
      void loadDocument(id).then(
        (found) => {
          if (!alive) return;
          if (found) open({ title: found.title, body: found.body }, found.id, false);
          else open(EMPTY, undefined, true);
        },
        () => alive && open(EMPTY, undefined, true),
      );
    return () => {
      alive = false;
      flushRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const flush = () => void autosave.current?.flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setCanInsert(false);
    if (insertSequence)
      readChatTarget(insertSequence).then(
        (target) => alive && setCanInsert(Boolean(target?.fieldId)),
        () => {},
      );
    return () => {
      alive = false;
    };
  }, [insertSequence]);

  const saver = autosave.current;
  if (!loaded || !saver) return <section class="doc" aria-busy="true" />;

  const edit = (patch: Partial<Draft>) => setDraft(saver.change(patch));
  const ask = async () => {
    if (await saver.flush()) onAskInChat(draft);
  };
  const words = wordCount(draft.body);

  return (
    <section class="doc">
      <div class="d-tools">
        <div class="seg sm" role="group" aria-label="View">
          <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>
            Edit
          </button>
          <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>
            Preview
          </button>
        </div>
        <div class="msg-actions">
          <CopyButton text={draft.body} />
          {canInsert && (
            <InsertButton
              text={draft.body}
              label="Insert"
              hint="Insert into the page field"
              onInsert={(text) => insertAnswer(insertSequence, text)}
            />
          )}
          <button
            type="button"
            class="act"
            title="Start a new chat with this document attached"
            disabled={!draft.body.trim()}
            onClick={() => void ask()}
          >
            <ChatIcon />
            <span class="lbl">Ask in chat</span>
          </button>
        </div>
      </div>
      <div class="d-body">
        {loaded.missing && (
          <div class="notice warn">
            <p>That document is no longer saved.</p>
          </div>
        )}
        <input
          class="d-title"
          type="text"
          aria-label="Title"
          placeholder="Untitled"
          dir="auto"
          defaultValue={loaded.draft.title}
          onInput={(event) => edit({ title: event.currentTarget.value })}
        />
        {/* Uncontrolled and hidden, never unmounted, so Fix's undo history survives Preview. */}
        <textarea
          class="d-text"
          aria-label="Document text"
          dir="auto"
          spellcheck
          hidden={preview}
          defaultValue={loaded.draft.body}
          onInput={(event) => edit({ body: event.currentTarget.value })}
        />
        {preview && (
          <div class="d-preview" dir="auto">
            <MarkdownView text={draft.body} />
          </div>
        )}
      </div>
      <footer class="d-foot">
        <SaveNote note={note} />
        <span>{words === 1 ? '1 word' : `${words} words`}</span>
      </footer>
    </section>
  );
}
