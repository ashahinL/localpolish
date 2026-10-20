import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings } from '../core/settings';
import { runRewrite } from './rewrite';

vi.mock('../core/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/settings')>()),
  loadSettings: vi.fn(),
}));
vi.mock('./rewrite', () => ({ runRewrite: vi.fn(), testConnection: vi.fn() }));
vi.mock('./providers', () => ({ getProvider: vi.fn() }));

function nativePort() {
  const messages: Array<(message: unknown) => void> = [];
  const disconnects: Array<() => void> = [];
  const emitDisconnect = () => disconnects.forEach((listener) => listener());
  return {
    postMessage: vi.fn(),
    disconnect: vi.fn(emitDisconnect),
    onMessage: { addListener: vi.fn((cb: (message: unknown) => void) => messages.push(cb)) },
    onDisconnect: { addListener: vi.fn((cb: () => void) => disconnects.push(cb)) },
    emitMessage: (message: unknown) => messages.forEach((listener) => listener(message)),
    emitDisconnect,
  };
}

async function startBackground() {
  const onConnect = vi.fn();
  const onInstalled = vi.fn();
  const create = vi.fn().mockResolvedValue(undefined);
  const onRuntimeMessage = vi.fn();
  const onStorageChanged = vi.fn();
  const setAccessLevel = vi.fn().mockResolvedValue(undefined);
  const query = vi.fn().mockResolvedValue([]);
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const nativePorts: Array<ReturnType<typeof nativePort>> = [];
  const connectNative = vi.fn(() => {
    const port = nativePort();
    nativePorts.push(port);
    return port;
  });
  vi.stubGlobal('defineBackground', (start: () => void) => start());
  vi.stubGlobal('chrome', {
    runtime: {
      connectNative,
      onInstalled: { addListener: onInstalled },
      getURL: (path: string) => `chrome-extension://localpolish${path}`,
      onConnect: { addListener: onConnect },
      onMessage: { addListener: onRuntimeMessage },
    },
    commands: { onCommand: { addListener: vi.fn() } },
    storage: {
      local: { setAccessLevel },
      onChanged: { addListener: onStorageChanged },
    },
    tabs: { query, sendMessage, create },
  });
  await import('../entrypoints/background');
  const message = onRuntimeMessage.mock.calls[0]?.[0];
  const storageChanged = onStorageChanged.mock.calls[0]?.[0];
  if (!message || !storageChanged) throw new Error('Background settings listeners not registered');
  const installed = onInstalled.mock.calls[0]?.[0] as
    ((details: { reason: string }) => void) | undefined;
  if (!installed) throw new Error('No onInstalled listener');
  return {
    onConnect,
    message,
    storageChanged,
    setAccessLevel,
    query,
    sendMessage,
    installed,
    create,
    connectNative,
    nativePorts,
    request: (value: unknown) =>
      new Promise<unknown>((resolve) => {
        expect(message(value, {}, resolve)).toBe(true);
      }),
  };
}

async function connect(sender?: { tab?: { url?: string }; url?: string }) {
  const { onConnect } = await startBackground();
  const onMessage = vi.fn();
  const postMessage = vi.fn();
  const listener = onConnect.mock.calls[0]?.[0];
  if (!listener) throw new Error('No rewrite port listener');
  listener({
    name: 'rewrite',
    sender,
    postMessage,
    onMessage: { addListener: onMessage },
    onDisconnect: { addListener: vi.fn() },
  });
  const send = onMessage.mock.calls[0]?.[0] as ((message: unknown) => void) | undefined;
  if (!send) throw new Error('No rewrite message listener');
  return { send, postMessage };
}

