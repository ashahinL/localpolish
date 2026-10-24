import { afterEach, expect, it, vi } from 'vitest';
import {
  checkedPending,
  pendingKey,
  readChatTarget,
  watchPending,
  type PendingChat,
} from './pending';

const PENDING_KEY = pendingKey(10);

type Listener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => void;

function fakeSession(read: Promise<Record<string, unknown>>) {
  const listeners = new Set<Listener>();
  vi.stubGlobal('chrome', {
    windows: { getCurrent: async () => ({ id: 10 }) },
    storage: {
      session: { get: vi.fn(() => read) },
      onChanged: {
        addListener: (cb: Listener) => listeners.add(cb),
        removeListener: (cb: Listener) => listeners.delete(cb),
      },
    },
  });
  return (value: unknown, areaName = 'session') =>
    listeners.forEach((cb) => cb({ [PENDING_KEY]: { newValue: value } }, areaName));
}

afterEach(() => vi.unstubAllGlobals());

const first = {
  sequence: '1',
  tabId: 7,
  kind: 'chat' as const,
  attachment: { text: 'Cats sleep.', title: 'Cats', url: 'https://example.test/' },
};

it('reads the stored entry, then follows only new valid entries', async () => {
  const change = fakeSession(Promise.resolve({ [PENDING_KEY]: first }));
  const seen: PendingChat[] = [];
  const stop = watchPending((pending) => seen.push(pending));
  await vi.waitFor(() => expect(seen).toEqual([first]));

  change(first);
  change({ sequence: '2', tabId: 'seven' });
  change({ sequence: '3', tabId: 7, attachment: { text: 'x' } });
  change({ sequence: '4', tabId: 8 }, 'local');
  change({ sequence: '5', tabId: 8 });
  stop();
  change({ sequence: '6', tabId: 9 });
  expect(seen).toEqual([first, { sequence: '5', tabId: 8, kind: 'chat' }]);
});

it('ignores a slow startup read once a newer entry has arrived', async () => {
  let resolve!: (value: Record<string, unknown>) => void;
  const change = fakeSession(new Promise((done) => (resolve = done)));
  const seen: PendingChat[] = [];
  watchPending((pending) => seen.push(pending));
  await Promise.resolve();
  change({ sequence: '2', tabId: 3 });
  resolve({ [PENDING_KEY]: first });
  await Promise.resolve();
  await Promise.resolve();
  expect(seen).toEqual([{ sequence: '2', tabId: 3, kind: 'chat' }]);
});

it('reads the entry kind and document id, treating old entries as chat', () => {
  const base = { sequence: '1', tabId: 7 };
  expect(checkedPending(base)).toEqual({ ...base, kind: 'chat' });
  expect(checkedPending({ ...base, kind: 'document' })).toEqual({ ...base, kind: 'document' });
  expect(checkedPending({ ...base, kind: 'document', documentId: 'doc-1' })).toEqual({
    ...base,
    kind: 'document',
    documentId: 'doc-1',
  });
  expect(
    checkedPending({ ...base, kind: 'document', documentId: 'd'.repeat(100) })?.documentId,
  ).toHaveLength(100);
  for (const bad of [
    { kind: 'note' },
    { kind: 1 },
    { kind: 'chat', documentId: 'doc-1' },
    { documentId: 'doc-1' },
    { kind: 'document', documentId: '' },
    { kind: 'document', documentId: 'd'.repeat(101) },
    { kind: 'document', documentId: 5 },
  ])
    expect(checkedPending({ ...base, ...bad })).toBeUndefined();
});

it('ignores another window and resolves an entry target by sequence', async () => {
  fakeSession(Promise.resolve({ [PENDING_KEY]: first }));
  const chrome = (
    globalThis as unknown as {
      chrome: {
        storage: {
          session: { get: ReturnType<typeof vi.fn> };
          onChanged: { addListener: (cb: Listener) => void };
        };
      };
    }
  ).chrome;
  const seen: PendingChat[] = [];
  const listeners: Listener[] = [];
  const add = chrome.storage.onChanged.addListener;
  chrome.storage.onChanged.addListener = (cb) => {
    listeners.push(cb);
    add(cb);
  };
  watchPending((entry) => seen.push(entry));
  await vi.waitFor(() => expect(seen).toEqual([first]));
  listeners.forEach((cb) =>
    cb({ [pendingKey(11)]: { newValue: { sequence: 'other', tabId: 99 } } }, 'session'),
  );
  expect(seen).toEqual([first]);
  chrome.storage.session.get.mockResolvedValue({
    'chat-target:10': { sequence: '1', tabId: 7, frameId: 4 },
  });
  expect(await readChatTarget('1')).toEqual({ sequence: '1', tabId: 7, frameId: 4 });
  expect(await readChatTarget('stale')).toBeUndefined();
});
