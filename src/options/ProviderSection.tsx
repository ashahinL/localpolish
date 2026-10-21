import { type CliProviderId, type ProviderId, type Settings } from '../core/settings';
import { CodeLine, Field, Note, PresetPicker, SecretInput, TextInput } from './controls';
import { baseUrlPatch, parseTemperature } from './form';
import {
  ANTHROPIC_MODELS,
  baseUrlPreset,
  CLI_EFFORTS,
  CLI_MODELS,
  isOllamaUrl,
  OPENAI_BASE_URLS,
} from './presets';
import { useSettingsApi } from './useSettings';

export const PROVIDERS: Array<{ id: ProviderId; title: string; subtitle: string }> = [
  { id: 'claude-cli', title: 'Claude Code', subtitle: 'Your Claude subscription, via the bridge' },
  { id: 'codex-cli', title: 'Codex', subtitle: 'Your ChatGPT subscription, via the bridge' },
  {
    id: 'antigravity-cli',
    title: 'Antigravity CLI',
    subtitle: 'Your Google account, via the bridge',
  },
  { id: 'grok-cli', title: 'Grok CLI', subtitle: 'Your SuperGrok subscription, via the bridge' },
  {
    id: 'openai-compatible',
    title: 'OpenAI-compatible API',
    subtitle: 'OpenAI, xAI, OpenRouter, LM Studio, Ollama',
  },
  { id: 'anthropic-api', title: 'Anthropic API', subtitle: 'Claude with an API key' },
];

const CODEX_LOGIN = navigator.userAgent.includes('Windows')
  ? '$env:CODEX_HOME="$env:USERPROFILE\\AppData\\Local\\LocalPolish\\codex-home"; mkdir -Force $env:CODEX_HOME | Out-Null; codex login'
  : 'mkdir -p "$HOME/Library/Application Support/LocalPolish/codex-home" && CODEX_HOME="$HOME/Library/Application Support/LocalPolish/codex-home" codex login';

const AGY_LOGIN = navigator.userAgent.includes('Windows')
  ? '$env:HOME="$env:USERPROFILE\\AppData\\Local\\LocalPolish\\agy-home"; $env:USERPROFILE=$env:HOME; mkdir -Force $env:HOME | Out-Null; agy'
  : 'mkdir -p "$HOME/Library/Application Support/LocalPolish/agy-home" && HOME="$HOME/Library/Application Support/LocalPolish/agy-home" agy';

const BASE_URL_OPTIONS = OPENAI_BASE_URLS.map((preset) => ({
  value: preset.value,
  label: `${preset.label} (${preset.value})`,
}));

export function isCli(provider: ProviderId): provider is CliProviderId {
  return (
    provider === 'claude-cli' ||
    provider === 'codex-cli' ||
    provider === 'grok-cli' ||
    provider === 'antigravity-cli'
  );
}

export function ProviderSection({ settings }: { settings: Settings }) {
  const { change } = useSettingsApi();
  const { provider } = settings;
  return (
    <section class="card">
      <h2>AI provider</h2>
      <div class="providers" role="radiogroup" aria-label="AI provider">
        {PROVIDERS.map((item) => (
          <label key={item.id} class={`provider${item.id === provider ? ' selected' : ''}`}>
            <input
              type="radio"
              name="provider"
              value={item.id}
              checked={item.id === provider}
              onChange={() => change({ provider: item.id })}
            />
            <span class="provider-title">{item.title}</span>
            <span class="provider-subtitle">{item.subtitle}</span>
          </label>
        ))}
      </div>
      <div class="details" key={provider}>
        {isCli(provider) && <CliDetails provider={provider} settings={settings} />}
        {provider === 'openai-compatible' && <OpenAiDetails settings={settings} />}
        {provider === 'anthropic-api' && <AnthropicDetails settings={settings} />}
      </div>
    </section>
  );
}

function useModelChange(provider: ProviderId) {
  const { change } = useSettingsApi();
  return (value: string, typing: boolean) =>
    change((current) => ({ models: { ...current.models, [provider]: value } }), typing);
}

