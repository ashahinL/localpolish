import { DEFAULT_SETTINGS, type ProviderId, type Settings } from './settings';

export const USAGE_STORAGE_KEY = 'usage';

export interface UsageRow {
  provider: ProviderId;
  model: string;
  requests: number;
}

function storageLocal(): {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
} {
  const root = globalThis as unknown as {
    chrome: { storage: { local: ReturnType<typeof storageLocal> } };
  };
  return root.chrome.storage.local;
}

export async function loadUsage(): Promise<UsageRow[]> {
  const stored = await storageLocal().get(USAGE_STORAGE_KEY);
  const value: unknown = stored[USAGE_STORAGE_KEY];
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: unknown) => {
    if (typeof row !== 'object' || row === null) return [];
    const { provider, model, requests } = row as Record<string, unknown>;
    if (
      typeof provider !== 'string' ||
      !Object.hasOwn(DEFAULT_SETTINGS.models, provider) ||
      typeof model !== 'string' ||
      typeof requests !== 'number' ||
      !Number.isSafeInteger(requests) ||
      requests <= 0
    )
      return [];
    return [{ provider: provider as ProviderId, model, requests }];
  });
}

let usageQueue: Promise<void> = Promise.resolve();

export function recordUsage(settings: Pick<Settings, 'provider' | 'models'>): Promise<void> {
  const provider = settings.provider;
  const model = settings.models[provider];
  const result = usageQueue.then(async () => {
    const rows = await loadUsage();
    const row = rows.find((row) => row.provider === provider && row.model === model);
    if (row) row.requests = Math.min(row.requests + 1, Number.MAX_SAFE_INTEGER);
    else rows.push({ provider, model, requests: 1 });
    await storageLocal().set({ [USAGE_STORAGE_KEY]: rows });
  });
  usageQueue = result.catch(() => undefined);
  return result;
}

export function reattributeUsage(
  provider: ProviderId,
  fromModel: string,
  toModel: string,
): Promise<void> {
  const result = usageQueue.then(async () => {
    if (fromModel === toModel) return;
    const rows = await loadUsage();
    const source = rows.find((row) => row.provider === provider && row.model === fromModel);
    if (!source) return;
    const target = rows.find((row) => row.provider === provider && row.model === toModel);
    // A full target cannot take the count. Leaving both rows keeps the total the same.
    if (target && target.requests >= Number.MAX_SAFE_INTEGER) return;
    source.requests -= 1;
    if (source.requests === 0) rows.splice(rows.indexOf(source), 1);
    if (target) target.requests += 1;
    else rows.push({ provider, model: toModel, requests: 1 });
    await storageLocal().set({ [USAGE_STORAGE_KEY]: rows });
  });
  usageQueue = result.catch(() => undefined);
  return result;
}
