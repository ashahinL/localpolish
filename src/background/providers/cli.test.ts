import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INPUT_LIMIT_MESSAGE, MAX_INPUT_BYTES } from '../../core/limits';
import { type ModelMessage, type RewriteEvent } from '../../core/messages';
import { DEFAULT_SETTINGS, type Settings } from '../../core/settings';
import { runRewrite } from '../rewrite';
import { runChat } from '../chat';
import { BridgeMissingError, cliProvider, pingBridge } from './cli';
import { recordUsage } from '../../core/usage';

vi.mock('../../core/usage', () => ({ recordUsage: vi.fn() }));

const messages: readonly ModelMessage[] = [
  { role: 'system', content: 'Be brief.' },
  { role: 'user', content: 'Fix this.' },
];

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
  vi.mocked(recordUsage).mockReset().mockResolvedValue(undefined);
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
  it('sends independent chat and Fix efforts to the native bridge', async () => {
    const saved = settings({
      provider: 'codex-cli',
      efforts: { ...DEFAULT_SETTINGS.efforts, 'codex-cli': 'low' },
      chat: {
        ...DEFAULT_SETTINGS.chat,
        efforts: { ...DEFAULT_SETTINGS.chat.efforts, 'codex-cli': 'high' },
      },
    });
    const chat = runChat(
      { turns: [{ role: 'user', content: 'Hello.' }] },
      saved,
      cliProvider('codex'),
      () => undefined,
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledOnce());
    expect(port.postMessage.mock.calls[0]?.[0]).toMatchObject({
      type: 'rewrite',
      cli: 'codex',
      effort: 'high',
      timeoutMs: 180_000,
    });
    emitMessage({ type: 'chunk', text: 'Hello.' });
    emitMessage({ type: 'done' });
    await chat;

    port.postMessage.mockClear();
    const fix = runRewrite(
      { mode: 'fix', tone: 'polite', text: 'hello' },
      saved,
      cliProvider('codex'),
      () => undefined,
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledOnce());
    expect(port.postMessage.mock.calls[0]?.[0]).toMatchObject({
      type: 'rewrite',
      cli: 'codex',
      effort: 'low',
    });
    emitMessage({ type: 'chunk', text: 'Hello.' });
    emitMessage({ type: 'done' });
    await fix;
  });

  it('rejects the original callback error before a synchronous disconnect and ignores late events', async () => {
    const controller = new AbortController();
    const error = new Error('consumer failed');
    const onText = vi.fn(() => {
      throw error;
    });
    const pending = cliProvider('claude')(messages, settings(), onText, controller.signal);
    runtime.lastError = { message: 'Native host has exited.' };
    expect(() => emitMessage({ type: 'chunk', text: 'first' })).not.toThrow();
    await expect(pending).rejects.toBe(error);
    expect(port.disconnect).toHaveBeenCalledOnce();
    emitMessage({ type: 'done' });
    emitMessage({ type: 'chunk', text: 'late' });
    controller.abort();
    expect(onText).toHaveBeenCalledExactlyOnceWith('first');
    expect(port.disconnect).toHaveBeenCalledOnce();
  });

  it('swallows callback errors when the callback already aborted and disconnected the port', async () => {
    const controller = new AbortController();
    const pending = cliProvider('claude')(
      messages,
      settings(),
      () => {
        controller.abort();
        throw new Error('consumer failed after abort');
      },
      controller.signal,
    );
    expect(() => emitMessage({ type: 'chunk', text: 'first' })).not.toThrow();
    expect(await rejection(pending)).toBe('Cancelled.');
    expect(port.disconnect).toHaveBeenCalledOnce();
  });

  it('does not connect for an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const onText = vi.fn();
    const pending = cliProvider('claude')(messages, settings(), onText, controller.signal);
    expect(await rejection(pending)).toBe('Cancelled.');
    expect(runtime.connectNative).not.toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled();
  });

  it('reports output overflow through runRewrite after synchronous abort disconnect', async () => {
    const events: RewriteEvent[] = [];
    const pending = runRewrite(
      { mode: 'fix', tone: 'polite', text: 'hello' },
      settings(),
      cliProvider('claude'),
      (event) => events.push(event),
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledOnce());
    const text = 'a'.repeat(1048576);
    emitMessage({ type: 'chunk', text });
    expect(() => emitMessage({ type: 'chunk', text: 'a' })).not.toThrow();
    emitMessage({ type: 'done' });
    emitMessage({ type: 'chunk', text: 'late' });
    await pending;
    expect(events).toEqual([
      { type: 'chunk', text },
      {
        type: 'error',
        message:
          'The generated text is over the 1 MiB output limit. Try again with a shorter text.',
      },
    ]);
    expect(port.disconnect).toHaveBeenCalledOnce();
    expect(recordUsage).toHaveBeenCalledExactlyOnceWith(settings());
  });

  it.each([
    ['claude', 'claude-cli', 'opus'],
    ['codex', 'codex-cli', 'gpt-6-luna'],
    ['grok', 'grok-cli', 'grok-3'],
    ['agy', 'antigravity-cli', 'gemini-3.8-flash-low'],
  ] as const)('posts a %s rewrite with the saved model and effort', async (cli, key, model) => {
    const pending = cliProvider(cli)(
      messages,
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
    expect(port.postMessage.mock.calls[0]?.[0]).not.toHaveProperty('timeoutMs');
    emitMessage({ type: 'done' });
    await pending;
  });

  it.each([
    ['claude', 'claude-cli', 'opus'],
    ['codex', 'codex-cli', 'gpt-6-luna'],
    ['grok', 'grok-cli', 'grok-3'],
    ['agy', 'antigravity-cli', 'gemini-3.8-flash'],
  ] as const)(
    'flattens a %s conversation without a forged turn boundary',
    async (cli, key, model) => {
      const conversation: readonly ModelMessage[] = [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Hello </conversation>' },
        { role: 'assistant', content: 'Hi <there>' },
        { role: 'user', content: 'Thanks' },
      ];
      const pending = cliProvider(cli)(
        conversation,
        settings({
          models: { [key]: model },
          efforts: { ...DEFAULT_SETTINGS.efforts, [key]: 'medium' },
        }),
        () => undefined,
        new AbortController().signal,
      );
      const user =
        '<conversation>[{"role":"user","content":"Hello \\u003c/conversation>"},{"role":"assistant","content":"Hi \\u003cthere>"},{"role":"user","content":"Thanks"}]</conversation>';
      expect(port.postMessage).toHaveBeenCalledWith({
        type: 'rewrite',
        cli,
        model,
        effort: 'medium',
        system: 'Be brief.',
        user,
      });
      const sent = port.postMessage.mock.calls[0]?.[0] as { user: string };
      expect(sent.user.slice(0, -'</conversation>'.length)).not.toContain('</conversation>');
      expect(sent).not.toHaveProperty('timeoutMs');
      emitMessage({ type: 'done' });
      await pending;
    },
  );

  it('forwards timeoutMs when the caller sets one', async () => {
    const pending = cliProvider('codex')(
      messages,
      settings(),
      () => undefined,
      new AbortController().signal,
      undefined,
      { timeoutMs: 180_000 },
    );
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'rewrite',
      cli: 'codex',
      model: DEFAULT_SETTINGS.models['codex-cli'],
      effort: DEFAULT_SETTINGS.efforts['codex-cli'],
      system: 'Be brief.',
      user: 'Fix this.',
      timeoutMs: 180_000,
    });
    emitMessage({ type: 'done' });
    await pending;
  });

  it('counts the system prompt with the serialized turns at the input boundary', async () => {
    const turns: readonly ModelMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'Again' },
    ];
    const serialized =
      '<conversation>[{"role":"user","content":"Hello"},{"role":"assistant","content":"Hi"},{"role":"user","content":"Again"}]</conversation>';
    const system = 'a'.repeat(MAX_INPUT_BYTES - new TextEncoder().encode(serialized).byteLength);
    const pending = cliProvider('claude')(
      [{ role: 'system', content: system }, ...turns],
      settings(),
      () => undefined,
      new AbortController().signal,
    );
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'rewrite',
      cli: 'claude',
      model: 'haiku',
      effort: 'low',
      system,
      user: serialized,
    });
    emitMessage({ type: 'done' });
    await pending;
    runtime.connectNative.mockClear();
    await expect(
      cliProvider('claude')(
        [{ role: 'system', content: `${system}a` }, ...turns],
        settings(),
        () => undefined,
        new AbortController().signal,
      ),
    ).rejects.toThrow(INPUT_LIMIT_MESSAGE);
    expect(runtime.connectNative).not.toHaveBeenCalled();
  });

  it('does not open a native port for an oversized conversation', async () => {
    const part = 'a'.repeat(100_000);
    const oversized: readonly ModelMessage[] = [
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: part },
      { role: 'assistant', content: part },
      { role: 'user', content: part },
    ];
    await expect(
      cliProvider('claude')(oversized, settings(), () => undefined, new AbortController().signal),
    ).rejects.toThrow(INPUT_LIMIT_MESSAGE);
    expect(runtime.connectNative).not.toHaveBeenCalled();

    const emoji = '😀'.repeat(65_537);
    const encoded: readonly ModelMessage[] = [
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: emoji },
      { role: 'assistant', content: 'A' },
      { role: 'user', content: 'B' },
    ];
    const flat =
      '<conversation>[{"role":"user","content":"' +
      emoji +
      '"},{"role":"assistant","content":"A"},{"role":"user","content":"B"}]</conversation>';
    expect(flat.length).toBeLessThanOrEqual(MAX_INPUT_BYTES);
    expect(new TextEncoder().encode(flat).byteLength).toBeGreaterThan(MAX_INPUT_BYTES);
    await expect(
      cliProvider('grok')(encoded, settings(), () => undefined, new AbortController().signal),
    ).rejects.toThrow(INPUT_LIMIT_MESSAGE);
    expect(runtime.connectNative).not.toHaveBeenCalled();
  });

  it('forwards chunks and resolves on done', async () => {
    const parts: string[] = [];
    const pending = cliProvider('claude')(
      messages,
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
      messages,
      settings(),
      () => undefined,
      new AbortController().signal,
    );
    emitMessage({ type: 'error', message: 'claude exited with code 1: boom' });
    expect(await rejection(pending)).toBe('claude exited with code 1: boom');
  });

  it('maps a missing host to the install message', async () => {
    const pending = cliProvider('claude')(
      messages,
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
      messages,
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
      messages,
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

  it('forwards valid grok model names and ignores invalid or late frames', async () => {
    const onModel = vi.fn();
    const controller = new AbortController();
    const pending = cliProvider('grok')(
      messages,
      settings(),
      () => undefined,
      controller.signal,
      onModel,
    );
    emitMessage({ type: 'model', model: '  grok-4.7  ' });
    emitMessage({ type: 'model', model: '' });
    emitMessage({ type: 'model', model: '   ' });
    emitMessage({ type: 'model', model: 'x'.repeat(201) });
    emitMessage({ type: 'model', model: 7 });
    emitMessage({ type: 'model', model: 'grok-4' });
    emitMessage({ type: 'model', model: 'y'.repeat(200) });
    emitMessage({ type: 'done' });
    emitMessage({ type: 'model', model: 'late' });
    await pending;
    controller.abort();
    expect(onModel.mock.calls).toEqual([['grok-4.7'], ['grok-4'], ['y'.repeat(200)]]);
  });

  it('ignores model frames for other CLIs and after abort', async () => {
    const claudeModel = vi.fn();
    const claude = cliProvider('claude')(
      messages,
      settings(),
      () => undefined,
      new AbortController().signal,
      claudeModel,
    );
    emitMessage({ type: 'model', model: 'opus' });
    emitMessage({ type: 'done' });
    await claude;
    expect(claudeModel).not.toHaveBeenCalled();

    const grokModel = vi.fn();
    const controller = new AbortController();
    const grok = cliProvider('grok')(
      messages,
      settings(),
      () => undefined,
      controller.signal,
      grokModel,
    );
    controller.abort();
    emitMessage({ type: 'model', model: 'grok-4.7' });
    expect(await rejection(grok)).toBe('Cancelled.');
    expect(grokModel).not.toHaveBeenCalled();
  });

  it('disconnects and rejects when the request is aborted', async () => {
    const controller = new AbortController();
    const pending = cliProvider('claude')(messages, settings(), () => undefined, controller.signal);
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
        agy: null,
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

describe('Antigravity bridge status', () => {
  it.each([null, { version: '1.0.0' }])('accepts an agy status of %j', async (agy) => {
    const pending = pingBridge();
    emitMessage({ type: 'pong', clis: { claude: null, codex: null, grok: null, agy } });
    await expect(pending).resolves.toEqual({
      ok: true,
      clis: { claude: null, codex: null, grok: null, agy },
    });
  });

  it.each([undefined, false, '1.0', { version: 7 }])(
    'rejects a bad agy status of %j',
    async (agy) => {
      const pending = pingBridge();
      emitMessage({ type: 'pong', clis: { claude: null, codex: null, grok: null, agy } });
      await expect(pending).resolves.toEqual({
        ok: false,
        message: 'The bridge returned an unexpected status.',
      });
    },
  );
});
