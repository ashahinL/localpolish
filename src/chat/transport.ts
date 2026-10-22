import {
  BRIDGE_MISSING,
  CHAT_PORT,
  CHAT_TOO_BIG,
  type ChatEvent,
  type ChatRequest,
} from '../core/messages';

interface ChatPort {
  postMessage(message: ChatRequest): void;
  disconnect(): void;
  onMessage: { addListener(cb: (message: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

interface PanelChrome {
  runtime: {
    connect(options: { name: string }): ChatPort;
    lastError?: { message?: string };
  };
}

function extension(): PanelChrome {
  return (globalThis as unknown as { chrome: PanelChrome }).chrome;
}

export type ChatOutcome = Exclude<ChatEvent, { type: 'chunk' }>;

function isChatEvent(value: unknown): value is ChatEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as { type?: unknown; text?: unknown; message?: unknown; code?: unknown };
  if (event.type === 'chunk' || event.type === 'done') return typeof event.text === 'string';
  return (
    event.type === 'error' &&
    typeof event.message === 'string' &&
    (event.code === undefined || event.code === BRIDGE_MISSING || event.code === CHAT_TOO_BIG)
  );
}

/** One port per turn. Resolves with the outcome, or undefined once the signal aborts. */
export function sendChat(
  request: ChatRequest,
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<ChatOutcome | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let port: ChatPort | undefined;
    let settled = false;
    const finish = (outcome: ChatOutcome | undefined) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      try {
        port?.disconnect();
      } catch {
        // The worker may have closed the port first.
      }
      resolve(outcome);
    };
    const onAbort = () => finish(undefined);
    signal.addEventListener('abort', onAbort);
    try {
      port = extension().runtime.connect({ name: CHAT_PORT });
      port.onMessage.addListener((message) => {
        if (settled) return;
        if (!isChatEvent(message)) {
          finish({ type: 'error', message: 'The chat answer was not understood.' });
          return;
        }
        if (message.type === 'chunk') onChunk(message.text);
        else finish(message);
      });
      port.onDisconnect.addListener(() => {
        // Reading lastError also marks it as checked, so Chrome does not log it.
        const detail = extension().runtime.lastError?.message;
        const message = 'The chat stopped before it finished. Try again.';
        finish({ type: 'error', message: detail ? `${message} (${detail})` : message });
      });
      port.postMessage(request);
    } catch (err) {
      finish({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not reach the extension.',
      });
    }
  });
}
