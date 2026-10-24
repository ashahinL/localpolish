import type { ChatAttachment, ChatTurn } from './prompts';
import { createStorageLock } from './storageLock';

export interface SavedChat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: ChatTurn[];
  attachment?: ChatAttachment;
}

export interface SaveChatInput {
  id?: string;
  title: string;
  turns: ChatTurn[];
  attachment?: ChatAttachment;
}

const STORAGE_KEY = 'chat-history';
const MAX_CHATS = 50;
const MAX_RECORD_BYTES = 128 * 1024;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface ChromeStorageLocal {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

function storageLocal(): ChromeStorageLocal {
  return (globalThis as unknown as { chrome: { storage: { local: ChromeStorageLocal } } }).chrome
    .storage.local;
}

const withHistoryLock = createStorageLock('localpolish-chat-history');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function recordBytes(chat: SavedChat): number {
  return new TextEncoder().encode(JSON.stringify(chat)).byteLength;
}

function checkedChat(value: unknown): SavedChat | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.title !== 'string' ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt) ||
    value.createdAt > value.updatedAt ||
    !Array.isArray(value.turns)
  ) {
    return undefined;
  }
  const turns: ChatTurn[] = [];
  for (const turn of value.turns) {
    if (
      !isRecord(turn) ||
      (turn.role !== 'user' && turn.role !== 'assistant') ||
      typeof turn.content !== 'string'
    ) {
      return undefined;
    }
    turns.push({ role: turn.role, content: turn.content });
  }
  const chat: SavedChat = {
    id: value.id,
    title: value.title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    turns,
  };
  if (value.attachment !== undefined) {
    const attachment = value.attachment;
    if (
      !isRecord(attachment) ||
      typeof attachment.text !== 'string' ||
      typeof attachment.title !== 'string' ||
      typeof attachment.url !== 'string'
    ) {
      return undefined;
    }
    chat.attachment = { text: attachment.text, title: attachment.title, url: attachment.url };
  }
  return recordBytes(chat) <= MAX_RECORD_BYTES ? chat : undefined;
}

async function readChats(now: number): Promise<SavedChat[]> {
  const stored = (await storageLocal().get(STORAGE_KEY))[STORAGE_KEY];
  if (!Array.isArray(stored)) return [];
  const chats = new Map<string, SavedChat>();
  for (const value of stored) {
    const chat = checkedChat(value);
    if (!chat || chat.updatedAt <= now - MAX_AGE_MS) continue;
    const previous = chats.get(chat.id);
    if (!previous || chat.updatedAt > previous.updatedAt) chats.set(chat.id, chat);
  }
  return [...chats.values()].sort(
    (a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export async function listChats(): Promise<SavedChat[]> {
  return readChats(Date.now());
}

export async function openChat(id: string): Promise<SavedChat | undefined> {
  return (await listChats()).find((chat) => chat.id === id);
}

export function saveChat(input: SaveChatInput): Promise<SavedChat> {
  return withHistoryLock(async () => {
    const now = Date.now();
    const chats = await readChats(now);
    const previous =
      input.id === undefined ? undefined : chats.find((chat) => chat.id === input.id);
    if (input.id !== undefined && !previous) {
      throw new Error('This chat no longer exists. Save it as a new chat.');
    }
    const saved: SavedChat = {
      id: input.id ?? crypto.randomUUID(),
      title: input.title,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      turns: input.turns.map(({ role, content }) => ({ role, content })),
    };
    if (input.attachment !== undefined) {
      const { text, title, url } = input.attachment;
      saved.attachment = { text, title, url };
    }
    if (recordBytes(saved) > MAX_RECORD_BYTES) {
      throw new Error('This chat exceeds the 128 KiB history save limit.');
    }
    const next = [saved, ...chats.filter((chat) => chat.id !== saved.id)].sort(
      (a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    await storageLocal().set({ [STORAGE_KEY]: next.slice(0, MAX_CHATS) });
    return structuredClone(saved);
  });
}

export function deleteChat(id: string): Promise<void> {
  return withHistoryLock(async () => {
    const chats = await readChats(Date.now());
    await storageLocal().set({ [STORAGE_KEY]: chats.filter((chat) => chat.id !== id) });
  });
}

export function deleteAllChats(): Promise<void> {
  return withHistoryLock(() => storageLocal().remove(STORAGE_KEY));
}

export function pruneChats(): Promise<void> {
  return withHistoryLock(async () => {
    const chats = await readChats(Date.now());
    await storageLocal().set({ [STORAGE_KEY]: chats.slice(0, MAX_CHATS) });
  });
}