describe('background settings and rewrite ports', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(loadSettings).mockResolvedValue({
      ...DEFAULT_SETTINGS,
      blocklist: ['blocked.example'],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('restricts local storage to trusted contexts at startup', async () => {
    const background = await startBackground();
    expect(background.setAccessLevel).toHaveBeenCalledExactlyOnceWith({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
  });

  it('answers page-settings with only site, idle and default mode settings', async () => {
    vi.mocked(loadSettings).mockResolvedValue({
      ...DEFAULT_SETTINGS,
      openaiApiKey: 'fake-openai-secret',
      anthropicApiKey: 'fake-anthropic-secret',
      blocklist: ['blocked.example'],
      idleFix: false,
      defaultMode: 'shorter',
    });
    const background = await startBackground();
    const reply = vi.fn();
    const keepOpen = background.message({ type: 'page-settings' }, {}, reply);
    expect(keepOpen).toBe(true);
    await vi.waitFor(() =>
      expect(reply).toHaveBeenCalledExactlyOnceWith({
        blocklist: ['blocked.example'],
        idleFix: false,
        defaultMode: 'shorter',
      }),
    );
  });

  it('answers a failed page-settings read without returning stored settings', async () => {
    vi.mocked(loadSettings).mockRejectedValue(new Error('Storage unavailable'));
    const background = await startBackground();
    const reply = vi.fn();
    background.message({ type: 'page-settings' }, {}, reply);
    await vi.waitFor(() => expect(reply).toHaveBeenCalledExactlyOnceWith(null));
  });

  it('notifies every tab without forwarding the storage record', async () => {
    const background = await startBackground();
    background.query.mockResolvedValue([{ id: 1 }, { id: 2 }, {}, { id: 3 }]);
    background.sendMessage.mockRejectedValueOnce(new Error('No content script'));
    background.storageChanged({ settings: { newValue: { openaiApiKey: 'fake-secret' } } }, 'local');
    await vi.waitFor(() => expect(background.sendMessage).toHaveBeenCalledTimes(3));
    expect(background.query).toHaveBeenCalledExactlyOnceWith({});
    expect(background.sendMessage.mock.calls).toEqual([
      [1, { type: 'page-settings-changed' }],
      [2, { type: 'page-settings-changed' }],
      [3, { type: 'page-settings-changed' }],
    ]);
  });

  it.each([
    [{ settings: {} }, 'sync'],
    [{ settings: {} }, 'session'],
    [{ other: {} }, 'local'],
  ])('ignores unrelated storage changes: %j, %s', async (changes, areaName) => {
    const background = await startBackground();
    background.storageChanged(changes, areaName);
    expect(background.query).not.toHaveBeenCalled();
    expect(background.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    { tab: { url: 'https://blocked.example/page' }, url: 'https://editor.example/' },
    { tab: { url: 'https://site.example/' }, url: 'https://blocked.example/editor' },
  ])('rejects idle requests when a sender host is blocked: %j', async (sender) => {
    const port = await connect(sender);
    port.send({ mode: 'fix', tone: 'polite', text: 'sample text', trigger: 'idle' });
    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith({
        type: 'error',
        message: 'LocalPolish is off on this site.',
      });
    });
    expect(runRewrite).not.toHaveBeenCalled();
  });

  it('rejects idle requests when idle Fix is off', async () => {
    vi.mocked(loadSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, idleFix: false });
    const port = await connect({ tab: { url: 'https://site.example/' } });
    port.send({ mode: 'fix', tone: 'polite', text: 'sample text', trigger: 'idle' });
    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith({
        type: 'error',
        message: 'LocalPolish is off on this site.',
      });
    });
    expect(runRewrite).not.toHaveBeenCalled();
  });

  it.each(['about:blank', 'invalid URL'])('ignores sender URLs with no host: %s', async (url) => {
    const port = await connect({ tab: { url: 'https://site.example/' }, url });
    const request = { mode: 'fix', tone: 'polite', text: 'sample text', trigger: 'idle' };
    port.send(request);
    await vi.waitFor(() => expect(runRewrite).toHaveBeenCalledTimes(1));
    expect(vi.mocked(runRewrite).mock.calls[0]?.[0]).toEqual(request);
  });

  it('allows manual requests on blocked sites with idle Fix off', async () => {
    vi.mocked(loadSettings).mockResolvedValue({
      ...DEFAULT_SETTINGS,
      idleFix: false,
      blocklist: ['blocked.example'],
    });
    const port = await connect({ tab: { url: 'https://blocked.example/' } });
    const request = { mode: 'fix', tone: 'polite', text: 'sample text' };
    port.send(request);
    await vi.waitFor(() => expect(runRewrite).toHaveBeenCalledTimes(1));
    expect(vi.mocked(runRewrite).mock.calls[0]?.[0]).toEqual(request);
  });

  it('rejects unknown triggers', async () => {
    const port = await connect();
    port.send({ mode: 'fix', tone: 'polite', text: 'sample text', trigger: 'other' });
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'error',
      message: 'The rewrite request was not understood.',
    });
    expect(loadSettings).not.toHaveBeenCalled();
    expect(runRewrite).not.toHaveBeenCalled();
  });
});

