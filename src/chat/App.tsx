import { useCallback, useEffect, useState } from 'preact/hooks';
import { type SavedChat } from '../core/chatHistory';
import { type ChatAttachment } from '../core/prompts';
import { HistoryIcon, LogoIcon, PlusIcon } from '../popup/icons';
import { Composer } from './Composer';
import { Conversation } from './Conversation';
import { insertAnswer } from './insert';
import { History } from './History';
import { ModelPicker } from './ModelPicker';
import { watchPending, type PendingChat } from './pending';
import { chatTitle, useChat } from './useChat';
import { useChatSettings } from './useChatSettings';

type View = { kind: 'chat' } | { kind: 'document'; id?: string };

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

  useEffect(
    () =>
      watchPending((pending) => {
        setEntry(pending);
        setHistoryOpen(false);
        if (pending.kind === 'document') {
          setView({ kind: 'document', id: pending.documentId });
          return;
        }
        setView({ kind: 'chat' });
        start(attached(pending.attachment));
      }),
    [start],
  );

  const open = useCallback(
    (saved: SavedChat) => {
      setEntry(undefined);
      setView({ kind: 'chat' });
      start(saved.attachment, { id: saved.id, turns: saved.turns });
      setHistoryOpen(false);
    },
    [start],
  );

  const newChat = useCallback(() => {
    setEntry(undefined);
    setView({ kind: 'chat' });
    start();
    setHistoryOpen(false);
  }, [start]);

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
          onClick={() => setHistoryOpen(!historyOpen)}
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
          onClick={() => {
            setEntry(undefined);
            setView({ kind: 'document' });
            setHistoryOpen(false);
          }}
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
          onOpenDocument={(id) => {
            setView({ kind: 'document', id });
            setHistoryOpen(false);
          }}
          onDocumentDeleted={(id) => {
            if (view.kind === 'document' && view.id === id) newChat();
          }}
        />
      ) : view.kind === 'document' ? (
        <section class="doc-placeholder" data-document-id={view.id}>
          <p class="empty muted">The document editor comes in the next update.</p>
        </section>
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
              setEntry(undefined);
              start({ text: answer, title: 'Previous answer', url: '' });
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
