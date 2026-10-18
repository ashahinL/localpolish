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

async function connect(sender?: { tab?: { url?: string }; url?: string }) {
  const onConnect = vi.fn();
  vi.stubGlobal('defineBackground', (start: () => void) => start());
  vi.stubGlobal('chrome', {
    runtime: { onConnect: { addListener: onConnect }, onMessage: { addListener: vi.fn() } },
    commands: { onCommand: { addListener: vi.fn() } },
  });
  await import('../entrypoints/background');
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

describe('rewrite port site checks', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(loadSettings).mockResolvedValue({
      ...DEFAULT_SETTINGS,
      blocklist: ['blocked.example'],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

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
