import { afterEach, expect, it, vi } from 'vitest';
import { registerChatEntries, type ChatEntryChrome } from './chatEntries';

type Message = Parameters<ChatEntryChrome['runtime']['onMessage']['addListener']>[0];
type Sender = Parameters<Message>[1];
type Command = Parameters<ChatEntryChrome['commands']['onCommand']['addListener']>[0];
type Menu = Parameters<ChatEntryChrome['contextMenus']['onClicked']['addListener']>[0];

function setup() {
  let message!: Message;
  let command!: Command;
  let menu!: Menu;
  let installed!: (details: { reason: string }) => void;
  let removed!: (tabId: number) => void;
  const stored = new Map<string, unknown>();
  const order: string[] = [];
  const fetch = vi.fn(() => {
    throw new Error('Real providers are forbidden.');
  });
  const connectNative = vi.fn(() => {
    throw new Error('Native providers are forbidden.');
  });
  vi.stubGlobal('fetch', fetch);
  const open = vi.fn(async () => {
    order.push('open');
  });
  const get = vi.fn(async (key: string) => {
    order.push('read');
    return { [key]: stored.get(key) };
  });
  const set = vi.fn(async (items: Record<string, unknown>) => {
    order.push('write');
    Object.entries(items).forEach(([key, value]) => stored.set(key, structuredClone(value)));
  });
  const sendMessage = vi.fn(async () => ({ text: 'Selected words.', title: 'Frame title' }));
  const removeMenu = vi.fn((_id: string, cb: () => void) => cb());
  const create = vi.fn((_props: unknown, cb: () => void) => cb());
  const access = vi.fn().mockResolvedValue(undefined);
  const ext: ChatEntryChrome = {
    runtime: {
      id: 'localpolish',
      getURL: (path) => `chrome-extension://localpolish${path}`,
      onMessage: {
        addListener: (cb) => {
          message = cb;
        },
      },
      onInstalled: {
        addListener: (cb) => {
          installed = cb;
        },
      },
    },
    sidePanel: { open },
    storage: {
      session: {
        get,
        set,
        setAccessLevel: access,
        remove: async (key) => {
          stored.delete(key);
        },
      },
    },
    tabs: {
      get: async (id) => ({ id, windowId: 10 }),
      sendMessage,
      onRemoved: {
        addListener: (cb) => {
          removed = cb;
        },
      },
    },
    commands: {
      onCommand: {
        addListener: (cb) => {
          command = cb;
        },
      },
    },
    contextMenus: {
      create,
      remove: removeMenu,
      onClicked: {
        addListener: (cb) => {
          menu = cb;
        },
      },
    },
  };
  vi.stubGlobal('chrome', { ...ext, runtime: { ...ext.runtime, connectNative } });
  registerChatEntries(ext);
  const request = (value: unknown, sender: Sender) =>
    new Promise<unknown>((resolve) => {
      message(value, sender, resolve);
    });
  return {
    ext,
    request,
    command,
    menu,
    installed,
    removed,
    stored,
    order,
    open,
    get,
    set,
    sendMessage,
    create,
    removeMenu,
    access,
    fetch,
    connectNative,
  };
}

const tab = { id: 7, windowId: 10, title: 'Page title', url: 'https://page.test/' };
const sender = { id: 'localpolish', tab, frameId: 3, url: 'https://frame.test/article' };
const pending = (stored: Map<string, unknown>, windowId = 10) =>
  stored.get(`chat-pending:${windowId}`);
afterEach(() => vi.unstubAllGlobals());

it('opens synchronously from a content click, then delivers sender-owned metadata without AI', async () => {
  const bg = setup();
  const result = bg.request(
    { type: 'chat-open-selection', text: 'Two words', title: 'Article' },
    sender,
  );
  expect(bg.order).toEqual(['open']);
  expect(await result).toEqual({ ok: true });
  expect(pending(bg.stored)).toEqual({
    sequence: expect.any(String),
    tabId: 7,
    attachment: { text: 'Two words', title: 'Article', url: 'https://frame.test/article' },
  });
  const first = pending(bg.stored) as { sequence: string };
  expect(first.sequence).toMatch(/^[\da-f]{8}-[\da-f-]{27}$/);
  expect(bg.stored.get('chat-target:10')).toEqual({
    sequence: first.sequence,
    tabId: 7,
    frameId: 3,
  });
  await bg.request({ type: 'chat-open-selection', text: 'More words', title: 'Article' }, sender);
  expect((pending(bg.stored) as { sequence: string }).sequence).not.toBe(first.sequence);
  expect(bg.fetch).not.toHaveBeenCalled();
  expect(bg.connectNative).not.toHaveBeenCalled();
  expect(bg.access).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
});

