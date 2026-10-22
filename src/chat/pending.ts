import { type ChatAttachment } from '../core/prompts';

export const PENDING_KEY = 'chat-pending';

/** Written by the worker when an entry point opens the panel. */
export interface PendingChat {
  sequence: string;
  tabId: number;
  attachment?: ChatAttachment;
}

type StorageListener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => void;

interface SessionChrome {
  storage: {
    session: { get(key: string): Promise<Record<string, unknown>> };
    onChanged: {
      addListener(cb: StorageListener): void;
      removeListener(cb: StorageListener): void;
    };
  };
}

function extension(): SessionChrome {
  return (globalThis as unknown as { chrome: SessionChrome }).chrome;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function checkedPending(value: unknown): PendingChat | undefined {
  if (
    !isRecord(value) ||
    typeof value.sequence !== 'string' ||
    value.sequence === '' ||
    typeof value.tabId !== 'number' ||
    !Number.isInteger(value.tabId)
  ) {
    return undefined;
  }
  const pending: PendingChat = { sequence: value.sequence, tabId: value.tabId };
  const attachment = value.attachment;
  if (attachment === undefined) return pending;
  if (
    !isRecord(attachment) ||
    typeof attachment.text !== 'string' ||
    typeof attachment.title !== 'string' ||
    typeof attachment.url !== 'string'
  ) {
    return undefined;
  }
  pending.attachment = { text: attachment.text, title: attachment.title, url: attachment.url };
  return pending;
}

/** Calls back with the stored entry once, then with each new one. Returns a stop function. */
export function watchPending(onPending: (pending: PendingChat) => void): () => void {
  let alive = true;
  let last: string | undefined;
  let changed = false;
  const take = (value: unknown) => {
    const pending = checkedPending(value);
    if (!alive || !pending || pending.sequence === last) return;
    last = pending.sequence;
    onPending(pending);
  };
  const listener: StorageListener = (changes, areaName) => {
    if (areaName !== 'session' || !(PENDING_KEY in changes)) return;
    changed = true;
    take(changes[PENDING_KEY]!.newValue);
  };
  const storage = extension().storage;
  storage.onChanged.addListener(listener);
  storage.session.get(PENDING_KEY).then(
    // A change that arrived first is newer than this read.
    (stored) => changed || take(stored[PENDING_KEY]),
    () => undefined,
  );
  return () => {
    alive = false;
    storage.onChanged.removeListener(listener);
  };
}
