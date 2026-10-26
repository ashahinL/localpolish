import type { PageSettings } from './messages';

export type ProviderId =
  | 'claude-cli'
  | 'codex-cli'
  | 'grok-cli'
  | 'antigravity-cli'
  | 'openai-compatible'
  | 'anthropic-api';

export type CliProviderId = 'claude-cli' | 'codex-cli' | 'grok-cli' | 'antigravity-cli';

export type LanguageId = 'en' | 'ar' | 'franco' | 'other';

export type Mode = 'fix' | 'rephrase' | 'shorter' | 'tone';

export type Tone = 'polite' | 'formal' | 'casual' | 'angry-civil';

export type DefaultMode = 'fix' | 'rephrase' | 'shorter';

export interface ChatSettings {
  provider: ProviderId;
  models: Record<ProviderId, string>;
  efforts: Record<CliProviderId, string>;
}

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
  selectionChat: boolean;
  languages: Record<LanguageId, boolean>;
  blocklist: string[];
  chat: ChatSettings;
}

const MODEL_DEFAULTS: Record<ProviderId, string> = {
  'claude-cli': 'haiku',
  'codex-cli': 'gpt-6.1-terra',
  'grok-cli': '',
  'antigravity-cli': 'gemini-3.8-flash',
  'openai-compatible': '',
  'anthropic-api': 'claude-haiku-5-5',
};

const EFFORT_DEFAULTS: Record<CliProviderId, string> = {
  'claude-cli': 'low',
  'codex-cli': 'none',
  'grok-cli': 'low',
  'antigravity-cli': 'low',
};

export const DEFAULT_SETTINGS: Settings = {
  provider: 'codex-cli',
  models: { ...MODEL_DEFAULTS },
  efforts: { ...EFFORT_DEFAULTS },
  openaiBaseUrl: 'http://localhost:11434/v1',
  openaiApiKey: '',
  anthropicApiKey: '',
  temperature: 0.3,
  defaultMode: 'fix',
  idleFix: true,
  selectionChat: true,
  languages: { en: true, ar: true, franco: true, other: true },
  blocklist: [],
  chat: {
    provider: 'codex-cli',
    models: { ...MODEL_DEFAULTS },
    efforts: { ...EFFORT_DEFAULTS },
  },
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

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && Object.hasOwn(DEFAULT_SETTINGS.models, value);
}

function checkedModels(value: unknown): Partial<Record<ProviderId, string>> | undefined {
  if (!isRecord(value)) return undefined;
  const models: Partial<Record<ProviderId, string>> = {};
  for (const [key, model] of Object.entries(value)) {
    if (isProviderId(key) && typeof model === 'string') models[key] = model;
  }
  return models;
}

function checkedEfforts(value: unknown): Partial<Record<CliProviderId, string>> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, effort]) => Object.hasOwn(EFFORT_DEFAULTS, key) && typeof effort === 'string',
    ),
  );
}

function cloneChat(
  provider: ProviderId,
  models: Record<ProviderId, string>,
  efforts: Record<CliProviderId, string>,
): ChatSettings {
  return { provider, models: { ...models }, efforts: { ...efforts } };
}

function storedPatch(value: unknown): Partial<Settings> {
  if (!isRecord(value)) return {};
  const patch: Partial<Settings> = {};
  if (isProviderId(value.provider)) patch.provider = value.provider;
  const models = checkedModels(value.models);
  if (models !== undefined) patch.models = models as Settings['models'];
  const efforts = checkedEfforts(value.efforts);
  if (efforts !== undefined) patch.efforts = efforts as Settings['efforts'];
  const agyModel = patch.models?.['antigravity-cli'];
  const geminiEffort = /^gemini-3\.8-flash-(low|medium|high)$/.exec(agyModel ?? '')?.[1];
  if (geminiEffort || agyModel === 'gpt-oss-120b-medium') {
    patch.models!['antigravity-cli'] = geminiEffort ? 'gemini-3.8-flash' : 'gpt-oss-120b';
    patch.efforts = {
      ...patch.efforts,
      'antigravity-cli': geminiEffort ?? '',
    } as Settings['efforts'];
  }
  if (isRecord(value.languages)) {
    patch.languages = Object.fromEntries(
      Object.entries(value.languages).filter(
        ([key, enabled]) =>
          Object.hasOwn(DEFAULT_SETTINGS.languages, key) && typeof enabled === 'boolean',
      ),
    ) as Settings['languages'];
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
  if (typeof value.selectionChat === 'boolean') patch.selectionChat = value.selectionChat;
  if (Array.isArray(value.blocklist)) {
    patch.blocklist = value.blocklist.filter((entry): entry is string => typeof entry === 'string');
  }
  return patch;
}

function mergeSettings(patch: Partial<Settings>): Settings {
  const chat = patch.chat ?? DEFAULT_SETTINGS.chat;
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
    languages: { ...DEFAULT_SETTINGS.languages, ...patch.languages },
    blocklist: Array.isArray(patch.blocklist)
      ? [...patch.blocklist]
      : [...DEFAULT_SETTINGS.blocklist],
    chat: cloneChat(chat.provider, chat.models, chat.efforts),
  };
}

function chatFromStored(raw: unknown, fix: Settings): ChatSettings {
  const stored = isRecord(raw) && isRecord(raw.chat) ? raw.chat : undefined;
  const provider =
    stored !== undefined && isProviderId(stored.provider) ? stored.provider : fix.provider;
  const models = stored === undefined ? undefined : checkedModels(stored.models);
  const efforts = stored === undefined ? undefined : checkedEfforts(stored.efforts);
  return cloneChat(provider, { ...fix.models, ...models }, { ...fix.efforts, ...efforts });
}

export async function loadSettings(): Promise<Settings> {
  const stored = await storageLocal().get(STORAGE_KEY);
  const raw = stored[STORAGE_KEY];
  const fix = mergeSettings(storedPatch(raw));
  return { ...fix, chat: chatFromStored(raw, fix) };
}

export function pageSettings(value: unknown): PageSettings {
  const { blocklist, idleFix, selectionChat, defaultMode, languages } = mergeSettings(
    storedPatch(value),
  );
  return { blocklist, idleFix, selectionChat, defaultMode, languages };
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

type ChatPatch = {
  provider?: ProviderId;
  models?: Partial<Record<ProviderId, string>>;
  efforts?: Partial<Record<CliProviderId, string>>;
};

export async function saveSettings(
  patch: Omit<Partial<Settings>, 'languages' | 'chat' | 'efforts'> & {
    languages?: Partial<Settings['languages']>;
    efforts?: Partial<Settings['efforts']>;
    chat?: ChatPatch;
  },
): Promise<void> {
  return withSettingsLock(async () => {
    const current = await loadSettings();
    const { chat: chatPatch, ...rest } = patch;
    const provider =
      chatPatch !== undefined && isProviderId(chatPatch.provider)
        ? chatPatch.provider
        : current.chat.provider;
    const modelUpdates = chatPatch === undefined ? {} : (checkedModels(chatPatch.models) ?? {});
    const effortUpdates = chatPatch === undefined ? {} : (checkedEfforts(chatPatch.efforts) ?? {});
    const next = mergeSettings({
      ...current,
      ...rest,
      models: {
        ...current.models,
        ...rest.models,
      },
      languages: { ...current.languages, ...rest.languages },
      efforts: {
        ...current.efforts,
        ...rest.efforts,
      },
      chat: cloneChat(
        provider,
        { ...current.chat.models, ...modelUpdates },
        { ...current.chat.efforts, ...effortUpdates },
      ),
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
