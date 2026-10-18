import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings } from '../core/settings';
import { runRewrite } from './rewrite';

vi.mock('../core/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/settings')>()),
  loadSettings: vi.fn(),
}));
vi.mock('./rewrite', () => ({ runRewrite: vi.fn(), testConnection: vi.fn() }));
vi.mock('./providers', () => ({ getProvider: vi.fn() }));
vi.mock('./providers/cli', () => ({ pingBridge: vi.fn() }));

async function startBackground() {
  const onConnect = vi.fn();
  const onInstalled = vi.fn();
  const create = vi.fn().mockResolvedValue(undefined);
  const onRuntimeMessage = vi.fn();
  const onStorageChanged = vi.fn();
  const setAccessLevel = vi.fn().mockResolvedValue(undefined);
  const query = vi.fn().mockResolvedValue([]);
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('defineBackground', (start: () => void) => start());
  vi.stubGlobal('chrome', {
    runtime: {
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
