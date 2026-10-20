import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type ProviderId } from './settings';
import { loadUsage, reattributeUsage, recordUsage, USAGE_STORAGE_KEY } from './usage';

let memory: Record<string, unknown>;
const set = vi.fn(async (items: Record<string, unknown>) => {
  Object.assign(memory, structuredClone(items));
});
const selected = (provider: ProviderId, model: string) => ({
  provider,
  models: { ...DEFAULT_SETTINGS.models, [provider]: model },
});

beforeEach(() => {
  memory = {};
  set.mockClear();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => structuredClone({ [key]: memory[key] }),
        set,
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('preserves concurrent counts for each provider and exact model across reads', async () => {
  await Promise.all([
    recordUsage(selected('codex-cli', 'alias')),
    recordUsage(selected('codex-cli', 'alias')),
    recordUsage(selected('claude-cli', 'alias')),
    recordUsage(selected('codex-cli', ' alias')),
    recordUsage(selected('codex-cli', '')),
    recordUsage(selected('codex-cli', '')),
  ]);
  const expected = [
    { provider: 'codex-cli', model: 'alias', requests: 2 },
    { provider: 'claude-cli', model: 'alias', requests: 1 },
    { provider: 'codex-cli', model: ' alias', requests: 1 },
    { provider: 'codex-cli', model: '', requests: 2 },
  ];
  expect(await loadUsage()).toEqual(expected);
  (await loadUsage())[0]!.requests = 999;
  expect(await loadUsage()).toEqual(expected);
  expect(memory[USAGE_STORAGE_KEY]).toEqual(expected);
});

it('treats missing and malformed storage as empty and ignores invalid rows', async () => {
  expect(await loadUsage()).toEqual([]);
  for (const value of [null, {}, 'bad', 42]) {
    memory.usage = value;
    expect(await loadUsage()).toEqual([]);
  }
  const valid = { provider: 'grok-cli', model: '', requests: 4 };
  memory.usage = [
    valid,
    null,
    [],
    {},
    { ...valid, provider: 'unknown' },
    { ...valid, provider: 'toString' },
    { ...valid, model: 5 },
    ...[0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '2'].map((requests) => ({
      ...valid,
      requests,
    })),
  ];
  expect(await loadUsage()).toEqual([valid]);
});

it('recovers after a failed write without losing later queued attempts', async () => {
  set.mockRejectedValueOnce(new Error('disk full'));
  const first = recordUsage(selected('codex-cli', 'one'));
  const second = recordUsage(selected('codex-cli', 'two'));
  await expect(first).rejects.toThrow('disk full');
  await second;
  await recordUsage(selected('codex-cli', 'two'));
  expect(await loadUsage()).toEqual([{ provider: 'codex-cli', model: 'two', requests: 2 }]);
});

it('stores only counts and leaves settings and private text untouched', async () => {
  const privateSettings = {
    ...DEFAULT_SETTINGS,
    openaiApiKey: 'secret-key',
    openaiBaseUrl: 'https://private.example',
    blocklist: ['private.site'],
    prompt: 'private draft',
    output: 'private answer',
  };
  memory.settings = structuredClone(privateSettings);
  memory.usage = [{ provider: 'codex-cli', model: 'gpt-6-luna', requests: 2, prompt: 'old draft' }];
  await recordUsage(privateSettings);
  expect(set).toHaveBeenCalledExactlyOnceWith({
    usage: [{ provider: 'codex-cli', model: 'gpt-6-luna', requests: 3 }],
  });
  expect(memory.settings).toEqual(privateSettings);
});

it('moves queued attempts one at a time and keeps the total', async () => {
  memory.usage = [
    { provider: 'grok-cli', model: '', requests: 9 },
    { provider: 'grok-cli', model: 'grok-4.7', requests: 2 },
    { provider: 'claude-cli', model: '', requests: 4 },
  ];
  await Promise.all([
    reattributeUsage('grok-cli', '', 'grok-4.7'),
    reattributeUsage('grok-cli', '', 'grok-4'),
    reattributeUsage('grok-cli', '', 'grok-4.7'),
    reattributeUsage('grok-cli', '', 'grok-4.7'),
  ]);
  const rows = await loadUsage();
  expect(rows).toEqual([
    { provider: 'grok-cli', model: '', requests: 5 },
    { provider: 'grok-cli', model: 'grok-4.7', requests: 5 },
    { provider: 'claude-cli', model: '', requests: 4 },
    { provider: 'grok-cli', model: 'grok-4', requests: 1 },
  ]);
  expect(rows.reduce((sum, row) => sum + row.requests, 0)).toBe(15);
});

it('drops an empty source row and merges onto an existing model', async () => {
  memory.usage = [
    { provider: 'claude-cli', model: 'haiku', requests: 1 },
    { provider: 'grok-cli', model: '', requests: 1 },
    { provider: 'grok-cli', model: 'grok-4.7', requests: Number.MAX_SAFE_INTEGER - 1 },
  ];
  await reattributeUsage('grok-cli', '', 'grok-4.7');
  expect(await loadUsage()).toEqual([
    { provider: 'claude-cli', model: 'haiku', requests: 1 },
    { provider: 'grok-cli', model: 'grok-4.7', requests: Number.MAX_SAFE_INTEGER },
  ]);
});

it('does not invent history when the source row is missing or already named', async () => {
  const history = [
    { provider: 'grok-cli', model: 'grok-3', requests: 2 },
    { provider: 'claude-cli', model: '', requests: 4 },
  ];
  memory.usage = history.map((row) => ({ ...row }));
  await reattributeUsage('grok-cli', '', 'grok-4.7');
  await reattributeUsage('grok-cli', 'grok-3', 'grok-3');
  expect(await loadUsage()).toEqual(history);
  expect(set).not.toHaveBeenCalled();
});

it('leaves both rows unchanged when the target cannot take another count', async () => {
  const history = [
    { provider: 'grok-cli', model: '', requests: 2 },
    { provider: 'grok-cli', model: 'grok-4.7', requests: Number.MAX_SAFE_INTEGER },
  ];
  memory.usage = history.map((row) => ({ ...row }));
  await reattributeUsage('grok-cli', '', 'grok-4.7');
  expect(await loadUsage()).toEqual(history);
  expect(set).not.toHaveBeenCalled();
});

it('keeps the rows and later attempts when a transfer write fails', async () => {
  memory.usage = [{ provider: 'grok-cli', model: '', requests: 2 }];
  set.mockRejectedValueOnce(new Error('disk full'));
  const failed = reattributeUsage('grok-cli', '', 'grok-4.7');
  const later = recordUsage(selected('grok-cli', ''));
  await expect(failed).rejects.toThrow('disk full');
  await later;
  expect(await loadUsage()).toEqual([{ provider: 'grok-cli', model: '', requests: 3 }]);
});
