import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type RewriteEvent, type RewriteRequest } from '../core/messages';
import { DEFAULT_SETTINGS, type Settings } from '../core/settings';
import { loadUsage, type UsageRow } from '../core/usage';
import { runRewrite } from './rewrite';
import { cliProvider } from './providers/cli';

const request: RewriteRequest = { mode: 'fix', tone: 'polite', text: 'i went home' };
const history: UsageRow[] = [{ provider: 'grok-cli', model: '', requests: 9 }];

let memory: Record<string, unknown>;
const set = vi.fn(async (items: Record<string, unknown>) => {
  Object.assign(memory, structuredClone(items));
});

interface FakePort {
  postMessage: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onMessage: { addListener: (cb: (message: unknown) => void) => void };
  onDisconnect: { addListener: (cb: () => void) => void };
}

let port: FakePort;
let emitMessage: (message: unknown) => void;

function grokSettings(model = ''): Settings {
  return {
    ...DEFAULT_SETTINGS,
    provider: 'grok-cli',
    models: { ...DEFAULT_SETTINGS.models, 'grok-cli': model },
  };
}

function total(rows: UsageRow[]): number {
  return rows.reduce((sum, row) => sum + row.requests, 0);
}

beforeEach(() => {
  memory = { usage: structuredClone(history) };
  set.mockReset();
  set.mockImplementation(async (items: Record<string, unknown>) => {
    Object.assign(memory, structuredClone(items));
  });
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
    for (const listener of [...onMessage]) listener(message);
  };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => structuredClone({ [key]: memory[key] }),
        set,
      },
    },
    runtime: {
      lastError: undefined,
      connectNative: () => port,
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

async function startedRewrite(settings: Settings, signal = new AbortController().signal) {
  const events: RewriteEvent[] = [];
  const calls = port.postMessage.mock.calls.length;
  const pending = runRewrite(
    request,
    settings,
    cliProvider('grok'),
    (event) => events.push(event),
    signal,
  );
  await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(calls + 1));
  return { events, pending };
}

it('moves only the new blank attempt to the first reported model', async () => {
  const settings = grokSettings();
  const first = await startedRewrite(settings);
  emitMessage({ type: 'model', model: '  grok-4.7  ' });
  emitMessage({ type: 'model', model: 'grok-4.7' });
  emitMessage({ type: 'model', model: 'grok-other' });
  emitMessage({ type: 'chunk', text: 'I went home.' });
  emitMessage({ type: 'done' });
  await first.pending;

  expect(first.events).toEqual([
    { type: 'chunk', text: 'I went home.' },
    { type: 'done', text: 'I went home.' },
  ]);
  expect(settings.models['grok-cli']).toBe('');
  expect(port.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'rewrite', cli: 'grok', model: '' }),
  );

  const second = await startedRewrite(settings);
  emitMessage({ type: 'model', model: 'grok-4' });
  emitMessage({ type: 'chunk', text: 'I went home.' });
  emitMessage({ type: 'done' });
  await second.pending;

  const rows = await loadUsage();
  expect(rows).toEqual([
    { provider: 'grok-cli', model: '', requests: 9 },
    { provider: 'grok-cli', model: 'grok-4.7', requests: 1 },
    { provider: 'grok-cli', model: 'grok-4', requests: 1 },
  ]);
  expect(total(rows)).toBe(11);
});

it('counts a failed attempt once on the reported model', async () => {
  const run = await startedRewrite(grokSettings());
  emitMessage({ type: 'model', model: 'grok-4.7' });
  emitMessage({ type: 'model', model: 'grok-4' });
  emitMessage({ type: 'error', message: 'boom' });
  await run.pending;
  expect(run.events).toEqual([{ type: 'error', message: 'boom' }]);
  const rows = await loadUsage();
  expect(rows).toEqual([
    { provider: 'grok-cli', model: '', requests: 9 },
    { provider: 'grok-cli', model: 'grok-4.7', requests: 1 },
  ]);
  expect(total(rows)).toBe(10);
});

it('counts a cancelled attempt once on the reported model', async () => {
  const controller = new AbortController();
  const run = await startedRewrite(grokSettings(), controller.signal);
  emitMessage({ type: 'model', model: 'grok-4.7' });
  controller.abort();
  emitMessage({ type: 'model', model: 'grok-4' });
  emitMessage({ type: 'done' });
  await run.pending;
  expect(run.events).toEqual([]);
  const rows = await loadUsage();
  expect(rows).toEqual([
    { provider: 'grok-cli', model: '', requests: 9 },
    { provider: 'grok-cli', model: 'grok-4.7', requests: 1 },
  ]);
  expect(total(rows)).toBe(10);
});

