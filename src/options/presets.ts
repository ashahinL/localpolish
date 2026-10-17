import { type CliProviderId } from '../core/settings';

export interface Preset {
  value: string;
  label: string;
}

export interface BaseUrlPreset extends Preset {
  modelPlaceholder: string;
}

export const CUSTOM = '__custom__';

export const CLI_MODELS: Record<CliProviderId, Preset[]> = {
  'claude-cli': [
    { value: 'haiku', label: 'Haiku' },
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'opus', label: 'Opus' },
  ],
  'codex-cli': [
    { value: 'gpt-6-luna', label: 'GPT-6 Luna' },
    { value: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
  ],
  'grok-cli': [
    { value: '', label: 'CLI default (grok-4.7)' },
    { value: 'grok-4.7', label: 'Grok 4.7' },
    { value: 'grok-4.6', label: 'Grok 4.6' },
  ],
};

type Effort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const EFFORT_LABELS: Record<Effort, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

function efforts(values: Effort[]): Preset[] {
  return values.map((value) => ({ value, label: EFFORT_LABELS[value] }));
}

export const CLI_EFFORTS: Record<CliProviderId, Preset[]> = {
  'claude-cli': efforts(['low', 'medium', 'high', 'xhigh', 'max']),
  'codex-cli': efforts(['none', 'low', 'medium', 'high', 'xhigh']),
  'grok-cli': efforts(['low', 'medium', 'high']),
};

export const ANTHROPIC_MODELS: Preset[] = [
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
];

export const OLLAMA_URL = 'http://localhost:11434/v1';

export const OPENAI_BASE_URLS: BaseUrlPreset[] = [
  { label: 'Ollama', value: OLLAMA_URL, modelPlaceholder: 'llama3.2' },
  { label: 'LM Studio', value: 'http://localhost:1234/v1', modelPlaceholder: 'local-model' },
  { label: 'OpenAI', value: 'https://api.openai.com/v1', modelPlaceholder: 'gpt-6-luna' },
  { label: 'xAI', value: 'https://api.x.ai/v1', modelPlaceholder: 'grok-4.7' },
  {
    label: 'OpenRouter',
    value: 'https://openrouter.ai/api/v1',
    modelPlaceholder: 'anthropic/claude-haiku-5.5',
  },
];

/** The `<select>` value for a picker: the matching preset, or CUSTOM. */
export function selectedOption(presets: Preset[], value: string, customChosen: boolean): string {
  if (customChosen) return CUSTOM;
  return presets.some((preset) => preset.value === value) ? value : CUSTOM;
}

export function baseUrlPreset(url: string): BaseUrlPreset | undefined {
  return OPENAI_BASE_URLS.find((preset) => preset.value === url);
}

export function isOllamaUrl(url: string): boolean {
  return url === OLLAMA_URL || /:11434(\/|$)/.test(url);
}
