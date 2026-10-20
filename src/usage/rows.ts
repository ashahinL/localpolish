import type { UsageRow } from '../core/usage';
import { PROVIDERS } from '../options/ProviderSection';

export const DEFAULT_MODEL_LABEL = 'Unknown (CLI default)';

export function providerTitle(id: UsageRow['provider']): string {
  return PROVIDERS.find((item) => item.id === id)?.title ?? id;
}

function providerOrder(id: UsageRow['provider']): number {
  return PROVIDERS.findIndex((item) => item.id === id);
}

/** Most requests first; ties by model id, then by the provider list order. */
export function sortUsage(rows: UsageRow[]): UsageRow[] {
  return [...rows].sort((a, b) => {
    if (a.requests !== b.requests) return b.requests - a.requests;
    if (a.model !== b.model) return a.model < b.model ? -1 : 1;
    return providerOrder(a.provider) - providerOrder(b.provider);
  });
}

export function totalRequests(rows: UsageRow[]): number {
  return rows.reduce((sum, row) => sum + row.requests, 0);
}
