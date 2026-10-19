import { describe, expect, it } from 'vitest';
import type { UsageRow } from '../core/usage';
import { providerTitle, sortUsage, totalRequests } from './rows';

describe('usage rows', () => {
  const rows: UsageRow[] = [
    { provider: 'anthropic-api', model: 'claude-haiku-5-5', requests: 2 },
    { provider: 'codex-cli', model: '', requests: 7 },
    { provider: 'openai-compatible', model: 'b-model', requests: 2 },
    { provider: 'grok-cli', model: 'b-model', requests: 2 },
    { provider: 'claude-cli', model: 'haiku', requests: 11 },
  ];

  it('sorts by requests, then model, then provider list order', () => {
    expect(sortUsage(rows).map((row) => `${row.provider}/${row.model}`)).toEqual([
      'claude-cli/haiku',
      'codex-cli/',
      'grok-cli/b-model',
      'openai-compatible/b-model',
      'anthropic-api/claude-haiku-5-5',
    ]);
  });

  it('does not reorder the stored rows', () => {
    const before = rows.map((row) => row.provider);
    sortUsage(rows);
    expect(rows.map((row) => row.provider)).toEqual(before);
  });

  it('totals every row and uses the provider titles', () => {
    expect(totalRequests(rows)).toBe(24);
    expect(totalRequests([])).toBe(0);
    expect(providerTitle('openai-compatible')).toBe('OpenAI-compatible API');
  });
});
