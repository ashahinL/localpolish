import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteAllChats,
  deleteChat,
  listChats,
  openChat,
  pruneChats,
  saveChat,
  type SavedChat,
  type SaveChatInput,
} from './chatHistory';

const NOW = 1_800_000_000_000;
const MONTH = 30 * 24 * 60 * 60 * 1000;
const CAP = 128 * 1024;
const KEY = 'chat-history';
let stored: Map<string, unknown>;
let get: ReturnType<typeof vi.fn>;
let set: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;
let uuid = 0;

function record(patch: Partial<SavedChat> = {}): SavedChat {
  return {
    id: 'chat-0001',
    title: 'Example',
    createdAt: NOW,
    updatedAt: NOW,
    turns: [{ role: 'user', content: '<b>Plain text</b>' }],
    ...patch,
  };
}

function input(): SaveChatInput {
  return {
    title: 'Example',
    turns: [{ role: 'user', content: '<b>Plain text</b>' }],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  uuid = 0;
  vi.stubGlobal('crypto', { randomUUID: () => `chat-${String(++uuid).padStart(4, '0')}` });
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

describe('chat history', () => {
  it('saves plain data, lists newest first with id ties, and opens a chat', async () => {
    expect(await listChats()).toEqual([]);
    const first = await saveChat({
      ...input(),
      attachment: { text: '<script>selection</script>', title: 'Page', url: 'https://example.com' },
    });
    expect(first).toEqual(
      record({
        attachment: {
          text: '<script>selection</script>',
          title: 'Page',
          url: 'https://example.com',
        },
      }),
    );
    const second = await saveChat(input());
    vi.setSystemTime(NOW + 1);
    const third = await saveChat(input());
    expect(await listChats()).toEqual([third, first, second]);
    expect(stored.get(KEY)).toEqual([third, first, second]);
    expect(await openChat(first.id)).toEqual(first);
    expect(await openChat('missing')).toBeUndefined();
  });

  it('updates an existing chat and preserves its creation time', async () => {
    const first = await saveChat({ ...input(), attachment: { text: 'x', title: 'p', url: 'u' } });
    vi.setSystemTime(NOW + 100);
    const updated = await saveChat({
      id: first.id,
      title: 'New title',
      turns: [...first.turns, { role: 'assistant', content: 'An answer' }],
    });
    expect(updated).toEqual({
      id: first.id,
      title: 'New title',
      createdAt: NOW,
      updatedAt: NOW + 100,
      turns: [
        { role: 'user', content: '<b>Plain text</b>' },
        { role: 'assistant', content: 'An answer' },
      ],
    });
    expect(stored.get(KEY)).toEqual([updated]);
    expect(await openChat(first.id)).toEqual(updated);
  });

  it('deletes one chat and clears only history when deleting all', async () => {
    stored.set('settings', { chat: { provider: 'codex-cli' } });
    stored.set('usage', { total: 7 });
    const first = await saveChat(input());
    const second = await saveChat(input());
    await deleteChat(first.id);
    expect(await openChat(first.id)).toBeUndefined();
    expect(stored.get(KEY)).toEqual([second]);
    await deleteAllChats();
    expect(await listChats()).toEqual([]);
    expect(stored.has(KEY)).toBe(false);
    expect(stored.get('settings')).toEqual({ chat: { provider: 'codex-cli' } });
    expect(stored.get('usage')).toEqual({ total: 7 });
    expect(remove).toHaveBeenCalledExactlyOnceWith(KEY);
  });

  it.each(['missing', 'deleted', 'expired'])(
    'rejects updating a %s id without resurrecting it',
    async (kind) => {
      if (kind !== 'missing') {
        stored.set(KEY, [
          record({ updatedAt: kind === 'expired' ? NOW - MONTH : NOW, createdAt: 0 }),
        ]);
        if (kind === 'deleted') await deleteChat('chat-0001');
      }
      const before = structuredClone(stored.get(KEY));
      await expect(saveChat({ ...input(), id: 'chat-0001' })).rejects.toThrow('no longer exists');
      expect(stored.get(KEY)).toEqual(before);
    },
  );

  it('keeps the 50 most recently updated chats on save, including id ties', async () => {
    const chats: SavedChat[] = [];
    for (let i = 0; i < 51; i++) {
      vi.setSystemTime(NOW + i);
      chats.unshift(await saveChat(input()));
    }
    expect(stored.get(KEY)).toEqual(chats.slice(0, 50));
    expect(await listChats()).toEqual(chats.slice(0, 50));
    expect(await openChat(chats[50]!.id)).toBeUndefined();
    const updated = await saveChat({ ...input(), id: chats[49]!.id });
    expect((await listChats()).slice(0, 2)).toEqual([updated, chats[0]]);
  });

  it('prunes at the exact 30-day boundary on read, save and explicit prune', async () => {
    const expired = record({ id: 'expired', createdAt: 0, updatedAt: NOW - MONTH });
    const older = { ...expired, id: 'older', updatedAt: expired.updatedAt - 1 };
    const current = { ...expired, id: 'current', updatedAt: expired.updatedAt + 1 };
    stored.set(KEY, [expired, older, current]);
    expect(await listChats()).toEqual([current]);
    expect(await openChat('expired')).toBeUndefined();
    expect(set).not.toHaveBeenCalled();
    const saved = await saveChat(input());
    expect(stored.get(KEY)).toEqual([saved, current]);
    stored.set(KEY, [expired, current]);
    await pruneChats();
    expect(stored.get(KEY)).toEqual([current]);
  });

  it('prunes oversized collections with deterministic id ties', async () => {
    const chats = Array.from({ length: 52 }, (_, i) =>
      record({ id: `id-${String(i).padStart(2, '0')}` }),
    );
    stored.set(KEY, [...chats].reverse());
    await pruneChats();
    expect(stored.get(KEY)).toEqual(chats.slice(0, 50));
  });

  it.each([false, true])(
    'caps serialized UTF-8 bytes with attachment=%s',
    async (withAttachment) => {
      const attachment = withAttachment
        ? { text: 'é😀', title: 'صفحة', url: 'https://example.com' }
        : undefined;
      const base = record({
        title: 'عنوان',
        turns: [{ role: 'assistant', content: '' }],
        ...(attachment ? { attachment } : {}),
      });
      const overhead = new TextEncoder().encode(JSON.stringify(base)).byteLength;
      const content =
        'é'.repeat(Math.floor((CAP - overhead) / 2)) + 'a'.repeat((CAP - overhead) % 2);
      const data = {
        title: base.title,
        turns: [{ role: 'assistant' as const, content }],
        attachment,
      };
      const saved = await saveChat(data);
      expect(new TextEncoder().encode(JSON.stringify(saved)).byteLength).toBe(CAP);
      expect(stored.get(KEY)).toEqual([saved]);
      expect(await openChat(saved.id)).toEqual(saved);
      await expect(
        saveChat({ ...data, id: saved.id, turns: [{ role: 'assistant', content: content + 'a' }] }),
      ).rejects.toThrow('128 KiB');
      expect(stored.get(KEY)).toEqual([saved]);
      expect(await openChat(saved.id)).toEqual(saved);
    },
  );

  it.each([
    null,
    [],
    'chat',
    { id: '' },
    { id: 1 },
    { title: null },
    { createdAt: NaN },
    { createdAt: Infinity },
    { createdAt: -1 },
    { updatedAt: NaN },
    { updatedAt: Infinity },
    { updatedAt: -1 },
    { createdAt: NOW + 1 },
    { updatedAt: 'today' },
    { turns: null },
    { turns: {} },
    { turns: [null] },
    { turns: [{ role: 'system', content: 'no' }] },
    { turns: [{ role: 'assistant', content: 1 }] },
    { attachment: null },
    { attachment: [] },
    { attachment: {} },
    { attachment: { text: 1, title: '', url: '' } },
    { attachment: { text: '', title: 1, url: '' } },
    { attachment: { text: '', title: '', url: 1 } },
    { turns: [{ role: 'user', content: 'x'.repeat(CAP) }] },
  ])('drops a malformed or oversized stored value: %j', async (patch) => {
    const bad =
      patch !== null && !Array.isArray(patch) && typeof patch === 'object'
        ? { ...record(), ...patch }
        : patch;
    stored.set(KEY, [bad]);
    expect(await listChats()).toEqual([]);
    await pruneChats();
    expect(stored.get(KEY)).toEqual([]);
  });

  it.each([null, {}, 'bad'])('treats a malformed top-level value as empty: %j', async (value) => {
    stored.set(KEY, value);
    expect(await listChats()).toEqual([]);
    const saved = await saveChat(input());
    expect(stored.get(KEY)).toEqual([saved]);
  });

  it('drops unknown fields and keeps the newest valid duplicate', async () => {
    const newest = record({
      updatedAt: NOW + 1,
      attachment: { text: 'selection', title: 'Page', url: 'url' },
    });
    stored.set(KEY, [
      {
        ...newest,
        model: 'private',
        attachment: { ...newest.attachment, html: '<b>x</b>' },
        turns: [{ ...newest.turns[0], html: 'ignored' }],
      },
      record({ title: 'Older' }),
      { ...newest, updatedAt: NOW + 2, title: null },
    ]);
    expect(await listChats()).toEqual([newest]);
    await pruneChats();
    expect(stored.get(KEY)).toEqual([newest]);
  });

  it('returns independent objects on save, list and open', async () => {
    const data = { ...input(), attachment: { text: 'selection', title: 'Page', url: 'url' } };
    const saved = await saveChat(data);
    const expected = structuredClone(saved);
    const listed = await listChats();
    const opened = (await openChat(saved.id))!;
    data.turns[0]!.content = 'input changed';
    data.attachment.text = 'input changed';
    saved.turns[0]!.content = 'save changed';
    saved.attachment!.text = 'save changed';
    listed[0]!.turns[0]!.content = 'list changed';
    listed[0]!.attachment!.text = 'list changed';
    opened.turns.push({ role: 'assistant', content: 'open changed' });
    opened.attachment!.text = 'open changed';
    expect(stored.get(KEY)).toEqual([expected]);
    expect(await listChats()).toEqual([expected]);
    expect(await openChat(saved.id)).toEqual(expected);
  });

  it('serializes concurrent saves, deletion, pruning and delete-all through the fallback queue', async () => {
    const [first, second] = await Promise.all([saveChat(input()), saveChat(input())]);
    expect(stored.get(KEY)).toEqual([first, second]);
    const outcomes = await Promise.allSettled([
      deleteChat(first.id),
      saveChat({ ...input(), id: first.id }),
      saveChat(input()),
      pruneChats(),
      deleteAllChats(),
      saveChat(input()),
    ]);
    expect(outcomes.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
      'fulfilled',
      'fulfilled',
      'fulfilled',
      'fulfilled',
    ]);
    const last = record({ id: 'chat-0004' });
    expect(stored.get(KEY)).toEqual([last]);
    expect(await listChats()).toEqual([last]);
  });

  it('uses the same browser lock for every write operation', async () => {
    const request = vi.fn(async (_name: string, work: () => Promise<unknown>) => work());
    vi.stubGlobal('navigator', { locks: { request } });
    const saved = await saveChat(input());
    await deleteChat(saved.id);
    await pruneChats();
    await deleteAllChats();
    expect(request.mock.calls.map(([name]) => name)).toEqual(
      Array(4).fill('localpolish-chat-history'),
    );
    expect(stored.has(KEY)).toBe(false);
  });

  it.each(['get', 'set', 'remove'])(
    'propagates %s failures and recovers the queue',
    async (stage) => {
      const error = new Error('Storage failed');
      ({ get, set, remove })[stage]!.mockRejectedValueOnce(error);
      await expect(stage === 'remove' ? deleteAllChats() : saveChat(input())).rejects.toBe(error);
      const saved = await saveChat(input());
      expect(stored.get(KEY)).toEqual([saved]);
    },
  );
});
