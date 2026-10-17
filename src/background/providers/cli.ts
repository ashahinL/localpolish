import { type BridgeStatus, HOST_NAME } from '../../core/messages';
import { type Settings } from '../../core/settings';
import { type StreamFn } from './types';

type CliName = 'claude' | 'codex' | 'grok';

const MODEL_KEY = {
  claude: 'claude-cli',
  codex: 'codex-cli',
  grok: 'grok-cli',
} as const satisfies Record<CliName, keyof Settings['models']>;

const NOT_INSTALLED =
  'The LocalPolish bridge is not installed. In the LocalPolish folder run: npm run bridge:install';

const PING_TIMEOUT_MS = 10_000;

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
  if (claude === undefined || codex === undefined || grok === undefined) return undefined;
  return { ok: true, clis: { claude, codex, grok } };
}

export function cliProvider(cli: CliName): StreamFn {
  return (prompt, settings, onText, signal) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Cancelled.'));
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
        if (message.type === 'chunk') {
          if (typeof message.text === 'string') onText(message.text);
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
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        reject(new Error(bridgeStoppedMessage(runtime().lastError?.message)));
      });

      port.postMessage({
        type: 'rewrite',
        cli,
        model: settings.models[MODEL_KEY[cli]],
        effort: settings.efforts[MODEL_KEY[cli]],
        system: prompt.system,
        user: prompt.user,
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
