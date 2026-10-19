import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type ProviderId } from './settings';
import { loadUsage, recordUsage, USAGE_STORAGE_KEY } from './usage';

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
