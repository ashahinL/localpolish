import { afterEach, expect, it, vi } from 'vitest';
import { PENDING_KEY, watchPending, type PendingChat } from './pending';

type Listener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => void;

function fakeSession(read: Promise<Record<string, unknown>>) {
  const listeners = new Set<Listener>();
  vi.stubGlobal('chrome', {
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
  expect(seen).toEqual([first, { sequence: '5', tabId: 8 }]);
});

it('ignores a slow startup read once a newer entry has arrived', async () => {
  let resolve!: (value: Record<string, unknown>) => void;
  const change = fakeSession(new Promise((done) => (resolve = done)));
  const seen: PendingChat[] = [];
  watchPending((pending) => seen.push(pending));
  change({ sequence: '2', tabId: 3 });
  resolve({ [PENDING_KEY]: first });
  await Promise.resolve();
  await Promise.resolve();
  expect(seen).toEqual([{ sequence: '2', tabId: 3 }]);
});
