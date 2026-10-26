import { createStorageLock } from './storageLock';

export interface SavedDocument {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface SaveDocumentInput {
  id?: string;
  title: string;
  body: string;
}

const STORAGE_KEY = 'documents';
const MAX_RECORD_BYTES = 128 * 1024;

interface ChromeStorageLocal {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function storageLocal(): ChromeStorageLocal {
  return (globalThis as unknown as { chrome: { storage: { local: ChromeStorageLocal } } }).chrome
    .storage.local;
}

const withDocumentsLock = createStorageLock('localpolish-documents');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The last moment a JavaScript Date can hold. */
const MAX_TIMESTAMP = 8.64e15;

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= MAX_TIMESTAMP;
}

function recordBytes(document: SavedDocument): number {
  return new TextEncoder().encode(JSON.stringify(document)).byteLength;
}

function checkedDocument(value: unknown): SavedDocument | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.title !== 'string' ||
    typeof value.body !== 'string' ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt) ||
    value.createdAt > value.updatedAt
  ) {
    return undefined;
  }
  const document: SavedDocument = {
    id: value.id,
    title: value.title,
    body: value.body,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
  return recordBytes(document) <= MAX_RECORD_BYTES ? document : undefined;
}

async function readDocuments(): Promise<SavedDocument[]> {
  const stored = (await storageLocal().get(STORAGE_KEY))[STORAGE_KEY];
  if (!Array.isArray(stored)) return [];
  const documents = new Map<string, SavedDocument>();
  for (const value of stored) {
    const document = checkedDocument(value);
    if (!document) continue;
    const previous = documents.get(document.id);
    if (!previous || document.updatedAt > previous.updatedAt) documents.set(document.id, document);
  }
  return [...documents.values()].sort(
    (a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export async function listDocuments(): Promise<SavedDocument[]> {
  return readDocuments();
}

export async function loadDocument(id: string): Promise<SavedDocument | undefined> {
  return (await readDocuments()).find((document) => document.id === id);
}

export function saveDocument(input: SaveDocumentInput): Promise<SavedDocument> {
  return withDocumentsLock(async () => {
    const now = Date.now();
    const documents = await readDocuments();
    const previous =
      input.id === undefined ? undefined : documents.find((document) => document.id === input.id);
    const saved: SavedDocument = {
      id: input.id ?? crypto.randomUUID(),
      title: input.title,
      body: input.body,
      createdAt: previous?.createdAt ?? now,
      updatedAt: Math.max(now, previous?.createdAt ?? now),
    };
    if (recordBytes(saved) > MAX_RECORD_BYTES) {
      throw new Error('This document is over the 128 KiB save limit. Split it into two documents.');
    }
    const next = [saved, ...documents.filter((document) => document.id !== saved.id)].sort(
      (a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    await storageLocal().set({ [STORAGE_KEY]: next });
    return structuredClone(saved);
  });
}

export function deleteDocument(id: string): Promise<void> {
  return withDocumentsLock(async () => {
    const documents = await readDocuments();
    await storageLocal().set({
      [STORAGE_KEY]: documents.filter((document) => document.id !== id),
    });
  });
}
