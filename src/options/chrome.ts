import {
  TEST_PORT,
  type BridgeStatus,
  type RuntimeMessage,
  type TestResult,
  type TestStart,
  type TestEvent,
} from '../core/messages';

interface Command {
  name?: string;
  shortcut?: string;
}

type StorageListener = (changes: Record<string, unknown>, areaName: string) => void;

interface TestPort {
  postMessage(message: TestStart): void;
  disconnect(): void;
  onMessage: { addListener(cb: (message: TestEvent) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

interface OptionsChrome {
  runtime: {
    sendMessage(message: RuntimeMessage): Promise<unknown>;
    connect(options: { name: string }): TestPort;
    lastError?: { message?: string };
  };
  storage: {
    onChanged: {
      addListener(cb: StorageListener): void;
      removeListener(cb: StorageListener): void;
    };
  };
  commands: { getAll(): Promise<Command[]> };
  tabs: { create(props: { url: string }): Promise<unknown> };
}

function extension(): OptionsChrome {
  return (globalThis as unknown as { chrome: OptionsChrome }).chrome;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function ask<T>(message: RuntimeMessage): Promise<T | { ok: false; message: string }> {
  try {
    const response = await extension().runtime.sendMessage(message);
    if (response === undefined) {
      return { ok: false, message: 'The extension background did not answer.' };
    }
    return response as T;
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

export function bridgeStatus(force = false): Promise<BridgeStatus> {
  return ask<BridgeStatus>({ type: 'bridge-status', force });
}

export function testConnection(signal: AbortSignal): Promise<TestResult> {
  if (signal.aborted) return Promise.resolve({ ok: false, message: 'Cancelled.' });
  return new Promise((resolve) => {
    let port: TestPort | undefined;
    let settled = false;
    const finish = (result: TestResult) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(result);
      try {
        port?.disconnect();
      } catch {
        // The owner may have already closed the port.
      }
    };
    const onAbort = () => finish({ ok: false, message: 'Cancelled.' });
    try {
      port = extension().runtime.connect({ name: TEST_PORT });
      port.onDisconnect.addListener(() => {
        const detail = extension().runtime.lastError?.message;
        finish({ ok: false, message: detail || 'The extension background did not answer.' });
      });
      port.onMessage.addListener((message) => {
        if (message.type === 'result') finish(message.result);
      });
      signal.addEventListener('abort', onAbort);
      if (signal.aborted) onAbort();
      if (!settled) port.postMessage({ type: 'test-connection' });
    } catch (err) {
      finish({ ok: false, message: errorMessage(err) });
    }
  });
}

export async function polishShortcut(): Promise<string> {
  const commands = await extension().commands.getAll();
  return commands.find((command) => command.name === 'polish')?.shortcut ?? '';
}

export function openShortcutsPage(): void {
  void extension().tabs.create({ url: 'chrome://extensions/shortcuts' });
}

export function onSettingsChanged(cb: () => void): () => void {
  return onStorageKeyChanged('settings', cb);
}

export function onStorageKeyChanged(key: string, cb: () => void): () => void {
  const listener: StorageListener = (changes, areaName) => {
    if (areaName === 'local' && key in changes) cb();
  };
  extension().storage.onChanged.addListener(listener);
  return () => extension().storage.onChanged.removeListener(listener);
}