describe('onInstalled', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('opens the setup page on a fresh install', async () => {
    const { installed, create } = await startBackground();
    installed({ reason: 'install' });
    expect(create).toHaveBeenCalledWith({ url: 'chrome-extension://localpolish/setup.html' });
  });

  it.each(['update', 'chrome_update', 'shared_module_update'])(
    'opens nothing on %s',
    async (reason) => {
      const { installed, create } = await startBackground();
      installed({ reason });
      expect(create).not.toHaveBeenCalled();
    },
  );
});

describe('background bridge health', () => {
  const pong = {
    type: 'pong',
    clis: { claude: { version: '2.4.1' }, codex: { version: '' }, grok: null },
  };
  const success = {
    ok: true,
    clis: { claude: { version: '2.4.1' }, codex: { version: '' }, grok: null },
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([false, true])(
    'shares one native ping with a concurrent force=%s caller',
    async (force) => {
      const background = await startBackground();
      const first = background.request({ type: 'bridge-status' });
      const second = background.request({ type: 'bridge-status', force });
      expect(background.connectNative).toHaveBeenCalledExactlyOnceWith('com.localpolish.bridge');
      expect(background.nativePorts[0]!.postMessage).toHaveBeenCalledExactlyOnceWith({
        type: 'ping',
      });
      background.nativePorts[0]!.emitMessage(pong);
      expect(await Promise.all([first, second])).toEqual([success, success]);
      expect(await background.request({ type: 'bridge-status' })).toEqual(success);
      expect(background.connectNative).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('caches only parsed health data without reading settings', async () => {
    const background = await startBackground();
    const pending = background.request({ type: 'bridge-status', text: 'private draft' });
    background.nativePorts[0]!.emitMessage({
      ...pong,
      settings: { openaiApiKey: 'fake-secret' },
      text: 'private draft',
      clis: { ...pong.clis, claude: { version: '2.4.1', text: 'private draft' } },
    });
    expect(await pending).toEqual(success);
    expect(await background.request({ type: 'bridge-status' })).toEqual(success);
    expect(loadSettings).not.toHaveBeenCalled();
    expect(background.connectNative).toHaveBeenCalledOnce();
  });

  it('keeps shared transport and replies working when one caller closes', async () => {
    const background = await startBackground();
    const closedReply = vi.fn(() => {
      throw new Error('Page closed');
    });
    expect(background.message({ type: 'bridge-status' }, {}, closedReply)).toBe(true);
    const pending = background.request({ type: 'bridge-status', force: true });
    expect(background.connectNative).toHaveBeenCalledOnce();
    background.nativePorts[0]!.emitMessage(pong);
    expect(await pending).toEqual(success);
    expect(closedReply).toHaveBeenCalledExactlyOnceWith(success);
    expect(background.nativePorts[0]!.disconnect).not.toHaveBeenCalled();
    expect(await background.request({ type: 'bridge-status' })).toEqual(success);
    expect(background.connectNative).toHaveBeenCalledOnce();
  });

  it('forces a new completed result and makes normal callers share that refresh', async () => {
    const background = await startBackground();
    const initial = background.request({ type: 'bridge-status' });
    background.nativePorts[0]!.emitMessage(pong);
    expect(await initial).toEqual(success);

    const forced = background.request({ type: 'bridge-status', force: true });
    const normal = background.request({ type: 'bridge-status' });
    const alsoForced = background.request({ type: 'bridge-status', force: true });
    expect(background.connectNative).toHaveBeenCalledTimes(2);
    expect(background.nativePorts[1]!.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'ping',
    });
    background.nativePorts[1]!.emitMessage({
      ...pong,
      clis: { ...pong.clis, grok: { version: 'new' } },
    });
    const refreshed = { ...success, clis: { ...success.clis, grok: { version: 'new' } } };
    expect(await Promise.all([forced, normal, alsoForced])).toEqual([
      refreshed,
      refreshed,
      refreshed,
    ]);
    expect(await background.request({ type: 'bridge-status' })).toEqual(refreshed);
    expect(background.connectNative).toHaveBeenCalledTimes(2);
  });

  it.each(['true'])('only literal true bypasses success: %j', async (force) => {
    const background = await startBackground();
    const initial = background.request({ type: 'bridge-status' });
    background.nativePorts[0]!.emitMessage(pong);
    expect(await initial).toEqual(success);
    expect(await background.request({ type: 'bridge-status', force })).toEqual(success);
    expect(background.connectNative).toHaveBeenCalledOnce();
  });

  it('expires exactly 30,000 milliseconds after completion, rather than start', async () => {
    const background = await startBackground();
    const initial = background.request({ type: 'bridge-status' });
    vi.setSystemTime(9_000);
    background.nativePorts[0]!.emitMessage(pong);
    expect(await initial).toEqual(success);
    vi.setSystemTime(38_999);
    expect(await background.request({ type: 'bridge-status' })).toEqual(success);
    expect(background.connectNative).toHaveBeenCalledOnce();
    vi.setSystemTime(39_000);
    const expired = background.request({ type: 'bridge-status' });
    expect(background.connectNative).toHaveBeenCalledTimes(2);
    background.nativePorts[1]!.emitMessage(pong);
    expect(await expired).toEqual(success);
  });

  it.each([
    ['error', 'health failed'],
    ['invalid pong', 'The bridge returned an unexpected status.'],
    ['disconnect', 'The bridge stopped unexpectedly.'],
    ['connect throw', 'The bridge stopped: connect failed'],
    ['post throw', 'The bridge stopped: post failed'],
    ['timeout', 'The bridge did not respond.'],
  ])(
    'replies to every caller on %s, invalidates old success and allows retry',
    async (failure, message) => {
      const background = await startBackground();
      const initial = background.request({ type: 'bridge-status' });
      background.nativePorts[0]!.emitMessage(pong);
      expect(await initial).toEqual(success);

      if (failure === 'connect throw') {
        background.connectNative.mockImplementationOnce(() => {
          throw new Error('connect failed');
        });
      } else if (failure === 'post throw') {
        background.connectNative.mockImplementationOnce(() => {
          const port = nativePort();
          background.nativePorts.push(port);
          port.postMessage.mockImplementationOnce(() => {
            throw new Error('post failed');
          });
          return port;
        });
      }
      const forced = background.request({ type: 'bridge-status', force: true });
      const normal = background.request({ type: 'bridge-status' });
      const alsoForced = background.request({ type: 'bridge-status', force: true });
      expect(background.connectNative).toHaveBeenCalledTimes(2);
      const port = background.nativePorts[1]!;
      if (failure === 'error') port.emitMessage({ type: 'error', message: 'health failed' });
      if (failure === 'invalid pong') port.emitMessage({ type: 'pong', clis: {} });
      if (failure === 'disconnect') port.emitDisconnect();
      if (failure === 'timeout') await vi.advanceTimersByTimeAsync(10_000);
      const failed = { ok: false, message };
      expect(await Promise.all([forced, normal, alsoForced])).toEqual([failed, failed, failed]);
      if (failure === 'timeout') expect(port.disconnect).toHaveBeenCalledOnce();

      const retry = background.request({ type: 'bridge-status' });
      expect(background.connectNative).toHaveBeenCalledTimes(3);
      background.nativePorts.at(-1)!.emitMessage(pong);
      expect(await retry).toEqual(success);
      expect(await background.request({ type: 'bridge-status' })).toEqual(success);
      expect(background.connectNative).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('clears completed health when a new worker starts', async () => {
    const background = await startBackground();
    const initial = background.request({ type: 'bridge-status' });
    background.nativePorts[0]!.emitMessage(pong);
    expect(await initial).toEqual(success);

    vi.resetModules();
    const restarted = await startBackground();
    const pending = restarted.request({ type: 'bridge-status' });
    expect(restarted.connectNative).toHaveBeenCalledOnce();
    restarted.nativePorts[0]!.emitMessage(pong);
    expect(await pending).toEqual(success);
  });

  it('starts fresh when the previous worker had an unfinished ping', async () => {
    const background = await startBackground();
    const old = background.request({ type: 'bridge-status' });
    vi.resetModules();
    const restarted = await startBackground();
    const pending = restarted.request({ type: 'bridge-status' });
    expect(restarted.connectNative).toHaveBeenCalledOnce();
    background.nativePorts[0]!.emitMessage({ type: 'error', message: 'old worker failed' });
    expect(await old).toEqual({ ok: false, message: 'old worker failed' });
    restarted.nativePorts[0]!.emitMessage(pong);
    expect(await pending).toEqual(success);
    expect(await restarted.request({ type: 'bridge-status' })).toEqual(success);
    expect(restarted.connectNative).toHaveBeenCalledOnce();
  });
});
