import { afterEach, expect, it, vi } from 'vitest';
import { chatTarget, openPlainChat } from './chrome';

afterEach(() => vi.unstubAllGlobals());

it('prefetches identifiers, opens on the click, writes plain chat, then closes', async () => {
  let opened!: () => void;
  let written!: (value: unknown) => void;
  const order: string[] = [];
  const sendMessage = vi.fn(() => {
    order.push('pending');
    return new Promise((resolve) => {
      written = resolve;
    });
  });
  vi.stubGlobal('chrome', {
    tabs: { query: async () => [{ id: 7, windowId: 10 }] },
    sidePanel: {
      open: (target: unknown) => {
        expect(target).toEqual({ windowId: 10 });
        order.push('open');
        return new Promise<void>((resolve) => {
          opened = resolve;
        });
      },
    },
    runtime: { sendMessage },
  });
  vi.stubGlobal('window', {
    close: () => {
      order.push('close');
    },
  });
  const target = await chatTarget();
  const done = openPlainChat(target);
  expect(order).toEqual(['open']);
  opened();
  await Promise.resolve();
  expect(order).toEqual(['open', 'pending']);
  expect(sendMessage).toHaveBeenCalledWith({ type: 'chat-open-plain', tabId: 7, windowId: 10 });
  written({ ok: true });
  await done;
  expect(order).toEqual(['open', 'pending', 'close']);
});

it.each(['open', 'write'])('reports %s failure and keeps the popup open', async (failure) => {
  const close = vi.fn();
  const sendMessage = vi.fn().mockResolvedValue({ ok: false, message: 'Session unavailable' });
  vi.stubGlobal('chrome', {
    sidePanel: {
      open:
        failure === 'open' ? () => Promise.reject(new Error('Panel unavailable')) : async () => {},
    },
    runtime: { sendMessage },
  });
  vi.stubGlobal('window', { close });
  await expect(openPlainChat({ tabId: 7, windowId: 10 })).rejects.toThrow(
    failure === 'open' ? 'Panel unavailable' : 'Session unavailable',
  );
  expect(close).not.toHaveBeenCalled();
  if (failure === 'open') expect(sendMessage).not.toHaveBeenCalled();
});

it.each([
  [{ kind: 'document' } as const, { kind: 'document' }],
  [{ kind: 'document', documentId: 'doc-1' } as const, { kind: 'document', documentId: 'doc-1' }],
])('opens a document entry %o and closes', async (entry, keys) => {
  const order: string[] = [];
  const sendMessage = vi.fn(async () => {
    order.push('pending');
    return { ok: true };
  });
  vi.stubGlobal('chrome', {
    sidePanel: {
      open: async () => {
        order.push('open');
      },
    },
    runtime: { sendMessage },
  });
  vi.stubGlobal('window', { close: () => order.push('close') });
  await openPlainChat({ tabId: 7, windowId: 10 }, entry);
  expect(sendMessage).toHaveBeenCalledWith({
    type: 'chat-open-plain',
    tabId: 7,
    windowId: 10,
    ...keys,
  });
  expect(order).toEqual(['open', 'pending', 'close']);
});