it.each([
  [{ type: 'chat-open-selection', text: 12, title: 'Page' }, sender],
  [
    { type: 'chat-open-selection', text: 'Two words', title: 'Page', url: 'https://forged/' },
    sender,
  ],
  [
    { type: 'chat-open-selection', text: 'Two words', title: 'Page' },
    { ...sender, id: 'foreign' },
  ],
  [
    { type: 'chat-open-selection', text: 'Two words', title: 'Page' },
    { ...sender, tab: undefined },
  ],
  [{ type: 'chat-frame-focus' }, { ...sender, url: 'chrome-extension://localpolish/options.html' }],
  [{ type: 'chat-frame-focus', text: 'Secret' }, sender],
  [{ type: 'chat-open-plain', tabId: 7, windowId: 10 }, sender],
  [
    { type: 'chat-open-plain', tabId: 7, windowId: 10 },
    { id: 'localpolish', url: 'chrome-extension://localpolish/options.html' },
  ],
])('rejects invalid entry messages and senders: %j', async (value, source) => {
  const bg = setup();
  expect(await bg.request(value, source)).toMatchObject({ ok: false });
  expect(bg.stored.size).toBe(0);
  expect(bg.open).not.toHaveBeenCalled();
  expect(bg.fetch).not.toHaveBeenCalled();
  expect(bg.connectNative).not.toHaveBeenCalled();
});

it('reports a rejected page gesture and storage failure without unhandled promises', async () => {
  const bg = setup();
  bg.open.mockRejectedValueOnce(new Error('User gesture required'));
  expect(
    await bg.request({ type: 'chat-open-selection', text: 'Two words', title: '' }, sender),
  ).toEqual({ ok: false, message: 'User gesture required' });
  expect(pending(bg.stored)).toBeUndefined();
  bg.set.mockRejectedValueOnce(new Error('Session unavailable'));
  expect(
    await bg.request({ type: 'chat-open-selection', text: 'Two words', title: '' }, sender),
  ).toEqual({ ok: false, message: 'Session unavailable' });
});

it('opens the context menu first and attaches native selection frame metadata', async () => {
  const bg = setup();
  bg.menu(
    {
      menuItemId: 'localpolish-selection-chat',
      selectionText: 'Menu words',
      frameId: 5,
      frameUrl: 'https://child.test/',
      pageUrl: tab.url,
    },
    tab,
  );
  expect(bg.order).toEqual(['open']);
  await vi.waitFor(() =>
    expect(pending(bg.stored)).toMatchObject({
      tabId: 7,
      attachment: { text: 'Menu words', title: 'Page title', url: 'https://child.test/' },
    }),
  );
  expect(bg.stored.get('chat-target:10')).toMatchObject({ tabId: 7, frameId: 5 });
  expect(bg.fetch).not.toHaveBeenCalled();
  expect(bg.connectNative).not.toHaveBeenCalled();
});

it('replaces its menu id on install and update and leaves unrelated installs alone', () => {
  const bg = setup();
  bg.installed({ reason: 'install' });
  bg.installed({ reason: 'update' });
  bg.installed({ reason: 'chrome_update' });
  expect(bg.removeMenu.mock.calls.map(([id]) => id)).toEqual([
    'localpolish-selection-chat',
    'localpolish-selection-chat',
  ]);
  expect(bg.create.mock.calls.map(([props]) => props)).toEqual(
    Array(2).fill({
      id: 'localpolish-selection-chat',
      title: 'Ask LocalPolish about this',
      contexts: ['selection'],
    }),
  );
});

