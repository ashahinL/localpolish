import { useCallback, useEffect, useState } from 'preact/hooks';
import { type SavedChat } from '../core/chatHistory';
import { type ChatAttachment } from '../core/prompts';
import { LogoIcon } from '../popup/icons';
import { Composer } from './Composer';
import { Conversation } from './Conversation';
import { insertAnswer } from './insert';
import { History } from './History';
import { ModelPicker } from './ModelPicker';
import { watchPending, type PendingChat } from './pending';
import { useChat } from './useChat';
import { useChatSettings } from './useChatSettings';

function attached(attachment?: ChatAttachment): ChatAttachment | undefined {
  if (!attachment) return undefined;
  const { text, title, url } = attachment;
  return text || title || url ? attachment : undefined;
}

export function App() {
  const chatSettings = useChatSettings();
  const chat = useChat(chatSettings.saved);
  const { start } = chat;
  const [historyOpen, setHistoryOpen] = useState(false);
  // The tab the panel was opened for, kept for inserting answers into that page.
  const [entry, setEntry] = useState<PendingChat | undefined>(undefined);

  useEffect(
    () =>
      watchPending((pending) => {
        setEntry(pending);
        setHistoryOpen(false);
        start(attached(pending.attachment));
      }),
    [start],
  );

  const open = useCallback(
    (saved: SavedChat) => {
      setEntry(undefined);
      start(saved.attachment, { id: saved.id, turns: saved.turns });
      setHistoryOpen(false);
    },
    [start],
  );

  const newChat = useCallback(() => {
    setEntry(undefined);
    start();
    setHistoryOpen(false);
  }, [start]);

  const { conversation, status } = chat;

  return (
    <div class="panel" data-tab-id={entry?.tabId}>
      <header class="head">
        <div class="logo" aria-hidden="true">
          <LogoIcon />
        </div>
        <h1 class="brand">LocalPolish Chat</h1>
        <button
          type="button"
          class="sm"
          aria-pressed={historyOpen}
          disabled={chat.running}
          onClick={() => setHistoryOpen(!historyOpen)}
        >
          History
        </button>
        <button type="button" class="sm" onClick={newChat}>
          New chat
        </button>
      </header>
      <ModelPicker api={chatSettings} disabled={chat.running} />
      {historyOpen ? (
        <History onOpen={open} onDeleted={chat.forget} />
      ) : (
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
      )}
      {!historyOpen && (
        <Composer
          key={conversation.key}
          running={chat.running}
          onSend={chat.send}
          onStop={chat.stop}
        />
      )}
    </div>
  );
}
