import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { saveChat } from '../core/chatHistory';
import { CHAT_TOO_BIG } from '../core/messages';
import { type ChatAttachment, type ChatTurn } from '../core/prompts';
import { errorMessage } from '../options/chrome';
import { sendChat } from './transport';

const TITLE_CHARS = 80;

export interface Conversation {
  /** Changes for every new or opened chat, so late results from an old chat are dropped. */
  key: number;
  turns: ChatTurn[];
  attachment?: ChatAttachment;
  /** The history id, shared by this chat's saves. */
  record: { id?: string };
}

export type TurnStatus =
  | { kind: 'idle' }
  | { kind: 'running'; partial: string }
  | { kind: 'stopped' }
  | { kind: 'failed'; message: string; tooBig: boolean };

export interface ChatApi {
  conversation: Conversation;
  status: TurnStatus;
  saveError: string | null;
  running: boolean;
  send(text: string): boolean;
  retry(): void;
  stop(): void;
  start(attachment?: ChatAttachment, opened?: { id: string; turns: ChatTurn[] }): void;
  removeAttachment(): void;
  forget(id?: string): void;
}

let nextKey = 1;

function fresh(attachment?: ChatAttachment, opened?: { id: string; turns: ChatTurn[] }) {
  return {
    key: nextKey++,
    turns: opened?.turns ?? [],
    attachment,
    record: { id: opened?.id },
  };
}

export function chatTitle(turns: readonly ChatTurn[], attachment?: ChatAttachment): string {
  const first = turns.find((turn) => turn.role === 'user')?.content.trim() ?? 'Chat';
  const line = first.split('\n')[0]!;
  const ask = line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1)}…` : line;
  return attachment?.title ? `${ask} · ${attachment.title}` : ask;
}

export function useChat(beforeSend: () => Promise<void>): ChatApi {
  const [conversation, setConversation] = useState<Conversation>(() => fresh());
  const [status, setStatus] = useState<TurnStatus>({ kind: 'idle' });
  const [saveError, setSaveError] = useState<string | null>(null);
  const current = useRef(conversation);
  const active = useRef<AbortController | undefined>(undefined);
  const saves = useRef<Promise<void>>(Promise.resolve());

  const show = useCallback((next: Conversation) => {
    current.current = next;
    setConversation(next);
  }, []);

  const cancel = useCallback(() => {
    active.current?.abort();
    active.current = undefined;
  }, []);

  useEffect(() => cancel, [cancel]);

  // Saves run one at a time, so a chat's second save reuses the id from its first.
  const save = useCallback((chat: Conversation) => {
    const { key, record, turns, attachment } = chat;
    saves.current = saves.current.then(async () => {
      try {
        const saved = await saveChat({
          id: record.id,
          title: chatTitle(turns, attachment),
          turns,
          attachment,
        });
        record.id = saved.id;
        if (current.current.key === key) setSaveError(null);
      } catch (err) {
        if (current.current.key === key) setSaveError(errorMessage(err));
      }
    });
  }, []);

  const run = useCallback(
    async (chat: Conversation) => {
      const controller = new AbortController();
      active.current = controller;
      setStatus({ kind: 'running', partial: '' });
      let partial = '';
      let frame: number | undefined;
      const onChunk = (text: string) => {
        partial += text;
        frame ??= requestAnimationFrame(() => {
          frame = undefined;
          if (active.current === controller) setStatus({ kind: 'running', partial });
        });
      };
      try {
        await beforeSend();
      } catch (err) {
        if (active.current !== controller) return;
        active.current = undefined;
        setStatus({
          kind: 'failed',
          message: `The chat settings were not saved, so nothing was sent. ${errorMessage(err)}`,
          tooBig: false,
        });
        return;
      }
      const outcome = await sendChat(
        { turns: chat.turns, ...(chat.attachment ? { attachment: chat.attachment } : {}) },
        onChunk,
        controller.signal,
      );
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (active.current !== controller || outcome === undefined) return;
      active.current = undefined;
      if (outcome.type === 'error') {
        setStatus({
          kind: 'failed',
          message: outcome.message,
          tooBig: outcome.code === CHAT_TOO_BIG,
        });
        return;
      }
      const done: Conversation = {
        ...chat,
        turns: [...chat.turns, { role: 'assistant', content: outcome.text }],
      };
      show(done);
      setStatus({ kind: 'idle' });
      save(done);
    },
    [beforeSend, save, show],
  );

  const send = useCallback(
    (text: string): boolean => {
      if (active.current || text.trim() === '') return false;
      const chat = current.current;
      // A failed or stopped question is replaced, so turns keep alternating.
      const answered = chat.turns.at(-1)?.role === 'user' ? chat.turns.slice(0, -1) : chat.turns;
      const next = { ...chat, turns: [...answered, { role: 'user' as const, content: text }] };
      show(next);
      void run(next);
      return true;
    },
    [run, show],
  );

  const retry = useCallback(() => {
    const chat = current.current;
    if (active.current || chat.turns.at(-1)?.role !== 'user') return;
    void run(chat);
  }, [run]);

  const stop = useCallback(() => {
    if (!active.current) return;
    cancel();
    setStatus({ kind: 'stopped' });
  }, [cancel]);

  const start = useCallback(
    (attachment?: ChatAttachment, opened?: { id: string; turns: ChatTurn[] }) => {
      cancel();
      show(fresh(attachment, opened));
      setStatus({ kind: 'idle' });
      setSaveError(null);
    },
    [cancel, show],
  );

  const removeAttachment = useCallback(() => {
    const chat = current.current;
    if (chat.turns.length > 0 || !chat.attachment) return;
    show({ ...chat, attachment: undefined });
  }, [show]);

  // After a history delete, the next save of an open deleted chat starts a new record.
  const forget = useCallback((id?: string) => {
    const record = current.current.record;
    if (id === undefined || record.id === id) record.id = undefined;
  }, []);

  return {
    conversation,
    status,
    saveError,
    running: status.kind === 'running',
    send,
    retry,
    stop,
    start,
    removeAttachment,
    forget,
  };
}
