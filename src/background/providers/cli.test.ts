import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../core/settings';
import { BridgeMissingError, cliProvider, pingBridge } from './cli';
import { type PromptPair } from './types';

const prompt: PromptPair = { system: 'Be brief.', user: 'Fix this.' };

interface FakePort {
  postMessage: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onMessage: { addListener: (cb: (message: unknown) => void) => void };
  onDisconnect: { addListener: (cb: () => void) => void };
}

function settings(
  patch: Partial<Omit<Settings, 'models'>> & { models?: Partial<Settings['models']> } = {},
): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...patch,
    models: { ...DEFAULT_SETTINGS.models, ...patch.models },
  };
}

let port: FakePort;
let emitMessage: (message: unknown) => void;
let emitDisconnect: () => void;
let runtime: { lastError?: { message?: string }; connectNative: ReturnType<typeof vi.fn> };

beforeEach(() => {
  const onMessage: Array<(message: unknown) => void> = [];
  const onDisconnect: Array<() => void> = [];
  port = {
    postMessage: vi.fn(),
    disconnect: vi.fn(() => {
      for (const listener of onDisconnect) listener();
    }),
    onMessage: {
      addListener: (cb) => {
        onMessage.push(cb);
      },
    },
    onDisconnect: {
      addListener: (cb) => {
        onDisconnect.push(cb);
      },
    },
  };
  emitMessage = (message) => {
    for (const listener of onMessage) listener(message);
  };
  emitDisconnect = () => {
    for (const listener of onDisconnect) listener();
  };
  runtime = {
    lastError: undefined,
    connectNative: vi.fn(() => port),
  };
  (globalThis as unknown as { chrome: { runtime: typeof runtime } }).chrome = { runtime };
});

async function rejection(pending: Promise<unknown>): Promise<string> {
  try {
    await pending;
  } catch (err) {
    if (err instanceof Error) return err.message;
    throw err;
  }
  throw new Error('expected a rejection');
}

describe('cliProvider', () => {
  it.each([
    ['claude', 'claude-cli', 'opus'],
    ['codex', 'codex-cli', 'gpt-6-luna'],
    ['grok', 'grok-cli', 'grok-3'],
  ] as const)('posts a %s rewrite with the saved model and effort', async (cli, key, model) => {
    const pending = cliProvider(cli)(
      prompt,
      settings({
        models: { [key]: model },
        efforts: { ...DEFAULT_SETTINGS.efforts, [key]: 'medium' },
      }),
      () => undefined,
      new AbortController().signal,
    );

    expect(runtime.connectNative).toHaveBeenCalledWith('com.localpolish.bridge');
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'rewrite',
      cli,
      model,
      effort: 'medium',
      system: 'Be brief.',
      user: 'Fix this.',
    });
    emitMessage({ type: 'done' });
    await pending;
  });

  it('forwards chunks and resolves on done', async () => {
    const parts: string[] = [];
    const pending = cliProvider('claude')(
      prompt,
      settings({ models: { 'claude-cli': 'sonnet' } }),
      (text) => parts.push(text),
      new AbortController().signal,
    );

    emitMessage({ type: 'chunk', text: 'I ' });
    emitMessage({ type: 'chunk', text: 'went.' });
    emitMessage({ type: 'done' });
    await pending;
    expect(parts).toEqual(['I ', 'went.']);
  });

  it('rejects with the bridge error message', async () => {
    const pending = cliProvider('claude')(
      prompt,
      settings(),
      () => undefined,
      new AbortController().signal,
    );
    emitMessage({ type: 'error', message: 'claude exited with code 1: boom' });
    expect(await rejection(pending)).toBe('claude exited with code 1: boom');
  });

  it('maps a missing host to the install message', async () => {
    const pending = cliProvider('claude')(
      prompt,
      settings(),
      () => undefined,
      new AbortController().signal,
    );
    runtime.lastError = { message: 'Specified native messaging host not found.' };
    emitDisconnect();
    await expect(pending).rejects.toBeInstanceOf(BridgeMissingError);
    expect(await rejection(pending)).toBe(
      'The LocalPolish bridge is not installed. In the LocalPolish folder run: npm run bridge:install',
    );
  });

  it('includes the disconnect message when the host stops', async () => {
    const pending = cliProvider('claude')(
      prompt,
      settings(),
      () => undefined,
      new AbortController().signal,
    );
    runtime.lastError = { message: 'Native host has exited.' };
    emitDisconnect();
    expect(await rejection(pending)).toBe('The bridge stopped: Native host has exited.');
  });

  it('reads lastError when the host exits after done', async () => {
    const pending = cliProvider('claude')(
      prompt,
      settings(),
      () => undefined,
      new AbortController().signal,
    );
    emitMessage({ type: 'done' });
    await pending;
    const read = vi.fn(() => ({ message: 'Native host has exited.' }));
    Object.defineProperty(runtime, 'lastError', { get: read });
    emitDisconnect();
    expect(read).toHaveBeenCalled();
  });

  it('disconnects and rejects when the request is aborted', async () => {
    const controller = new AbortController();
    const pending = cliProvider('claude')(prompt, settings(), () => undefined, controller.signal);
    controller.abort();
    expect(port.disconnect).toHaveBeenCalledOnce();
    expect(await rejection(pending)).toBe('Cancelled.');
  });
});

describe('pingBridge', () => {
  it('returns the CLI versions from a pong', async () => {
    const pending = pingBridge();
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'ping' });
    emitMessage({
      type: 'pong',
      clis: {
        claude: { version: '1.2.3' },
        codex: null,
        grok: { version: '0.4.0' },
      },
    });
    await expect(pending).resolves.toEqual({
      ok: true,
      clis: {
        claude: { version: '1.2.3' },
        codex: null,
        grok: { version: '0.4.0' },
      },
    });
  });

  it('maps a missing host to the install message', async () => {
    const pending = pingBridge();
    runtime.lastError = { message: 'Specified native messaging host not found.' };
    emitDisconnect();
    await expect(pending).resolves.toEqual({
      ok: false,
      message:
        'The LocalPolish bridge is not installed. In the LocalPolish folder run: npm run bridge:install',
    });
  });

  it('fails when the bridge does not answer within 10 seconds', async () => {
    vi.useFakeTimers();
    try {
      const pending = pingBridge();
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toEqual({
        ok: false,
        message: 'The bridge did not respond.',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
