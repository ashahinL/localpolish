import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings } from '../core/settings';
import { runRewrite, testConnection } from './rewrite';
import { getProvider } from './providers';
import { TEST_PORT } from '../core/messages';
import { testConnection as pageTestConnection } from '../options/chrome';

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
  const get = vi.fn().mockResolvedValue({});
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
      local: { setAccessLevel, get },
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
    get,
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
      languages: { en: true, ar: true, franco: true, other: true },
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
        languages: { en: true, ar: true, franco: true, other: true },
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
    background.storageChanged(
      { settings: { newValue: { idleFix: false, openaiApiKey: 'fake-secret' } } },
      'local',
    );
    await vi.waitFor(() => expect(background.sendMessage).toHaveBeenCalledTimes(3));
    expect(background.query).toHaveBeenCalledExactlyOnceWith({});
    expect(background.sendMessage.mock.calls).toEqual([
      [
        1,
        {
          type: 'page-settings-changed',
          settings: {
            blocklist: ['blocked.example'],
            idleFix: true,
            defaultMode: 'fix',
            languages: { en: true, ar: true, franco: true, other: true },
          },
        },
      ],
      [
        2,
        {
          type: 'page-settings-changed',
          settings: {
            blocklist: ['blocked.example'],
            idleFix: true,
            defaultMode: 'fix',
            languages: { en: true, ar: true, franco: true, other: true },
          },
        },
      ],
      [
        3,
        {
          type: 'page-settings-changed',
          settings: {
            blocklist: ['blocked.example'],
            idleFix: true,
            defaultMode: 'fix',
            languages: { en: true, ar: true, franco: true, other: true },
          },
        },
      ],
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

  it('accepts known unique keep ids on idle requests', async () => {
    const port = await connect({ tab: { url: 'https://site.example/' } });
    const request = {
      mode: 'fix',
      tone: 'polite',
      text: 'a made up draft',
      trigger: 'idle',
      keep: ['ar', 'franco'],
    };
    port.send(request);
    await vi.waitFor(() => expect(runRewrite).toHaveBeenCalledTimes(1));
    expect(vi.mocked(runRewrite).mock.calls[0]?.[0]).toEqual(request);
  });

  it.each([
    { keep: ['ar'] },
    { keep: [] },
    { trigger: 'idle', keep: ['unknown'] },
    { trigger: 'idle', keep: ['ar', 'ar'] },
    { trigger: 'idle', keep: 'ar' },
    { trigger: 'idle', keep: null },
  ])('rejects invalid keep values: %j', async (extra) => {
    const port = await connect();
    port.send({ mode: 'fix', tone: 'polite', text: 'a made up draft', ...extra });
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'error',
      message: 'The rewrite request was not understood.',
    });
    expect(runRewrite).not.toHaveBeenCalled();
    expect(loadSettings).not.toHaveBeenCalled();
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

describe('page settings at the Chrome boundary', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const actual = await vi.importActual<typeof import('../core/settings')>('../core/settings');
    vi.mocked(loadSettings).mockImplementation(actual.loadSettings);
  });

  afterEach(() => vi.unstubAllGlobals());

  const changed = (
    background: Awaited<ReturnType<typeof startBackground>>,
    oldValue: unknown,
    newValue: unknown,
  ) => background.storageChanged({ settings: { oldValue, newValue } }, 'local');
  const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

  it.each([
    [{}, { models: { 'codex-cli': 'other' } }],
    [{}, { provider: 'anthropic-api' }],
    [{}, { openaiApiKey: 'fake-secret', anthropicApiKey: 'another-fake-secret' }],
    [{}, { efforts: { 'codex-cli': 'high' } }],
    [{}, { temperature: 0.8, openaiBaseUrl: 'http://localhost:1234/v1' }],
    [undefined, { idleFix: 'false', defaultMode: 'tone', blocklist: [null, 42] }],
    [
      { idleFix: null, defaultMode: 'bad', blocklist: false },
      {
        idleFix: true,
        defaultMode: 'fix',
        languages: { en: true, ar: true, franco: true, other: true },
        blocklist: [],
      },
    ],
    [
      { blocklist: ['B.example', null, 'a.example', 'B.example'] },
      { blocklist: ['B.example', 'a.example', false, 'B.example'] },
    ],
  ])(
    'does no storage or tab work for equivalent page settings: %j -> %j',
    async (oldValue, newValue) => {
      const background = await startBackground();
      changed(background, oldValue, newValue);
      await settled();
      expect(loadSettings).not.toHaveBeenCalled();
      expect(background.get).not.toHaveBeenCalled();
      expect(background.query).not.toHaveBeenCalled();
      expect(background.sendMessage).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ idleFix: true }, { idleFix: false }],
    [{ languages: { ar: true } }, { languages: { ar: false } }],
    [
      { defaultMode: 'fix', languages: { en: true, ar: true, franco: true, other: true } },
      { defaultMode: 'shorter', languages: { en: true, ar: true, franco: true, other: true } },
    ],
    [{ blocklist: ['a', 'b'] }, { blocklist: ['b', 'a'] }],
    [{ blocklist: ['a'] }, undefined],
  ])(
    'reads one current sanitized snapshot for a relevant change: %j -> %j',
    async (oldValue, newValue) => {
      const background = await startBackground();
      background.get.mockResolvedValue({
        settings: {
          provider: 'openai-compatible',
          openaiApiKey: 'fake-secret',
          anthropicApiKey: 'fake-secret-2',
          models: { 'openai-compatible': 'private-model' },
          blocklist: ['B.example', null, 'a.example', 'B.example'],
          idleFix: false,
          defaultMode: 'shorter',
          languages: { en: true, ar: true, franco: true, other: true },
        },
      });
      background.query.mockResolvedValue([{ id: 10 }, {}, { id: 20 }]);
      changed(background, oldValue, newValue);
      await settled();
      expect(background.get).toHaveBeenCalledExactlyOnceWith('settings');
      expect(background.query).toHaveBeenCalledExactlyOnceWith({});
      expect(background.sendMessage.mock.calls).toEqual([
        [
          10,
          {
            type: 'page-settings-changed',
            settings: {
              blocklist: ['B.example', 'a.example', 'B.example'],
              idleFix: false,
              defaultMode: 'shorter',
              languages: { en: true, ar: true, franco: true, other: true },
            },
          },
        ],
        [
          20,
          {
            type: 'page-settings-changed',
            settings: {
              blocklist: ['B.example', 'a.example', 'B.example'],
              idleFix: false,
              defaultMode: 'shorter',
              languages: { en: true, ar: true, franco: true, other: true },
            },
          },
        ],
      ]);
    },
  );

  it('serializes reads, queries, every send and initial replies through rapid block/unblock saves', async () => {
    const background = await startBackground();
    const blocked = {
      blocklist: ['site.example'],
      idleFix: false,
      defaultMode: 'shorter',
      languages: { en: true, ar: true, franco: true, other: true },
    };
    const unblocked = {
      blocklist: [],
      idleFix: true,
      defaultMode: 'fix',
      languages: { en: true, ar: true, franco: true, other: true },
    };
    const firstRead = deferred<Record<string, unknown>>();
    const firstQuery = deferred<Array<{ id: number }>>();
    const slowSend = deferred<unknown>();
    background.get
      .mockReturnValueOnce(firstRead.promise)
      .mockResolvedValue({ settings: unblocked });
    background.query.mockReturnValueOnce(firstQuery.promise).mockResolvedValue([{ id: 1 }]);
    background.sendMessage
      .mockRejectedValueOnce(new Error('Missing receiver'))
      .mockReturnValueOnce(slowSend.promise);
    changed(background, unblocked, blocked);
    const initial = background.request({ type: 'page-settings' });
    changed(background, blocked, unblocked);
    await settled();
    expect(background.get).toHaveBeenCalledTimes(1);
    expect(background.query).not.toHaveBeenCalled();
    firstRead.resolve({ settings: blocked });
    await settled();
    expect(background.query).toHaveBeenCalledTimes(1);
    expect(background.get).toHaveBeenCalledTimes(1);
    expect(background.sendMessage).not.toHaveBeenCalled();
    firstQuery.resolve([{ id: 1 }, { id: 2 }]);
    await settled();
    expect(background.sendMessage.mock.calls).toEqual([
      [1, { type: 'page-settings-changed', settings: blocked }],
      [2, { type: 'page-settings-changed', settings: blocked }],
    ]);
    expect(background.get).toHaveBeenCalledTimes(1);
    slowSend.resolve(undefined);
    expect(await initial).toEqual(unblocked);
    await settled();
    expect(background.get).toHaveBeenCalledTimes(3);
    expect(background.query).toHaveBeenCalledTimes(2);
    expect(background.sendMessage.mock.calls.at(-1)).toEqual([
      1,
      { type: 'page-settings-changed', settings: unblocked },
    ]);
  });

  it('keeps a pending initial read ahead of later broadcasts', async () => {
    const background = await startBackground();
    const first = deferred<Record<string, unknown>>();
    background.get
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ settings: { idleFix: false } });
    background.query.mockResolvedValue([{ id: 1 }]);
    const initial = background.request({ type: 'page-settings' });
    changed(background, {}, { idleFix: false });
    await settled();
    expect(background.get).toHaveBeenCalledTimes(1);
    expect(background.query).not.toHaveBeenCalled();
    first.resolve({ settings: {} });
    expect(await initial).toEqual({
      blocklist: [],
      idleFix: true,
      defaultMode: 'fix',
      languages: { en: true, ar: true, franco: true, other: true },
    });
    await settled();
    expect(background.sendMessage.mock.calls).toEqual([
      [
        1,
        {
          type: 'page-settings-changed',
          settings: {
            blocklist: [],
            idleFix: false,
            defaultMode: 'fix',
            languages: { en: true, ar: true, franco: true, other: true },
          },
        },
      ],
    ]);
  });

  it.each(['read', 'query', 'send'] as const)(
    'recovers after a rejected broadcast %s',
    async (stage) => {
      const background = await startBackground();
      background.get.mockResolvedValue({ settings: { idleFix: false } });
      background.query.mockResolvedValue([{ id: 1 }]);
      const failure = new Error('Boundary failed');
      if (stage === 'read') background.get.mockRejectedValueOnce(failure);
      if (stage === 'query') background.query.mockRejectedValueOnce(failure);
      if (stage === 'send') background.sendMessage.mockRejectedValueOnce(failure);
      changed(background, {}, { idleFix: false });
      changed(background, { idleFix: false }, {});
      expect(await background.request({ type: 'page-settings' })).toEqual({
        blocklist: [],
        idleFix: false,
        defaultMode: 'fix',
        languages: { en: true, ar: true, franco: true, other: true },
      });
      expect(background.sendMessage).toHaveBeenLastCalledWith(1, {
        type: 'page-settings-changed',
        settings: {
          blocklist: [],
          idleFix: false,
          defaultMode: 'fix',
          languages: { en: true, ar: true, franco: true, other: true },
        },
      });
      expect(background.get).toHaveBeenCalledTimes(3);
    },
  );

  it('recovers after a failed initial read', async () => {
    const background = await startBackground();
    background.get
      .mockRejectedValueOnce(new Error('Storage failed'))
      .mockResolvedValue({ settings: { idleFix: false } });
    background.query.mockResolvedValue([{ id: 1 }]);
    const initial = background.request({ type: 'page-settings' });
    changed(background, {}, { idleFix: false });
    expect(await initial).toBeNull();
    await settled();
    expect(background.sendMessage).toHaveBeenCalledExactlyOnceWith(1, {
      type: 'page-settings-changed',
      settings: {
        blocklist: [],
        idleFix: false,
        defaultMode: 'fix',
        languages: { en: true, ar: true, franco: true, other: true },
      },
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function ownerPort(background: Awaited<ReturnType<typeof startBackground>>) {
  const port = { ...nativePort(), name: TEST_PORT };
  background.onConnect.mock.calls[0]![0](port);
  return port;
}

describe('connection test owner ports', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(loadSettings).mockResolvedValue(DEFAULT_SETTINGS);
    vi.mocked(testConnection)
      .mockReset()
      .mockResolvedValue({ ok: true, sample: 'Current.', ms: 1 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('does not accept an attempt after the owner closes while settings load', async () => {
    const settings = deferred<typeof DEFAULT_SETTINGS>();
    vi.mocked(loadSettings).mockReturnValueOnce(settings.promise);
    const background = await startBackground();
    const owner = ownerPort(background);
    owner.emitMessage({ type: 'test-connection' });
    owner.emitDisconnect();
    settings.resolve(DEFAULT_SETTINGS);
    const live = ownerPort(background);
    live.emitMessage({ type: 'test-connection' });
    await vi.waitFor(() => expect(live.postMessage).toHaveBeenCalledOnce());
    expect(testConnection).toHaveBeenCalledOnce();
    expect(getProvider).toHaveBeenCalledOnce();
    expect(owner.postMessage).not.toHaveBeenCalled();
  });

  it('keeps two owners independent and never posts a closed owner result', async () => {
    const firstResult = deferred<Awaited<ReturnType<typeof testConnection>>>();
    const secondResult = deferred<Awaited<ReturnType<typeof testConnection>>>();
    vi.mocked(testConnection)
      .mockReturnValueOnce(firstResult.promise)
      .mockReturnValueOnce(secondResult.promise);
    const background = await startBackground();
    const first = ownerPort(background);
    const second = ownerPort(background);
    first.emitMessage({ type: 'test-connection' });
    second.emitMessage({ type: 'test-connection' });
    await vi.waitFor(() => expect(testConnection).toHaveBeenCalledTimes(2));
    const firstSignal = vi.mocked(testConnection).mock.calls[0]![2];
    const secondSignal = vi.mocked(testConnection).mock.calls[1]![2];
    expect(firstSignal).not.toBe(secondSignal);
    first.emitDisconnect();
    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);
    firstResult.resolve({ ok: true, sample: 'Old.', ms: 1 });
    secondResult.resolve({ ok: true, sample: 'Current.', ms: 2 });
    await vi.waitFor(() =>
      expect(second.postMessage).toHaveBeenCalledExactlyOnceWith({
        type: 'result',
        result: { ok: true, sample: 'Current.', ms: 2 },
      }),
    );
    expect(first.postMessage).not.toHaveBeenCalled();
  });

  it('rejects invalid starts and accepts only one valid start on a port', async () => {
    const background = await startBackground();
    const owner = ownerPort(background);
    owner.emitMessage({ type: 'rewrite' });
    expect(owner.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'result',
      result: {
        ok: false,
        message: 'The connection test request was not understood.',
      },
    });
    expect(loadSettings).not.toHaveBeenCalled();
    owner.emitMessage({ type: 'test-connection' });
    owner.emitMessage({ type: 'test-connection' });
    await vi.waitFor(() => expect(owner.postMessage).toHaveBeenCalledTimes(2));
    expect(testConnection).toHaveBeenCalledOnce();
    expect(loadSettings).toHaveBeenCalledOnce();
  });

  it.each(['settings', 'provider', 'test'])(
    'answers a %s failure without an unhandled rejection',
    async (boundary) => {
      if (boundary === 'settings')
        vi.mocked(loadSettings).mockRejectedValueOnce(new Error('Storage failed'));
      if (boundary === 'provider')
        vi.mocked(getProvider).mockImplementationOnce(() => {
          throw new Error('Unknown provider');
        });
      if (boundary === 'test')
        vi.mocked(testConnection).mockRejectedValueOnce(new Error('Provider failed'));
      const background = await startBackground();
      const owner = ownerPort(background);
      owner.emitMessage({ type: 'test-connection' });
      const message = {
        settings: 'Storage failed',
        provider: 'Unknown provider',
        test: 'Provider failed',
      }[boundary];
      await vi.waitFor(() =>
        expect(owner.postMessage).toHaveBeenCalledExactlyOnceWith({
          type: 'result',
          result: { ok: false, message },
        }),
      );
    },
  );

  it('does not handle the legacy unowned runtime request', async () => {
    const background = await startBackground();
    const reply = vi.fn();
    expect(background.message({ type: 'test-connection' }, {}, reply)).toBeUndefined();
    expect(testConnection).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });
});

describe('extension page test transport', () => {
  afterEach(() => vi.unstubAllGlobals());

  function transport() {
    const port = nativePort();
    const lastError = vi.fn<() => { message: string } | undefined>(() => undefined);
    const runtime = {
      connect: vi.fn(() => port),
      get lastError() {
        return lastError();
      },
    };
    vi.stubGlobal('chrome', { runtime });
    return { port, runtime, lastError };
  }

  it('never connects for an already cancelled owner', async () => {
    const { runtime } = transport();
    const owner = new AbortController();
    owner.abort();
    expect(await pageTestConnection(owner.signal)).toEqual({ ok: false, message: 'Cancelled.' });
    expect(runtime.connect).not.toHaveBeenCalled();
  });

  it.each(['result', 'abort'])(
    'settles once before synchronous disconnect after %s',
    async (outcome) => {
      const { port, runtime, lastError } = transport();
      const owner = new AbortController();
      const remove = vi.spyOn(owner.signal, 'removeEventListener');
      const pending = pageTestConnection(owner.signal);
      expect(runtime.connect).toHaveBeenCalledExactlyOnceWith({ name: TEST_PORT });
      expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'test-connection' });
      const result = { ok: true, sample: 'Current.', ms: 3 };
      if (outcome === 'result') port.emitMessage({ type: 'result', result });
      else owner.abort();
      expect(await pending).toEqual(
        outcome === 'result' ? result : { ok: false, message: 'Cancelled.' },
      );
      expect(port.disconnect).toHaveBeenCalledOnce();
      expect(lastError).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
      port.emitMessage({ type: 'result', result: { ok: false, message: 'Late.' } });
      owner.abort();
      expect(port.disconnect).toHaveBeenCalledOnce();
    },
  );

  it('preserves transport errors on disconnect and thrown connect or post', async () => {
    const { port, runtime, lastError } = transport();
    lastError.mockReturnValue({ message: 'Worker stopped' });
    const pending = pageTestConnection(new AbortController().signal);
    port.emitDisconnect();
    expect(await pending).toEqual({ ok: false, message: 'Worker stopped' });
    runtime.connect.mockImplementationOnce(() => {
      throw new Error('Connect failed');
    });
    expect(await pageTestConnection(new AbortController().signal)).toEqual({
      ok: false,
      message: 'Connect failed',
    });
    port.postMessage.mockImplementationOnce(() => {
      throw new Error('Post failed');
    });
    expect(await pageTestConnection(new AbortController().signal)).toEqual({
      ok: false,
      message: 'Post failed',
    });
  });
});
