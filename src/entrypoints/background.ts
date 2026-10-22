import { registerChatEntries, type ChatEntryChrome } from '../background/chatEntries';
import { pruneChats } from '../core/chatHistory';
import { pingBridge } from '../background/providers/cli';
import { getProvider } from '../background/providers';
import { runChat } from '../background/chat';
import { runRewrite, testConnection } from '../background/rewrite';
import {
  CHAT_PORT,
  REWRITE_PORT,
  TEST_PORT,
  type TestEvent,
  type BridgeStatus,
  type ChatEvent,
  type ChatRequest,
  type RewriteEvent,
  type RewriteRequest,
  type RuntimeMessage,
} from '../core/messages';
import {
  DEFAULT_SETTINGS,
  isBlocked,
  loadSettings,
  pageSettings,
  type Mode,
  type Tone,
} from '../core/settings';

const MODES = new Set<Mode>(['fix', 'rephrase', 'shorter', 'tone']);
const TONES = new Set<Tone>(['polite', 'formal', 'casual', 'angry-civil']);

interface RewritePort {
  name: string;
  sender?: { id?: string; tab?: { url?: string }; url?: string };
  postMessage(message: unknown): void;
  disconnect?(): void;
  onMessage: { addListener(cb: (message: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

interface ExtensionChrome {
  runtime: {
    id: string;
    onInstalled: { addListener(cb: (details: { reason: string }) => void): void };
    onStartup: { addListener(cb: () => void): void };
    getURL(path: string): string;
    onConnect: { addListener(cb: (port: RewritePort) => void): void };
    onMessage: {
      addListener(
        cb: (
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean | void,
      ): void;
    };
  };
  commands: {
    onCommand: {
      addListener(cb: (command: string, tab?: { id?: number; windowId?: number }) => void): void;
    };
  };
  tabs: {
    query(queryInfo: {
      active?: boolean;
      currentWindow?: boolean;
    }): Promise<Array<{ id?: number }>>;
    sendMessage(tabId: number, message: RuntimeMessage): Promise<unknown>;
    create(props: { url: string }): Promise<unknown>;
  };
  storage: {
    local: {
      setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
    };
    onChanged: {
      addListener(
        cb: (
          changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
          areaName: string,
        ) => void,
      ): void;
    };
  };
}

function extension(): ExtensionChrome {
  return (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
}

function isRewriteRequest(value: unknown): value is RewriteRequest {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as {
    mode?: unknown;
    tone?: unknown;
    text?: unknown;
    trigger?: unknown;
    keep?: unknown;
  };
  return (
    typeof message.mode === 'string' &&
    MODES.has(message.mode as Mode) &&
    typeof message.tone === 'string' &&
    TONES.has(message.tone as Tone) &&
    typeof message.text === 'string' &&
    (message.trigger === undefined || message.trigger === 'idle') &&
    (message.keep === undefined ||
      (message.trigger === 'idle' &&
        Array.isArray(message.keep) &&
        message.keep.every(
          (id) => typeof id === 'string' && Object.hasOwn(DEFAULT_SETTINGS.languages, id),
        ) &&
        new Set(message.keep).size === message.keep.length))
  );
}

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Turns alternate user, assistant, ..., user, so the request always asks for one new answer.
function isChatRequest(value: unknown): value is ChatRequest {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['turns', 'attachment'])) return false;
  const { turns, attachment } = value;
  if (!Array.isArray(turns) || turns.length % 2 === 0) return false;
  const turnsOk = turns.every(
    (turn: unknown, index) =>
      isPlainRecord(turn) &&
      hasOnlyKeys(turn, ['role', 'content']) &&
      turn.role === (index % 2 === 0 ? 'user' : 'assistant') &&
      typeof turn.content === 'string' &&
      turn.content.trim() !== '',
  );
  if (!turnsOk) return false;
  if (attachment === undefined) return true;
  return (
    isPlainRecord(attachment) &&
    hasOnlyKeys(attachment, ['text', 'title', 'url']) &&
    typeof attachment.text === 'string' &&
    typeof attachment.title === 'string' &&
    typeof attachment.url === 'string'
  );
}

function copyChatRequest(request: ChatRequest): ChatRequest {
  const turns = request.turns.map(({ role, content }) => ({ role, content }));
  if (!request.attachment) return { turns };
  const { text, title, url } = request.attachment;
  return { turns, attachment: { text, title, url } };
}

function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === 'bridge-status' ||
    type === 'open-popup' ||
    type === 'page-settings' ||
    type === 'page-settings-changed'
  );
}

function post(port: RewritePort, event: RewriteEvent | ChatEvent): void {
  try {
    port.postMessage(event);
  } catch {
    // The content script port can close while a chunk is in flight.
  }
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

// Only the extension's own panel page may chat. Content scripts report the web page URL.
function isPanelSender(sender: RewritePort['sender']): boolean {
  if (sender?.id !== extension().runtime.id || typeof sender.url !== 'string') return false;
  return sender.url.split(/[?#]/)[0] === extension().runtime.getURL('/sidepanel.html');
}

function handleChatPort(port: RewritePort): void {
  if (!isPanelSender(port.sender)) {
    post(port, { type: 'error', message: 'Chat is only available in the LocalPolish panel.' });
    port.disconnect?.();
    return;
  }
  const controller = new AbortController();
  let started = false;
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener((message: unknown) => {
    if (started || controller.signal.aborted) return;
    started = true;
    if (!isChatRequest(message)) {
      post(port, { type: 'error', message: 'The chat request was not understood.' });
      return;
    }
    const request = copyChatRequest(message);
    const send = (event: ChatEvent) => {
      if (!controller.signal.aborted) post(port, event);
    };
    void loadSettings()
      .then((settings) => {
        if (controller.signal.aborted) return;
        return runChat(
          request,
          settings,
          getProvider(settings.chat.provider),
          send,
          controller.signal,
        );
      })
      .catch((err: unknown) => {
        send({ type: 'error', message: errorMessage(err, 'Could not load settings.') });
      });
  });
}

export default defineBackground(() => {
  let pageSettingsQueue: Promise<void> = Promise.resolve();
  const enqueuePageSettings = (work: () => Promise<void>): Promise<void> => {
    const result = pageSettingsQueue.then(work);
    pageSettingsQueue = result.catch(() => {});
    return result;
  };
  let healthCache: { status: Extract<BridgeStatus, { ok: true }>; expiresAt: number } | undefined;
  let healthInFlight: Promise<BridgeStatus> | undefined;

  const bridgeHealth = (force: boolean): Promise<BridgeStatus> => {
    if (healthInFlight) return healthInFlight;
    if (!force && healthCache && Date.now() < healthCache.expiresAt) {
      return Promise.resolve(healthCache.status);
    }
    healthInFlight = pingBridge()
      .then((status) => {
        healthCache = status.ok ? { status, expiresAt: Date.now() + 30_000 } : undefined;
        return status;
      })
      .catch((err: unknown) => {
        healthCache = undefined;
        throw err;
      })
      .finally(() => {
        healthInFlight = undefined;
      });
    return healthInFlight;
  };

  void extension().storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

  extension().storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !('settings' in changes)) return;
    const { oldValue, newValue } = changes.settings!;
    if (JSON.stringify(pageSettings(oldValue)) === JSON.stringify(pageSettings(newValue))) return;
    void enqueuePageSettings(async () => {
      const settings = pageSettings(await loadSettings());
      const tabs = await extension().tabs.query({});
      await Promise.allSettled(
        tabs.map((tab) => {
          if (tab.id === undefined) return;
          return extension().tabs.sendMessage(tab.id, { type: 'page-settings-changed', settings });
        }),
      );
    }).catch(() => {});
  });

  extension().runtime.onInstalled.addListener(({ reason }) => {
    if (reason !== 'install') return;
    void extension()
      .tabs.create({ url: extension().runtime.getURL('/setup.html') })
      .catch(() => {
        // The setup page is a convenience; the toolbar popup still works without it.
      });
  });

  extension().runtime.onStartup.addListener(() => {
    void pruneChats().catch((error: unknown) => {
      console.warn('Could not prune chat history.', error);
    });
  });

  extension().runtime.onConnect.addListener((port) => {
    if (port.name === CHAT_PORT) {
      handleChatPort(port);
      return;
    }
    if (port.name === TEST_PORT) {
      const controller = new AbortController();
      let started = false;
      port.onDisconnect.addListener(() => controller.abort());
      const reply = (result: TestEvent['result']) => {
        if (controller.signal.aborted) return;
        try {
          port.postMessage({ type: 'result', result } satisfies TestEvent);
        } catch {
          controller.abort();
        }
      };
      port.onMessage.addListener((message) => {
        if (started || controller.signal.aborted) return;
        if (
          typeof message !== 'object' ||
          message === null ||
          (message as { type?: unknown }).type !== 'test-connection'
        ) {
          reply({ ok: false, message: 'The connection test request was not understood.' });
          return;
        }
        started = true;
        void loadSettings()
          .then((settings) => {
            if (controller.signal.aborted) return;
            return testConnection(settings, getProvider(settings.provider), controller.signal);
          })
          .then((result) => {
            if (result) reply(result);
          })
          .catch((err: unknown) => {
            reply({ ok: false, message: errorMessage(err, 'Could not load settings.') });
          });
      });
      return;
    }
    if (port.name !== REWRITE_PORT) return;

    const controller = new AbortController();
    let started = false;
    port.onDisconnect.addListener(() => {
      controller.abort();
    });
    port.onMessage.addListener((message: unknown) => {
      if (started) return;
      started = true;
      if (!isRewriteRequest(message)) {
        post(port, { type: 'error', message: 'The rewrite request was not understood.' });
        return;
      }
      const request = message;
      void loadSettings()
        .then((settings) => {
          if (controller.signal.aborted) return;
          if (request.trigger === 'idle') {
            const hosts: string[] = [];
            for (const url of [port.sender?.tab?.url, port.sender?.url]) {
              if (!url) continue;
              try {
                const host = new URL(url).hostname;
                if (host) hosts.push(host);
              } catch {
                // Blank or opaque frames may not have a parseable sender URL.
              }
            }
            if (!settings.idleFix || hosts.some((host) => isBlocked(host, settings.blocklist))) {
              post(port, { type: 'error', message: 'LocalPolish is off on this site.' });
              return;
            }
          }
          return runRewrite(
            request,
            settings,
            getProvider(settings.provider),
            (event) => post(port, event),
            controller.signal,
          );
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          post(port, { type: 'error', message: errorMessage(err, 'Could not load settings.') });
        });
    });
  });

  extension().runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (
      !isRuntimeMessage(message) ||
      message.type === 'open-popup' ||
      message.type === 'page-settings-changed'
    )
      return;

    const reply = (response: unknown) => {
      try {
        sendResponse(response);
      } catch {
        // The options page can close before the reply is ready.
      }
    };

    if (message.type === 'page-settings') {
      void enqueuePageSettings(async () => {
        reply(pageSettings(await loadSettings()));
      }).catch(() => reply(null));
      return true;
    }

    void bridgeHealth(message.force === true)
      .then(reply)
      .catch((err: unknown) => {
        reply({ ok: false, message: errorMessage(err, 'The bridge stopped unexpectedly.') });
      });
    return true;
  });

  extension().commands.onCommand.addListener((command) => {
    if (command !== 'polish') return;
    void extension()
      .tabs.query({ active: true, currentWindow: true })
      .then((tabs) => {
        const tabId = tabs[0]?.id;
        if (tabId === undefined) return;
        return extension().tabs.sendMessage(tabId, { type: 'open-popup' });
      })
      .catch(() => {
        // A tab without the content script rejects sendMessage.
      });
  });

  registerChatEntries(extension() as ExtensionChrome & ChatEntryChrome);
});
