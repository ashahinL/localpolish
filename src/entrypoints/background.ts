import { pingBridge } from '../background/providers/cli';
import { getProvider } from '../background/providers';
import { runRewrite, testConnection } from '../background/rewrite';
import {
  REWRITE_PORT,
  type PageSettings,
  type RewriteEvent,
  type RewriteRequest,
  type RuntimeMessage,
} from '../core/messages';
import { isBlocked, loadSettings, type Mode, type Tone } from '../core/settings';

const MODES = new Set<Mode>(['fix', 'rephrase', 'shorter', 'tone']);
const TONES = new Set<Tone>(['polite', 'formal', 'casual', 'angry-civil']);

interface RewritePort {
  name: string;
  sender?: { tab?: { url?: string }; url?: string };
  postMessage(message: unknown): void;
  onMessage: { addListener(cb: (message: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

interface ExtensionChrome {
  runtime: {
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
    onCommand: { addListener(cb: (command: string) => void): void };
  };
  tabs: {
    query(queryInfo: {
      active?: boolean;
      currentWindow?: boolean;
    }): Promise<Array<{ id?: number }>>;
    sendMessage(tabId: number, message: RuntimeMessage): Promise<unknown>;
  };
  storage: {
    local: {
      setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
    };
    onChanged: {
      addListener(cb: (changes: Record<string, unknown>, areaName: string) => void): void;
    };
  };
}

function extension(): ExtensionChrome {
  return (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
}

function isRewriteRequest(value: unknown): value is RewriteRequest {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as { mode?: unknown; tone?: unknown; text?: unknown; trigger?: unknown };
  return (
    typeof message.mode === 'string' &&
    MODES.has(message.mode as Mode) &&
    typeof message.tone === 'string' &&
    TONES.has(message.tone as Tone) &&
    typeof message.text === 'string' &&
    (message.trigger === undefined || message.trigger === 'idle')
  );
}

function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === 'test-connection' ||
    type === 'bridge-status' ||
    type === 'open-popup' ||
    type === 'page-settings' ||
    type === 'page-settings-changed'
  );
}

function post(port: RewritePort, event: RewriteEvent): void {
  try {
    port.postMessage(event);
  } catch {
    // The content script port can close while a chunk is in flight.
  }
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export default defineBackground(() => {
  void extension().storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

  extension().storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !('settings' in changes)) return;
    void extension()
      .tabs.query({})
      .then((tabs) =>
        Promise.all(
          tabs.map((tab) => {
            if (tab.id === undefined) return;
            return extension()
              .tabs.sendMessage(tab.id, { type: 'page-settings-changed' })
              .catch(() => {
                // A tab without the content script rejects sendMessage.
              });
          }),
        ),
      )
      .catch(() => {});
  });

  extension().runtime.onConnect.addListener((port) => {
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
      void loadSettings()
        .then(({ blocklist, idleFix, defaultMode }) => {
          const settings: PageSettings = { blocklist, idleFix, defaultMode };
          reply(settings);
        })
        .catch(() => reply(null));
      return true;
    }

    if (message.type === 'test-connection') {
      void loadSettings()
        .then((settings) => testConnection(settings, getProvider(settings.provider)))
        .then(reply)
        .catch((err: unknown) => {
          reply({ ok: false, message: errorMessage(err, 'Could not load settings.') });
        });
      return true;
    }

    void pingBridge()
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
});
