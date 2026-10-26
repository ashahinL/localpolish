import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteDocument,
  listDocuments,
  loadDocument,
  saveDocument,
  type SavedDocument,
} from './documents';

const NOW = 1_800_000_000_000;
const MONTH = 30 * 24 * 60 * 60 * 1000;
const CAP = 128 * 1024;
const KEY = 'documents';
const LIMIT_MESSAGE = 'This document is over the 128 KiB save limit. Split it into two documents.';
let stored: Map<string, unknown>;
let get: ReturnType<typeof vi.fn>;
let set: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;
let uuid = 0;

function record(patch: Partial<SavedDocument> = {}): SavedDocument {
  return {
    id: 'doc-0001',
    title: 'Example',
    body: 'Plain text',
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  uuid = 0;
  vi.stubGlobal('crypto', { randomUUID: () => `doc-${String(++uuid).padStart(4, '0')}` });
  vi.stubGlobal('navigator', {});
  stored = new Map();
  get = vi.fn(async (key: string) => ({ [key]: structuredClone(stored.get(key)) }));
  set = vi.fn(async (items: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(items)) stored.set(key, structuredClone(value));
  });
  remove = vi.fn(async (key: string) => {
    stored.delete(key);
  });
  vi.stubGlobal('chrome', { storage: { local: { get, set, remove } } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('documents', () => {
  it('saves an empty title and body', async () => {
    const saved = await saveDocument({ title: '', body: '' });
    expect(saved).toEqual({
      id: 'doc-0001',
      title: '',
      body: '',
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(await listDocuments()).toEqual([
      {
        id: 'doc-0001',
        title: '',
        body: '',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
  });

  it('saves a document and lists a later save first', async () => {
    expect(await listDocuments()).toEqual([]);
    const first = await saveDocument({ title: 'First', body: 'one' });
    expect(first).toEqual({
      id: 'doc-0001',
      title: 'First',
      body: 'one',
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(await listDocuments()).toEqual([first]);
    expect(await loadDocument('doc-0001')).toEqual(first);
    expect(await loadDocument('missing')).toBeUndefined();

    vi.setSystemTime(NOW + 1);
    const second = await saveDocument({ title: 'Second', body: 'two' });
    expect(second).toEqual({
      id: 'doc-0002',
      title: 'Second',
      body: 'two',
      createdAt: NOW + 1,
      updatedAt: NOW + 1,
    });
    expect(await listDocuments()).toEqual([second, first]);
    expect(stored.get(KEY)).toEqual([second, first]);
  });

  it('sorts equal updatedAt by id ascending', async () => {
    await saveDocument({ id: 'b', title: 'B', body: 'b' });
    await saveDocument({ id: 'a', title: 'A', body: 'a' });
    expect(await listDocuments()).toEqual([
      { id: 'a', title: 'A', body: 'a', createdAt: NOW, updatedAt: NOW },
      { id: 'b', title: 'B', body: 'b', createdAt: NOW, updatedAt: NOW },
    ]);
  });

  it('updates an existing document and keeps its creation time', async () => {
    await saveDocument({ title: 'First', body: 'one' });
    vi.setSystemTime(NOW + 100);
    const updated = await saveDocument({ id: 'doc-0001', title: 'New title', body: 'two' });
    expect(updated).toEqual({
      id: 'doc-0001',
      title: 'New title',
      body: 'two',
      createdAt: NOW,
      updatedAt: NOW + 100,
    });
    expect(await listDocuments()).toEqual([updated]);
    expect(await loadDocument('doc-0001')).toEqual(updated);
    expect(stored.get(KEY)).toEqual([updated]);
  });

  it('keeps an updated document readable when the clock moves back', async () => {
    const first = await saveDocument({ title: 'A', body: 'one' });
    vi.setSystemTime(NOW - 1000);
    const second = await saveDocument({ id: first.id, title: 'A', body: 'two' });
    expect(second.updatedAt).toBe(first.createdAt);
    expect(await loadDocument(first.id)).toEqual(second);
  });

  it('ignores a stored document whose time is beyond what a Date can hold', async () => {
    stored.set(KEY, [record({ createdAt: 1e100, updatedAt: 1e100 })]);
    expect(await listDocuments()).toEqual([]);
  });

  it('creates a document when the id is not stored', async () => {
    vi.setSystemTime(NOW + 5);
    const saved = await saveDocument({ id: 'from-another-window', title: 'Draft', body: 'text' });
    expect(saved).toEqual({
      id: 'from-another-window',
      title: 'Draft',
      body: 'text',
      createdAt: NOW + 5,
      updatedAt: NOW + 5,
    });
    expect(await listDocuments()).toEqual([saved]);
    expect(stored.get(KEY)).toEqual([saved]);
  });

  it('keeps a document older than 30 days', async () => {
    const old = record({
      id: 'old-doc',
      title: 'Old',
      body: 'kept',
      createdAt: NOW - MONTH - 1,
      updatedAt: NOW - MONTH - 1,
    });
    stored.set(KEY, [old]);
    expect(await listDocuments()).toEqual([old]);
    expect(await loadDocument('old-doc')).toEqual(old);
  });

  it('keeps all 60 documents', async () => {
    for (let i = 0; i < 60; i += 1) {
      vi.setSystemTime(NOW + i);
      await saveDocument({ title: `Title ${i}`, body: `Body ${i}` });
    }
    const expected: SavedDocument[] = [];
    for (let i = 59; i >= 0; i -= 1) {
      expected.push({
        id: `doc-${String(i + 1).padStart(4, '0')}`,
        title: `Title ${i}`,
        body: `Body ${i}`,
        createdAt: NOW + i,
        updatedAt: NOW + i,
      });
    }
    expect(await listDocuments()).toEqual(expected);
    expect(stored.get(KEY)).toEqual(expected);
  });

  it('saves a document at exactly 128 KiB and rejects one byte more', async () => {
    const kept = record({ id: 'kept', title: 'Kept', body: 'safe' });
    stored.set(KEY, [kept]);
    const title = 'عنوان';
    const probe = record({ id: 'doc-0001', title, body: '' });
    const overhead = new TextEncoder().encode(JSON.stringify(probe)).byteLength;
    const body = 'é'.repeat(Math.floor((CAP - overhead) / 2)) + 'a'.repeat((CAP - overhead) % 2);
    const saved = await saveDocument({ title, body });
    const exact = { ...probe, body };
    expect(saved).toEqual(exact);
    expect(new TextEncoder().encode(JSON.stringify(saved)).byteLength).toBe(CAP);
    expect(stored.get(KEY)).toEqual([exact, kept]);

    const error = await saveDocument({ id: 'doc-0001', title, body: body + 'a' }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toEqual(new Error(LIMIT_MESSAGE));
    expect(stored.get(KEY)).toEqual([exact, kept]);
    expect(await listDocuments()).toEqual([exact, kept]);

    const created = await saveDocument({ title: 'Big', body: 'é'.repeat(CAP) }).catch(
      (caught: unknown) => caught,
    );
    expect(created).toEqual(new Error(LIMIT_MESSAGE));
    expect(stored.get(KEY)).toEqual([exact, kept]);
  });

  it('deletes one document and ignores a missing id', async () => {
    await saveDocument({ id: 'one', title: 'One', body: '1' });
    await saveDocument({ id: 'two', title: 'Two', body: '2' });
    await deleteDocument('one');
    const remaining = [{ id: 'two', title: 'Two', body: '2', createdAt: NOW, updatedAt: NOW }];
    expect(await listDocuments()).toEqual(remaining);
    expect(await loadDocument('one')).toBeUndefined();
    await deleteDocument('missing');
    expect(await listDocuments()).toEqual(remaining);
    expect(stored.get(KEY)).toEqual(remaining);
  });

  it.each([
    null,
    [],
    'doc',
    { id: '' },
    { id: 1 },
    { title: null },
    { title: 1 },
    { body: null },
    { body: 1 },
    { createdAt: NaN },
    { createdAt: Infinity },
    { createdAt: -1 },
    { updatedAt: NaN },
    { updatedAt: Infinity },
    { updatedAt: -1 },
    { createdAt: NOW + 1 },
    { updatedAt: 'today' },
    { body: 'x'.repeat(CAP) },
  ])('drops a malformed or oversized stored entry: %j', async (patch) => {
    const good = record({ id: 'good', title: 'Good', body: 'ok' });
    const bad =
      patch !== null && !Array.isArray(patch) && typeof patch === 'object'
        ? { ...record(), ...patch }
        : patch;
    stored.set(KEY, [bad, good]);
    expect(await listDocuments()).toEqual([good]);
    expect(await loadDocument('good')).toEqual(good);
  });

  it.each([null, {}, 'bad', 4])('treats a non-array stored value as empty: %j', async (value) => {
    stored.set(KEY, value);
    expect(await listDocuments()).toEqual([]);
    const saved = await saveDocument({ title: 'T', body: 'B' });
    expect(saved).toEqual({
      id: 'doc-0001',
      title: 'T',
      body: 'B',
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(stored.get(KEY)).toEqual([saved]);
  });

  it('drops unknown fields and keeps the newest duplicate', async () => {
    stored.set(KEY, [
      {
        id: 'same',
        title: 'Older',
        body: 'old',
        createdAt: NOW,
        updatedAt: NOW,
        extra: 'no',
      },
      {
        id: 'same',
        title: 'Newer',
        body: 'new',
        createdAt: NOW - 10,
        updatedAt: NOW + 5,
        html: '<b>x</b>',
      },
      {
        id: 'same',
        title: null,
        body: 'bad',
        createdAt: NOW,
        updatedAt: NOW + 9,
      },
    ]);
    expect(await listDocuments()).toEqual([
      {
        id: 'same',
        title: 'Newer',
        body: 'new',
        createdAt: NOW - 10,
        updatedAt: NOW + 5,
      },
    ]);
  });

  it('returns independent objects', async () => {
    const input = { title: 'Title', body: 'Body' };
    const saved = await saveDocument(input);
    const expected = {
      id: 'doc-0001',
      title: 'Title',
      body: 'Body',
      createdAt: NOW,
      updatedAt: NOW,
    };
    input.title = 'input changed';
    input.body = 'input changed';
    saved.title = 'save changed';
    const listed = await listDocuments();
    listed[0]!.title = 'list changed';
    const loaded = (await loadDocument('doc-0001'))!;
    loaded.body = 'load changed';
    expect(stored.get(KEY)).toEqual([expected]);
    expect(await listDocuments()).toEqual([expected]);
    expect(await loadDocument('doc-0001')).toEqual(expected);
  });

  it('uses the same browser lock for every write operation', async () => {
    const request = vi.fn(async (_name: string, work: () => Promise<unknown>) => work());
    vi.stubGlobal('navigator', { locks: { request } });
    const saved = await saveDocument({ title: 'Title', body: 'Body' });
    await deleteDocument(saved.id);
    expect(request.mock.calls.map(([name]) => name)).toEqual([
      'localpolish-documents',
      'localpolish-documents',
    ]);
    expect(stored.get(KEY)).toEqual([]);
    expect(await listDocuments()).toEqual([]);
  });

  it.each(['get', 'set'] as const)(
    'propagates %s failures and recovers the queue',
    async (stage) => {
      const error = new Error('Storage failed');
      ({ get, set })[stage].mockRejectedValueOnce(error);
      await expect(saveDocument({ title: 'T', body: 'B' })).rejects.toBe(error);
      const saved = await saveDocument({ title: 'T', body: 'B' });
      expect(saved).toEqual({
        id: stage === 'get' ? 'doc-0001' : 'doc-0002',
        title: 'T',
        body: 'B',
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(stored.get(KEY)).toEqual([saved]);
    },
  );
});
