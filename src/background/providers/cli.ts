import { exceedsConversationLimit, INPUT_LIMIT_MESSAGE } from '../../core/limits';
import {
  BRIDGE_MISSING,
  type BridgeStatus,
  HOST_NAME,
  type ModelMessage,
} from '../../core/messages';
import { type Settings } from '../../core/settings';
import { type StreamFn } from './types';

type CliName = 'claude' | 'codex' | 'grok' | 'agy';

const MODEL_KEY = {
  claude: 'claude-cli',
  codex: 'codex-cli',
  grok: 'grok-cli',
  agy: 'antigravity-cli',
} as const satisfies Record<CliName, keyof Settings['models']>;

const NOT_INSTALLED =
  'The LocalPolish bridge is not installed. In the LocalPolish folder run: npm run bridge:install';

const PING_TIMEOUT_MS = 10_000;

export class BridgeMissingError extends Error {
  readonly code = BRIDGE_MISSING;

  constructor() {
    super(NOT_INSTALLED);
  }
}

interface NativePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(cb: (message: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

interface ExtensionRuntime {
  connectNative(host: string): NativePort;
  lastError?: { message?: string };
}

function runtime(): ExtensionRuntime {
  return (globalThis as unknown as { chrome: { runtime: ExtensionRuntime } }).chrome.runtime;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const MAX_REPORTED_MODEL_LENGTH = 200;

function reportedModelName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const model = value.trim();
  if (model.length === 0 || model.length > MAX_REPORTED_MODEL_LENGTH) return undefined;
  return model;
}

function bridgeStoppedMessage(detail: string | undefined): string {
  if (detail !== undefined && detail.includes('not found')) return NOT_INSTALLED;
  if (detail !== undefined && detail !== '') return `The bridge stopped: ${detail}`;
  return 'The bridge stopped unexpectedly.';
}

function closePort(port: NativePort): void {
  try {
    port.disconnect();
  } catch {
    // disconnect throws once the port is already closed.
  }
}

type CliStatus = { version: string } | null;

function readCliStatus(value: unknown): CliStatus | undefined {
  if (value === null) return null;
  if (typeof value !== 'object' || value === null) return undefined;
  const version = (value as { version?: unknown }).version;
  if (typeof version !== 'string') return undefined;
  return { version };
}

function readPong(value: unknown): BridgeStatus | undefined {
  if (!isRecord(value) || value.type !== 'pong' || !isRecord(value.clis)) return undefined;
  const claude = readCliStatus(value.clis.claude);
  const codex = readCliStatus(value.clis.codex);
  const grok = readCliStatus(value.clis.grok);
  const agy = Object.hasOwn(value.clis, 'agy') ? readCliStatus(value.clis.agy) : null;
  if (claude === undefined || codex === undefined || grok === undefined || agy === undefined)
    return undefined;
  return { ok: true, clis: { claude, codex, grok, agy } };
}

function singleExchange(messages: readonly ModelMessage[]): boolean {
  const first = messages[0];
  const second = messages[1];
  return messages.length === 2 && first?.role === 'system' && second?.role === 'user';
}

function wirePrompt(messages: readonly ModelMessage[]): { system: string; user: string } {
  const first = messages[0];
  if (singleExchange(messages)) {
    return { system: first?.content ?? '', user: messages[1]?.content ?? '' };
  }
  const turns = first?.role === 'system' ? messages.slice(1) : messages;
  // JSON keeps a turn inside its string. Escaping "<" stops page text from closing the tag.
  const json = JSON.stringify(
    turns.map((message) => ({ role: message.role, content: message.content })),
  ).replaceAll('<', '\\u003c');
  return {
    system: first?.role === 'system' ? first.content : '',
    user: `<conversation>${json}</conversation>`,
  };
}

export function cliProvider(cli: CliName): StreamFn {
  return (messages, settings, onText, signal, onModel, options) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Cancelled.'));
        return;
      }

      const wire = wirePrompt(messages);
      if (
        !singleExchange(messages) &&
        exceedsConversationLimit([{ content: wire.system }, { content: wire.user }])
      ) {
        reject(new Error(INPUT_LIMIT_MESSAGE));
        return;
      }

      const port = runtime().connectNative(HOST_NAME);
      let settled = false;

      const onAbort = () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        closePort(port);
        reject(new Error('Cancelled.'));
      };

      signal.addEventListener('abort', onAbort);

      port.onMessage.addListener((message: unknown) => {
        if (settled || !isRecord(message)) return;
        if (message.type === 'model') {
          if ((cli === 'grok' || cli === 'agy') && !signal.aborted) {
            const model = reportedModelName(message.model);
            if (model !== undefined) onModel?.(model);
          }
          return;
        }
        if (message.type === 'chunk') {
          if (typeof message.text === 'string') {
            try {
              onText(message.text);
            } catch (err) {
              if (settled) return;
              settled = true;
              signal.removeEventListener('abort', onAbort);
              reject(err);
              closePort(port);
            }
          }
          return;
        }
        if (message.type === 'done') {
          settled = true;
          signal.removeEventListener('abort', onAbort);
          resolve();
          return;
        }
        if (message.type === 'error') {
          settled = true;
          signal.removeEventListener('abort', onAbort);
          const detail =
            typeof message.message === 'string' ? message.message : 'The bridge returned an error.';
          reject(new Error(detail));
        }
      });

      port.onDisconnect.addListener(() => {
        // Read it even after "done", or Chrome logs "Unchecked runtime.lastError".
        const detail = runtime().lastError?.message;
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        const stopped = bridgeStoppedMessage(detail);
        reject(stopped === NOT_INSTALLED ? new BridgeMissingError() : new Error(stopped));
      });

      port.postMessage({
        type: 'rewrite',
        cli,
        model: settings.models[MODEL_KEY[cli]],
        effort: settings.efforts[MODEL_KEY[cli]],
        system: wire.system,
        user: wire.user,
        ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      });
    });
}

export function pingBridge(): Promise<BridgeStatus> {
  return new Promise((resolve) => {
    let port: NativePort;
    try {
      port = runtime().connectNative(HOST_NAME);
    } catch (err) {
      const detail = err instanceof Error ? err.message : undefined;
      resolve({ ok: false, message: bridgeStoppedMessage(detail) });
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, message: 'The bridge did not respond.' });
      closePort(port);
    }, PING_TIMEOUT_MS);

    const finish = (status: BridgeStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };

    port.onMessage.addListener((message: unknown) => {
      if (!isRecord(message)) return;
      if (message.type === 'error') {
        const detail =
          typeof message.message === 'string' ? message.message : 'The bridge returned an error.';
        finish({ ok: false, message: detail });
        return;
      }
      if (message.type !== 'pong') return;
      const status = readPong(message);
      finish(status ?? { ok: false, message: 'The bridge returned an unexpected status.' });
    });

    port.onDisconnect.addListener(() => {
      finish({ ok: false, message: bridgeStoppedMessage(runtime().lastError?.message) });
    });

    try {
      port.postMessage({ type: 'ping' });
    } catch (err) {
      const detail = err instanceof Error ? err.message : undefined;
      finish({ ok: false, message: bridgeStoppedMessage(detail) });
    }
  });
}