it('leaves the new attempt unknown when grok reports no model', async () => {
  const run = await startedRewrite(grokSettings());
  emitMessage({ type: 'chunk', text: 'I went home.' });
  emitMessage({ type: 'done' });
  await run.pending;
  const rows = await loadUsage();
  expect(rows).toEqual([{ provider: 'grok-cli', model: '', requests: 10 }]);
  expect(total(rows)).toBe(10);
});

it('keeps an explicit grok model and the old blank row', async () => {
  const settings = grokSettings('grok-3');
  const run = await startedRewrite(settings);
  emitMessage({ type: 'model', model: 'grok-4.7' });
  emitMessage({ type: 'chunk', text: 'I went home.' });
  emitMessage({ type: 'done' });
  await run.pending;
  expect(settings.models['grok-cli']).toBe('grok-3');
  expect(port.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'rewrite', cli: 'grok', model: 'grok-3' }),
  );
  const rows = await loadUsage();
  expect(rows).toEqual([
    { provider: 'grok-cli', model: '', requests: 9 },
    { provider: 'grok-cli', model: 'grok-3', requests: 1 },
  ]);
  expect(total(rows)).toBe(10);
});

it('does not move older rows when the initial count fails to save', async () => {
  set.mockRejectedValueOnce(new Error('disk full'));
  const run = await startedRewrite(grokSettings());
  emitMessage({ type: 'model', model: 'grok-4.7' });
  emitMessage({ type: 'chunk', text: 'I went home.' });
  emitMessage({ type: 'done' });
  await run.pending;
  expect(run.events.at(-1)).toEqual({ type: 'done', text: 'I went home.' });
  expect(await loadUsage()).toEqual(history);
  expect(set).toHaveBeenCalledOnce();
});

it('still finishes when the transfer write fails and keeps the new count unknown', async () => {
  let writes = 0;
  set.mockImplementation(async (items: Record<string, unknown>) => {
    writes += 1;
    if (writes === 2) throw new Error('disk full');
    Object.assign(memory, structuredClone(items));
  });
  const run = await startedRewrite(grokSettings());
  emitMessage({ type: 'model', model: 'grok-4.7' });
  emitMessage({ type: 'chunk', text: 'I went home.' });
  emitMessage({ type: 'done' });
  await run.pending;
  expect(run.events.at(-1)).toEqual({ type: 'done', text: 'I went home.' });
  const rows = await loadUsage();
  expect(rows).toEqual([{ provider: 'grok-cli', model: '', requests: 10 }]);
  expect(total(rows)).toBe(10);
  expect(writes).toBe(2);
});

it('ignores a model reported after the stream settles', async () => {
  let report: ((model: string) => void) | undefined;
  const events: RewriteEvent[] = [];
  await runRewrite(
    request,
    grokSettings(),
    async (_prompt, _settings, onText, _signal, onModel) => {
      report = onModel;
      onModel?.('grok-4.7');
      onText('I went home.');
    },
    (event) => events.push(event),
    new AbortController().signal,
  );
  report?.('grok-4');
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(events.at(-1)).toEqual({ type: 'done', text: 'I went home.' });
  const rows = await loadUsage();
  expect(rows).toEqual([
    { provider: 'grok-cli', model: '', requests: 9 },
    { provider: 'grok-cli', model: 'grok-4.7', requests: 1 },
  ]);
  expect(total(rows)).toBe(10);
});

it('does not move grok history when another provider reports a model', async () => {
  const events: RewriteEvent[] = [];
  await runRewrite(
    request,
    { ...DEFAULT_SETTINGS, provider: 'codex-cli' },
    async (_prompt, _settings, onText, _signal, onModel) => {
      onModel?.('gpt-other');
      onText('I went home.');
    },
    (event) => events.push(event),
    new AbortController().signal,
  );
  expect(events.at(-1)).toEqual({ type: 'done', text: 'I went home.' });
  const rows = await loadUsage();
  expect(rows).toEqual([...history, { provider: 'codex-cli', model: 'gpt-6-luna', requests: 1 }]);
  expect(total(rows)).toBe(10);
});
