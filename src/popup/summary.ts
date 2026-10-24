import { type BridgeStatus } from '../core/messages';
import { type CliProviderId, type ProviderId, type Settings } from '../core/settings';
import { isCli, PROVIDERS } from '../options/ProviderSection';
import {
  ANTHROPIC_MODELS,
  baseUrlPreset,
  cliEfforts,
  CLI_MODELS,
  type Preset,
} from '../options/presets';

const MARKS: Record<ProviderId, string> = {
  'claude-cli': 'CC',
  'codex-cli': 'Cx',
  'grok-cli': 'Gk',
  'antigravity-cli': 'Ag',
  'openai-compatible': 'AI',
  'anthropic-api': 'An',
};

export const CLI_KEY: Record<CliProviderId, 'claude' | 'codex' | 'grok' | 'agy'> = {
  'claude-cli': 'claude',
  'codex-cli': 'codex',
  'grok-cli': 'grok',
  'antigravity-cli': 'agy',
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export type Connection = { tone: 'ok' | 'error' | 'neutral'; label: string };

function providerTitle(id: ProviderId): string {
  const title = PROVIDERS.find((item) => item.id === id)?.title ?? '';
  return title === 'OpenAI-compatible API' ? 'OpenAI-compatible' : title;
}

function labelOf(presets: Preset[], value: string): string {
  return presets.find((preset) => preset.value === value)?.label ?? value;
}

/** A saved base URL can be half-typed, so a bad URL shows the raw text. */
function baseUrlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function isLocalBaseUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function detail(settings: Settings): string {
  const { provider } = settings;
  if (isCli(provider)) {
    const model = labelOf(CLI_MODELS[provider], settings.models[provider]);
    const options = cliEfforts(provider, settings.models[provider]);
    if (options.length === 0) return model;
    const effort = labelOf(options, settings.efforts[provider]);
    return `${model} · Effort: ${effort}`;
  }
  if (provider === 'openai-compatible') {
    const model = settings.models[provider] || 'No model set';
    const where =
      baseUrlPreset(settings.openaiBaseUrl)?.label ?? baseUrlHost(settings.openaiBaseUrl);
    return `${model} · ${where}`;
  }
  const model = labelOf(ANTHROPIC_MODELS, settings.models[provider]);
  return `${model} · Temperature ${settings.temperature}`;
}

export function providerSummary(settings: Settings): {
  title: string;
  mark: string;
  detail: string;
} {
  return {
    title: providerTitle(settings.provider),
    mark: MARKS[settings.provider],
    detail: detail(settings),
  };
}

export function connection(settings: Settings, bridge: BridgeStatus | null): Connection {
  const { provider } = settings;
  if (isCli(provider)) {
    if (bridge === null) return { tone: 'neutral', label: 'Checking…' };
    if (!bridge.ok) return { tone: 'error', label: 'No bridge' };
    if (bridge.clis[CLI_KEY[provider]] === null) {
      return { tone: 'error', label: `${providerTitle(provider)} not found` };
    }
    return { tone: 'ok', label: 'Bridge ready' };
  }
  if (provider === 'anthropic-api') {
    return settings.anthropicApiKey !== ''
      ? { tone: 'ok', label: 'Key saved' }
      : { tone: 'error', label: 'No API key' };
  }
  if (settings.openaiApiKey !== '') return { tone: 'ok', label: 'Key saved' };
  if (isLocalBaseUrl(settings.openaiBaseUrl)) return { tone: 'neutral', label: 'Local server' };
  return { tone: 'error', label: 'No API key' };
}
