import { type ChatAttachment } from '../core/prompts';

export const pendingKey = (windowId: number): string => `chat-pending:${windowId}`;
export const targetKey = (windowId: number): string => `chat-target:${windowId}`;

export interface ChatTarget {
  sequence: string;
  tabId: number;
  frameId: number;
  insertFrameId?: number;
  fieldId?: string;
}

/** Written by the worker when an entry point opens the panel. */
export interface PendingChat {
  sequence: string;
  tabId: number;
  attachment?: ChatAttachment;
}

type StorageListener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => void;

interface SessionChrome {
  windows: { getCurrent(): Promise<{ id?: number }> };
  storage: {
    session: { get(key: string): Promise<Record<string, unknown>> };
    onChanged: {
      addListener(cb: StorageListener): void;
      removeListener(cb: StorageListener): void;
    };
  };
}

/** T23f can resolve the entry's tab and frame without reading rendered attributes. */
export async function readChatTarget(sequence: string): Promise<ChatTarget | undefined> {
  const ext = extension();
  const { id } = await ext.windows.getCurrent();
  if (id === undefined) return;
  const key = targetKey(id);
  const value = (await ext.storage.session.get(key))[key];
  if (
    isRecord(value) &&
    value.sequence === sequence &&
    typeof value.tabId === 'number' &&
    Number.isInteger(value.tabId) &&
    value.tabId >= 0 &&
    typeof value.frameId === 'number' &&
    Number.isInteger(value.frameId) &&
    value.frameId >= 0
  )
    return {
      sequence,
      tabId: value.tabId,
      frameId: value.frameId,
      ...(Number.isInteger(value.insertFrameId) &&
      (value.insertFrameId as number) >= 0 &&
      typeof value.fieldId === 'string' &&
      value.fieldId !== ''
        ? { insertFrameId: value.insertFrameId as number, fieldId: value.fieldId }
        : {}),
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
  let key: string | undefined;
  const take = (value: unknown) => {
    const pending = checkedPending(value);
    if (!alive || !pending || pending.sequence === last) return;
    last = pending.sequence;
    onPending(pending);
  };
  const listener: StorageListener = (changes, areaName) => {
    if (!key || areaName !== 'session' || !(key in changes)) return;
    changed = true;
    take(changes[key]!.newValue);
  };
  const storage = extension().storage;
  void extension()
    .windows.getCurrent()
    .then(async ({ id }) => {
      if (!alive || id === undefined) return;
      key = pendingKey(id);
      storage.onChanged.addListener(listener);
      const stored = await storage.session.get(key);
      // A change that arrived first is newer than this read.
      if (!changed) take(stored[key]);
    })
    .catch(() => {});
  return () => {
    alive = false;
    storage.onChanged.removeListener(listener);
  };
}
