import { pingBridge } from '../background/providers/cli';
import { getProvider } from '../background/providers';
import { runRewrite, testConnection } from '../background/rewrite';
import {
  REWRITE_PORT,
  type RewriteEvent,
  type RewriteRequest,
  type RuntimeMessage,
} from '../core/messages';
import { loadSettings, type Mode, type Tone } from '../core/settings';

const MODES = new Set<Mode>(['fix', 'rephrase', 'shorter', 'tone']);
const TONES = new Set<Tone>(['polite', 'formal', 'casual', 'angry-civil']);

interface RewritePort {
  name: string;
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
    query(queryInfo: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number }>>;
    sendMessage(tabId: number, message: RuntimeMessage): Promise<unknown>;
  };
}

function extension(): ExtensionChrome {
  return (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
}

function isRewriteRequest(value: unknown): value is RewriteRequest {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as { mode?: unknown; tone?: unknown; text?: unknown };
  return (
    typeof message.mode === 'string' &&
    MODES.has(message.mode as Mode) &&
    typeof message.tone === 'string' &&
    TONES.has(message.tone as Tone) &&
    typeof message.text === 'string'
  );
}

function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'test-connection' || type === 'bridge-status' || type === 'open-popup';
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
    if (!isRuntimeMessage(message) || message.type === 'open-popup') return;

    const reply = (response: unknown) => {
      try {
        sendResponse(response);
      } catch {
        // The options page can close before the reply is ready.
      }
    };

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