export function CliDetails({
  provider,
  settings,
}: {
  provider: CliProviderId;
  settings: Settings;
}) {
  const { change } = useSettingsApi();
  const onModel = useModelChange(provider);
  return (
    <>
      <div class="row">
        <PresetPicker
          id="model"
          label="Model"
          presets={CLI_MODELS[provider]}
          value={settings.models[provider]}
          settingsKey="models"
          onValue={onModel}
        />
        <PresetPicker
          id="effort"
          label="Thinking effort"
          presets={CLI_EFFORTS[provider]}
          value={settings.efforts[provider]}
          settingsKey="efforts"
          onValue={(value, typing) =>
            change((current) => ({ efforts: { ...current.efforts, [provider]: value } }), typing)
          }
        />
      </div>
      <p class="help">Lower effort is faster and cheaper. Low is enough for fixing text.</p>
      {provider === 'antigravity-cli' && (
        <Note tone="info">
          <p>Antigravity needs its own login for LocalPolish, once. Run this in a terminal.</p>
          <CodeLine text={AGY_LOGIN} />
        </Note>
      )}
      {provider === 'codex-cli' && (
        <Note tone="info">
          <p>Codex needs its own login for LocalPolish, once. Run this in a terminal.</p>
          <CodeLine text={CODEX_LOGIN} />
        </Note>
      )}
    </>
  );
}

export function OpenAiDetails({ settings }: { settings: Settings }) {
  const { change } = useSettingsApi();
  const onModel = useModelChange('openai-compatible');
  const preset = baseUrlPreset(settings.openaiBaseUrl);
  return (
    <>
      <PresetPicker
        id="base-url"
        label="Base URL"
        presets={BASE_URL_OPTIONS}
        value={settings.openaiBaseUrl}
        settingsKey="openaiBaseUrl"
        onValue={(value, typing) => change((before) => baseUrlPatch(before, value), typing)}
      />
      {isOllamaUrl(settings.openaiBaseUrl) && (
        <Note tone="info">
          <p>Ollama must allow the extension: start it with</p>
          <CodeLine text="OLLAMA_ORIGINS=chrome-extension://* ollama serve" />
        </Note>
      )}
      <Field id="openai-model" label="Model">
        <TextInput
          id="openai-model"
          settingsKey="models"
          value={settings.models['openai-compatible']}
          placeholder={preset?.modelPlaceholder ?? 'model name'}
          onText={(text) => onModel(text, true)}
        />
      </Field>
      <ApiKeyField
        id="openai-key"
        settingsKey="openaiApiKey"
        value={settings.openaiApiKey}
        help="Leave empty for Ollama and LM Studio."
        onText={(text) => change({ openaiApiKey: text }, true)}
      />
      <TemperatureField value={settings.temperature} />
    </>
  );
}

export function AnthropicDetails({ settings }: { settings: Settings }) {
  const { change } = useSettingsApi();
  const onModel = useModelChange('anthropic-api');
  return (
    <>
      <PresetPicker
        id="model"
        label="Model"
        presets={ANTHROPIC_MODELS}
        value={settings.models['anthropic-api']}
        settingsKey="models"
        onValue={onModel}
      />
      <ApiKeyField
        id="anthropic-key"
        settingsKey="anthropicApiKey"
        value={settings.anthropicApiKey}
        onText={(text) => change({ anthropicApiKey: text }, true)}
      />
      <TemperatureField value={settings.temperature} />
    </>
  );
}

interface ApiKeyFieldProps {
  id: string;
  settingsKey: 'openaiApiKey' | 'anthropicApiKey';
  value: string;
  help?: string;
  onText(text: string): void;
}

function ApiKeyField({ id, settingsKey, value, help, onText }: ApiKeyFieldProps) {
  return (
    <Field id={id} label="API key" help={help}>
      <SecretInput id={id} settingsKey={settingsKey} value={value} onText={onText} />
    </Field>
  );
}

function TemperatureField({ value }: { value: number }) {
  const { change } = useSettingsApi();
  return (
    <Field
      id="temperature"
      label="Temperature"
      help="From 0 to 1. Lower keeps your wording closer."
    >
      <TextInput
        id="temperature"
        type="number"
        min={0}
        max={1}
        step={0.1}
        settingsKey="temperature"
        value={String(value)}
        onText={(text) => {
          const temperature = parseTemperature(text);
          if (temperature !== null) change({ temperature }, true);
        }}
      />
    </Field>
  );
}
