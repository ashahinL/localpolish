import type { PageSettings } from './messages';

export type ProviderId =
  'claude-cli' | 'codex-cli' | 'grok-cli' | 'openai-compatible' | 'anthropic-api';

export type CliProviderId = 'claude-cli' | 'codex-cli' | 'grok-cli';

export type Mode = 'fix' | 'rephrase' | 'shorter' | 'tone';

export type Tone = 'polite' | 'formal' | 'casual' | 'angry-civil';

export type DefaultMode = 'fix' | 'rephrase' | 'shorter';

export interface Settings {
  provider: ProviderId;
  models: Record<ProviderId, string>;
  efforts: Record<CliProviderId, string>;
  openaiBaseUrl: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  temperature: number;
  defaultMode: DefaultMode;
  idleFix: boolean;
  blocklist: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'codex-cli',
  models: {
    'claude-cli': 'haiku',
    'codex-cli': 'gpt-6-luna',
    'grok-cli': '',
    'openai-compatible': '',
    'anthropic-api': 'claude-haiku-5-5',
  },
  efforts: {
    'claude-cli': 'low',
    'codex-cli': 'none',
    'grok-cli': 'low',
  },
  openaiBaseUrl: 'http://localhost:11434/v1',
  openaiApiKey: '',
  anthropicApiKey: '',
  temperature: 0.3,
  defaultMode: 'fix',
  idleFix: true,
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

function isDefaultMode(value: unknown): value is DefaultMode {
  return value === 'fix' || value === 'rephrase' || value === 'shorter';
}

function storedPatch(value: unknown): Partial<Settings> {
  if (!isRecord(value)) return {};
  const patch: Partial<Settings> = {};
  if (
    typeof value.provider === 'string' &&
    Object.hasOwn(DEFAULT_SETTINGS.models, value.provider)
  ) {
    patch.provider = value.provider as ProviderId;
  }
  if (isRecord(value.models)) {
    patch.models = Object.fromEntries(
      Object.entries(value.models).filter(
        ([key, model]) => Object.hasOwn(DEFAULT_SETTINGS.models, key) && typeof model === 'string',
      ),
    ) as Settings['models'];
  }
  if (isRecord(value.efforts)) {
    patch.efforts = Object.fromEntries(
      Object.entries(value.efforts).filter(
        ([key, effort]) =>
          Object.hasOwn(DEFAULT_SETTINGS.efforts, key) && typeof effort === 'string',
      ),
    ) as Settings['efforts'];
  }
  for (const key of ['openaiBaseUrl', 'openaiApiKey', 'anthropicApiKey'] as const) {
    if (typeof value[key] === 'string') patch[key] = value[key];
  }
  if (
    typeof value.temperature === 'number' &&
    Number.isFinite(value.temperature) &&
    value.temperature >= 0 &&
    value.temperature <= 1
  ) {
    patch.temperature = value.temperature;
  }
  if (value.defaultMode !== undefined) {
    patch.defaultMode = isDefaultMode(value.defaultMode) ? value.defaultMode : 'fix';
  }
  if (typeof value.idleFix === 'boolean') patch.idleFix = value.idleFix;
  if (Array.isArray(value.blocklist)) {
    patch.blocklist = value.blocklist.filter((entry): entry is string => typeof entry === 'string');
  }
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
    efforts: {
      ...DEFAULT_SETTINGS.efforts,
      ...patch.efforts,
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

export function pageSettings(value: unknown): PageSettings {
  const { blocklist, idleFix, defaultMode } = mergeSettings(storedPatch(value));
  return { blocklist, idleFix, defaultMode };
}

let settingsQueue: Promise<void> = Promise.resolve();

function withSettingsLock<T>(work: () => Promise<T>): Promise<T> {
  if (globalThis.navigator?.locks) {
    return navigator.locks.request('localpolish-settings', work);
  }
  const result = settingsQueue.then(work);
  settingsQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  return withSettingsLock(async () => {
    const current = await loadSettings();
    const next = mergeSettings({
      ...current,
      ...patch,
      models: {
        ...current.models,
        ...patch.models,
      },
      efforts: {
        ...current.efforts,
        ...patch.efforts,
      },
    });
    await storageLocal().set({ [STORAGE_KEY]: next });
  });
}

export function isBlocked(hostname: string, blocklist: string[]): boolean {
  const host = hostname.toLowerCase();
  for (const entry of blocklist) {
    const rule = normalizeSiteEntry(entry);
    if (rule === null) continue;
    if (host === rule || host.endsWith(`.${rule}`)) return true;
  }
  return false;
}

/** The hostname rule for a site entry, or null when it is not a site. */
export function normalizeSiteEntry(entry: string): string | null {
  const trimmed = entry.trim();
  try {
    let rule = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`).hostname;
    while (rule.startsWith('*.') || rule.startsWith('www.')) {
      rule = rule.startsWith('*.') ? rule.slice(2) : rule.slice(4);
    }
    return rule === '' ? null : rule;
  } catch {
    return null;
  }
}
