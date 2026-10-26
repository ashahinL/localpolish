import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { type SavedChat } from '../core/chatHistory';
import { type ChatAttachment } from '../core/prompts';
import { HistoryIcon, LogoIcon, PlusIcon } from '../popup/icons';
import { Composer } from './Composer';
import { Conversation } from './Conversation';
import { DocumentView } from './DocumentView';
import { insertAnswer } from './insert';
import { History } from './History';
import { ModelPicker } from './ModelPicker';
import { watchPending, type PendingChat } from './pending';
import { chatTitle, useChat } from './useChat';
import { useChatSettings } from './useChatSettings';

// `editor` changes only when another document opens, so a first save does not remount the editor.
type View = { kind: 'chat' } | { kind: 'document'; id?: string; editor: number };

function attached(attachment?: ChatAttachment): ChatAttachment | undefined {
  if (!attachment) return undefined;
  const { text, title, url } = attachment;
  return text || title || url ? attachment : undefined;
}

export function App() {
  const chatSettings = useChatSettings();
  const chat = useChat(chatSettings.saved);
  const { start } = chat;
  const [view, setView] = useState<View>({ kind: 'chat' });
  const [historyOpen, setHistoryOpen] = useState(false);
  // The tab the panel was opened for, kept for inserting answers into that page.
  const [entry, setEntry] = useState<PendingChat | undefined>(undefined);
  const editors = useRef(0);
  const flushRef = useRef<(() => Promise<boolean>) | undefined>(undefined);
  const leaving = useRef(false);

  const leave = useCallback((next: () => void) => {
    if (leaving.current) return;
    const flush = flushRef.current;
    if (!flush) {
      next();
      return;
    }
    leaving.current = true;
    void flush()
      .then((ok) => {
        if (ok) next();
      })
      .finally(() => {
        leaving.current = false;
      });
  }, []);

  const openDocument = useCallback((id?: string) => {
    editors.current += 1;
    setView({ kind: 'document', id, editor: editors.current });
    setHistoryOpen(false);
  }, []);

  useEffect(
    () =>
      watchPending((pending) =>
        leave(() => {
          setEntry(pending);
          setHistoryOpen(false);
          if (pending.kind === 'document') {
            openDocument(pending.documentId);
            return;
          }
          setView({ kind: 'chat' });
          start(attached(pending.attachment));
        }),
      ),
    [start, openDocument, leave],
  );

  const open = useCallback(
    (saved: SavedChat) => {
      leave(() => {
        setEntry(undefined);
        setView({ kind: 'chat' });
        start(saved.attachment, { id: saved.id, turns: saved.turns });
        setHistoryOpen(false);
      });
    },
    [start, leave],
  );

  const newChat = useCallback(() => {
    leave(() => {
      setEntry(undefined);
      setView({ kind: 'chat' });
      start();
      setHistoryOpen(false);
    });
  }, [start, leave]);

  const { conversation, status } = chat;
  const title =
    view.kind === 'document'
      ? 'Document'
      : conversation.turns.some((turn) => turn.role === 'user')
        ? chatTitle(conversation.turns, conversation.attachment)
        : 'New chat';

  return (
    <div class="panel" data-tab-id={entry?.tabId}>
      <header class="c-head">
        <div class="logo" aria-hidden="true">
          <LogoIcon />
        </div>
        <h1 class="c-title" dir="auto">
          {title}
        </h1>
        <button
          type="button"
          class="icon-btn"
          aria-label="History"
          title="History"
          aria-pressed={historyOpen}
          disabled={chat.running}
          onClick={() => leave(() => setHistoryOpen(!historyOpen))}
        >
          <HistoryIcon />
        </button>
        <button type="button" class="c-new" aria-label="New chat" onClick={newChat}>
          <PlusIcon />
          Chat
        </button>
        <button
          type="button"
          class="c-new alt"
          aria-label="New document"
          onClick={() => leave(() => openDocument())}
        >
          <PlusIcon />
          Doc
        </button>
      </header>
      {historyOpen ? (
        <History
          initialList={view.kind === 'document' ? 'documents' : 'chats'}
          onOpen={open}
          onDeleted={chat.forget}
          onOpenDocument={(id) => leave(() => openDocument(id))}
          onDocumentDeleted={(id) => {
            if (view.kind === 'document' && view.id === id) newChat();
          }}
        />
      ) : view.kind === 'document' ? (
        <DocumentView
          key={view.editor}
          id={view.id}
          insertSequence={entry?.sequence}
          flushRef={flushRef}
          onSaved={(id) => {
            const { editor } = view;
            setView((current) =>
              current.kind === 'document' && current.editor === editor
                ? { ...current, id }
                : current,
            );
          }}
          onAskInChat={({ title, body }) => {
            leave(() => {
              setView({ kind: 'chat' });
              start({ text: body, title: title || 'Untitled', url: '' });
            });
          }}
        />
      ) : (
        <>
          <Conversation
            key={conversation.key}
            turns={conversation.turns}
            attachment={conversation.attachment}
            status={status}
            saveError={chat.saveError}
            onInsert={(answer) => insertAnswer(entry?.sequence, answer)}
            onRemoveAttachment={chat.removeAttachment}
            onRetry={chat.retry}
            onNewChat={newChat}
            onNewChatWithAnswer={(answer) => {
              leave(() => {
                setEntry(undefined);
                start({ text: answer, title: 'Previous answer', url: '' });
              });
            }}
          />
          <Composer
            key={conversation.key}
            running={chat.running}
            followUp={conversation.turns.length > 0}
            error={chatSettings.error}
            picker={<ModelPicker api={chatSettings} disabled={chat.running} />}
            onSend={chat.send}
            onStop={chat.stop}
          />
        </>
      )}
    </div>
  );
}