it('recovers a stored frame hint after worker restart and routes the command after opening', async () => {
  const first = setup();
  expect(await first.request({ type: 'chat-frame-focus' }, sender)).toEqual({ ok: true });
  expect([...first.stored.entries()]).toEqual([
    ['chat-frame:7', { frameId: 3, url: 'https://frame.test/article' }],
  ]);
  const bg = setup();
  bg.stored.set('chat-frame:7', first.stored.get('chat-frame:7'));
  bg.command('open-chat', tab);
  expect(bg.order).toEqual(['open', 'read']);
  await vi.waitFor(() =>
    expect(pending(bg.stored)).toMatchObject({
      tabId: 7,
      attachment: {
        text: 'Selected words.',
        title: 'Frame title',
        url: 'https://frame.test/article',
      },
    }),
  );
  expect(bg.sendMessage.mock.calls).toEqual([[7, { type: 'chat-read-selection' }, { frameId: 3 }]]);
  bg.removed(7);
  expect(bg.stored.has('chat-frame:7')).toBe(false);
});

it('falls back to the top frame when the hinted frame is gone', async () => {
  const bg = setup();
  bg.stored.set('chat-frame:7', { frameId: 5, url: 'https://gone.test/' });
  bg.sendMessage.mockRejectedValueOnce(new Error('No frame'));
  bg.command('open-chat', tab);
  await vi.waitFor(() =>
    expect(pending(bg.stored)).toMatchObject({
      attachment: { text: 'Selected words.', title: 'Frame title', url: 'https://page.test/' },
    }),
  );
  expect(bg.sendMessage.mock.calls).toEqual([
    [7, { type: 'chat-read-selection' }, { frameId: 5 }],
    [7, { type: 'chat-read-selection' }, { frameId: 0 }],
  ]);
});

it.each([false, true])(
  'opens plain chat for empty or restricted pages, restricted=%s',
  async (restricted) => {
    const bg = setup();
    if (restricted) bg.sendMessage.mockRejectedValue(new Error('No content script'));
    else bg.sendMessage.mockResolvedValue({ text: '', title: 'Empty' });
    bg.command('open-chat', { ...tab, url: 'chrome://settings/' });
    expect(bg.open).toHaveBeenCalledWith({ tabId: 7 });
    await vi.waitFor(() =>
      expect(pending(bg.stored)).toEqual({
        sequence: expect.any(String),
        tabId: 7,
        attachment: undefined,
      }),
    );
    expect(bg.fetch).not.toHaveBeenCalled();
    expect(bg.connectNative).not.toHaveBeenCalled();
  },
);

it('toolbar writes plain chat in its own window even when another entry has an attachment', async () => {
  const bg = setup();
  await bg.request(
    { type: 'chat-open-selection', text: 'Two words', title: '' },
    { ...sender, tab: { ...tab, windowId: 11 } },
  );
  const other = pending(bg.stored, 11);
  expect(
    await bg.request(
      { type: 'chat-open-plain', tabId: 7, windowId: 10 },
      {
        id: 'localpolish',
        url: 'chrome-extension://localpolish/popup.html',
      },
    ),
  ).toEqual({ ok: true });
  expect(pending(bg.stored)).toEqual({ sequence: expect.any(String), tabId: 7 });
  expect(pending(bg.stored, 11)).toEqual(other);
  expect(bg.open).toHaveBeenCalledTimes(1);
  expect(
    await bg.request(
      { type: 'chat-open-plain', tabId: 7, windowId: 11 },
      {
        id: 'localpolish',
        url: 'chrome-extension://localpolish/popup.html',
      },
    ),
  ).toEqual({ ok: false, message: 'The chat window changed. Open the popup again.' });
  expect(pending(bg.stored, 11)).toEqual(other);
});

it('keeps a slow older shortcut from replacing a newer selection in the same window', async () => {
  const bg = setup();
  let finish!: (value: { text: string; title: string }) => void;
  bg.sendMessage.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  bg.command('open-chat', tab);
  await vi.waitFor(() => expect(bg.sendMessage).toHaveBeenCalled());
  await bg.request({ type: 'chat-open-selection', text: 'New selection', title: '' }, sender);
  finish({ text: 'Old selection', title: '' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(pending(bg.stored)).toMatchObject({ attachment: { text: 'New selection' } });
});

it('handles command and menu open failures', async () => {
  const bg = setup();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    bg.open.mockRejectedValue(new Error('Panel unavailable'));
    bg.command('open-chat', tab);
    bg.menu({ menuItemId: 'localpolish-selection-chat', selectionText: 'Words' }, tab);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    expect(pending(bg.stored)).toBeUndefined();
  } finally {
    warn.mockRestore();
  }
});
