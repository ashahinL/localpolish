import { type BridgeStatus, type RuntimeMessage, type TestResult } from '../core/messages';

interface Command {
  name?: string;
  shortcut?: string;
}

type StorageListener = (changes: Record<string, unknown>, areaName: string) => void;

interface OptionsChrome {
  runtime: { sendMessage(message: RuntimeMessage): Promise<unknown> };
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

export function bridgeStatus(): Promise<BridgeStatus> {
  return ask<BridgeStatus>({ type: 'bridge-status' });
}

export function testConnection(): Promise<TestResult> {
  return ask<TestResult>({ type: 'test-connection' });
}

export async function polishShortcut(): Promise<string> {
  const commands = await extension().commands.getAll();
  return commands.find((command) => command.name === 'polish')?.shortcut ?? '';
}

export function openShortcutsPage(): void {
  void extension().tabs.create({ url: 'chrome://extensions/shortcuts' });
}

export function onSettingsChanged(cb: () => void): () => void {
  const listener: StorageListener = (changes, areaName) => {
    if (areaName === 'local' && 'settings' in changes) cb();
  };
  extension().storage.onChanged.addListener(listener);
  return () => extension().storage.onChanged.removeListener(listener);
}
