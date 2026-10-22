import { pendingKey, targetKey, type PendingChat } from '../chat/pending';
import type { ChatAttachment } from '../core/prompts';

interface Tab {
  id?: number;
  windowId?: number;
  title?: string;
  url?: string;
}
interface Sender {
  id?: string;
  tab?: Tab;
  frameId?: number;
  url?: string;
}
interface MenuInfo {
  menuItemId: string | number;
  selectionText?: string;
  frameId?: number;
  frameUrl?: string;
  pageUrl?: string;
}
export interface ChatEntryChrome {
  runtime: {
    id: string;
    lastError?: { message?: string };
    getURL(path: string): string;
    onInstalled: { addListener(cb: (details: { reason: string }) => void): void };
    onMessage: {
      addListener(
        cb: (message: unknown, sender: Sender, reply: (value: unknown) => void) => boolean | void,
      ): void;
    };
  };
  sidePanel: { open(target: { tabId?: number; windowId?: number }): Promise<void> };
  contextMenus: {
    create(
      properties: { id: string; title: string; contexts: ['selection'] },
      callback: () => void,
    ): void;
    remove(id: string, callback: () => void): void;
    onClicked: { addListener(cb: (info: MenuInfo, tab?: Tab) => void): void };
  };
  commands: { onCommand: { addListener(cb: (command: string, tab?: Tab) => void): void } };
  tabs: {
    get(tabId: number): Promise<Tab>;
    sendMessage(
      tabId: number,
      message: { type: 'chat-read-selection' },
      options: { frameId: number },
    ): Promise<unknown>;
    onRemoved: { addListener(cb: (tabId: number) => void): void };
  };
  storage: {
    session: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
      setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
    };
  };
}

const MENU_ID = 'localpolish-selection-chat';
const hintKey = (tabId: number) => `chat-frame:${tabId}`;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const id = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

