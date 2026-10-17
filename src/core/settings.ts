export type ProviderId =
  'claude-cli' | 'codex-cli' | 'grok-cli' | 'openai-compatible' | 'anthropic-api';

export type Mode = 'fix' | 'rephrase' | 'shorter' | 'tone';

export type Tone = 'polite' | 'formal' | 'casual' | 'angry-civil';

export interface Settings {
  provider: ProviderId;
  models: Record<ProviderId, string>;
  openaiBaseUrl: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  temperature: number;
  defaultMode: Mode;
  defaultTone: Tone;
  blocklist: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'claude-cli',
  models: {
    'claude-cli': 'haiku',
    'codex-cli': 'gpt-6-luna',
    'grok-cli': '',
    'openai-compatible': '',
    'anthropic-api': 'claude-haiku-5-5',
  },
  openaiBaseUrl: 'http://localhost:11434/v1',
  openaiApiKey: '',
  anthropicApiKey: '',
  temperature: 0.3,
  defaultMode: 'fix',
  defaultTone: 'polite',
  blocklist: [],
};

const STORAGE_KEY = 'settings';

interface ChromeStorageLocal {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function storageLocal(): ChromeStorageLocal {
  const root = globalThis as unknown as {
    chrome: { storage: { local: ChromeStorageLocal } };
  };
  return root.chrome.storage.local;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function storedPatch(value: unknown): Partial<Settings> {
  if (!isRecord(value)) return {};
  const { models, ...rest } = value;
  const patch = { ...rest } as Partial<Settings>;
  if (isRecord(models)) patch.models = models as Settings['models'];
  return patch;
}

function mergeSettings(patch: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...patch,
    models: {
      ...DEFAULT_SETTINGS.models,
      ...patch.models,
    },
    blocklist: Array.isArray(patch.blocklist)
      ? [...patch.blocklist]
      : [...DEFAULT_SETTINGS.blocklist],
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await storageLocal().get(STORAGE_KEY);
  return mergeSettings(storedPatch(stored[STORAGE_KEY]));
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  const next = mergeSettings({
    ...current,
    ...patch,
    models: {
      ...current.models,
      ...patch.models,
    },
  });
  await storageLocal().set({ [STORAGE_KEY]: next });
}

export function isBlocked(hostname: string, blocklist: string[]): boolean {
  const host = hostname.toLowerCase();
  for (const entry of blocklist) {
    const rule = normalizeBlockEntry(entry);
    if (rule === null) continue;
    if (host === rule || host.endsWith(`.${rule}`)) return true;
  }
  return false;
}

function normalizeBlockEntry(entry: string): string | null {
  let rule = entry.trim().toLowerCase();
  while (rule.startsWith('*.') || rule.startsWith('www.')) {
    rule = rule.startsWith('*.') ? rule.slice(2) : rule.slice(4);
  }
  rule = rule.trim();
  return rule === '' ? null : rule;
}