export function registerChatEntries(ext: ChatEntryChrome): void {
  const latest = new Map<number, string>();
  const writes = new Map<number, Promise<void>>();
  const warn = (error: unknown) => console.warn('Could not open chat.', error);
  void ext.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(warn);

  const begin = (windowId: number) => {
    const sequence = crypto.randomUUID();
    latest.set(windowId, sequence);
    return sequence;
  };
  const deliver = (windowId: number, pending: PendingChat, frameId: number): Promise<void> => {
    const work = (writes.get(windowId) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (latest.get(windowId) !== pending.sequence) return;
        await ext.storage.session.set({
          [pendingKey(windowId)]: pending,
          [targetKey(windowId)]: { sequence: pending.sequence, tabId: pending.tabId, frameId },
        });
      });
    writes.set(windowId, work);
    return work;
  };
  const open = (target: { tabId?: number; windowId?: number }) => {
    try {
      return ext.sidePanel.open(target);
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const attachment = (
    text: string | undefined,
    title: string | undefined,
    url: string | undefined,
  ): ChatAttachment | undefined =>
    text?.trim() ? { text, title: title ?? '', url: url ?? '' } : undefined;

  ext.runtime.onInstalled.addListener(({ reason }) => {
    if (reason !== 'install' && reason !== 'update') return;
    ext.contextMenus.remove(MENU_ID, () => {
      // A first install has no old menu. Reading lastError handles that callback error.
      void ext.runtime.lastError;
      ext.contextMenus.create(
        { id: MENU_ID, title: 'Ask LocalPolish about this', contexts: ['selection'] },
        () => {
          if (ext.runtime.lastError) warn(ext.runtime.lastError.message);
        },
      );
    });
  });

  ext.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !id(tab?.id) || !id(tab.windowId)) return;
    const opening = open({ tabId: tab.id });
    const sequence = begin(tab.windowId);
    void opening
      .then(() =>
        deliver(
          tab.windowId!,
          {
            sequence,
            tabId: tab.id!,
            attachment: attachment(
              info.selectionText,
              tab.title,
              info.frameUrl ?? info.pageUrl ?? tab.url,
            ),
          },
          info.frameId ?? 0,
        ),
      )
      .catch(warn);
  });

  async function selected(tab: Tab): Promise<{ attachment?: ChatAttachment; frameId: number }> {
    let frameId = 0;
    let url = tab.url;
    try {
      const key = hintKey(tab.id!);
      const hint = (await ext.storage.session.get(key))[key];
      if (record(hint) && id(hint.frameId) && typeof hint.url === 'string') {
        frameId = hint.frameId;
        url = hint.url;
      }
    } catch {
      /* A missing hint falls back to the top frame. */
    }
    const read = async (frame: number, frameUrl: string | undefined) => {
      const value = await ext.tabs.sendMessage(
        tab.id!,
        { type: 'chat-read-selection' },
        { frameId: frame },
      );
      if (!record(value) || typeof value.text !== 'string' || typeof value.title !== 'string')
        return { frameId: frame };
      return { frameId: frame, attachment: attachment(value.text, value.title, frameUrl) };
    };
    try {
      return await read(frameId, url);
    } catch {
      if (frameId !== 0) {
        try {
          return await read(0, tab.url);
        } catch {
          /* Restricted tabs open plain chat. */
        }
      }
      return { frameId: 0 };
    }
  }

  ext.commands.onCommand.addListener((command, tab) => {
    if (command !== 'open-chat' || !id(tab?.id) || !id(tab.windowId)) return;
    const opening = open({ tabId: tab.id });
    const sequence = begin(tab.windowId);
    // Resolve frame ownership only after starting open, before its focus change loses the selection.
    const selection = selected(tab);
    void Promise.all([opening, selection])
      .then(([, result]) =>
        deliver(
          tab.windowId!,
          {
            sequence,
            tabId: tab.id!,
            attachment: result.attachment,
          },
          result.frameId,
        ),
      )
      .catch(warn);
  });

  ext.tabs.onRemoved.addListener((tabId) => {
    void ext.storage.session.remove(hintKey(tabId)).catch(warn);
  });

  ext.runtime.onMessage.addListener((message, sender, reply) => {
    if (
      !record(message) ||
      typeof message.type !== 'string' ||
      !['chat-frame-focus', 'chat-open-selection', 'chat-open-plain'].includes(message.type)
    )
      return;
    const respond = (value: unknown) => {
      try {
        reply(value);
      } catch {
        /* Sender closed. */
      }
    };
    const content =
      sender.id === ext.runtime.id &&
      id(sender.tab?.id) &&
      id(sender.tab?.windowId) &&
      id(sender.frameId) &&
      typeof sender.url === 'string' &&
      !sender.url.startsWith(ext.runtime.getURL('/'));
    const keys =
      message.type === 'chat-open-selection'
        ? ['type', 'text', 'title']
        : message.type === 'chat-open-plain'
          ? ['type', 'tabId', 'windowId']
          : ['type'];
    if (Object.keys(message).some((key) => !keys.includes(key))) {
      respond({ ok: false, message: 'Invalid chat entry.' });
      return;
    }
    if (message.type === 'chat-frame-focus' && content) {
      void ext.storage.session
        .set({
          [hintKey(sender.tab!.id!)]: {
            frameId: sender.frameId,
            url: sender.url,
          },
        })
        .then(
          () => respond({ ok: true }),
          () => respond({ ok: false }),
        );
      return true;
    }
    if (
      message.type === 'chat-open-selection' &&
      content &&
      typeof message.text === 'string' &&
      message.text.trim() !== '' &&
      typeof message.title === 'string'
    ) {
      const opening = open({ tabId: sender.tab!.id });
      const sequence = begin(sender.tab!.windowId!);
      void opening
        .then(() =>
          deliver(
            sender.tab!.windowId!,
            {
              sequence,
              tabId: sender.tab!.id!,
              attachment: attachment(message.text as string, message.title as string, sender.url),
            },
            sender.frameId!,
          ),
        )
        .then(
          () => respond({ ok: true }),
          (error: unknown) => {
            respond({
              ok: false,
              message: error instanceof Error ? error.message : 'Could not open chat.',
            });
          },
        );
      return true;
    }
    if (
      message.type === 'chat-open-plain' &&
      sender.id === ext.runtime.id &&
      sender.url === ext.runtime.getURL('/popup.html') &&
      id(message.tabId) &&
      id(message.windowId)
    ) {
      const tabId = message.tabId;
      const windowId = message.windowId;
      const sequence = begin(windowId);
      void ext.tabs
        .get(tabId)
        .then((tab) => {
          if (tab.windowId !== windowId)
            throw new Error('The chat window changed. Open the popup again.');
          return deliver(windowId, { sequence, tabId }, 0);
        })
        .then(
          () => respond({ ok: true }),
          (error: unknown) => {
            respond({
              ok: false,
              message: error instanceof Error ? error.message : 'Could not start chat.',
            });
          },
        );
      return true;
    }
    respond({ ok: false, message: 'Invalid chat entry sender or message.' });
  });
}
