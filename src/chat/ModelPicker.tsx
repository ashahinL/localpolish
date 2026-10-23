import { useEffect, useState } from 'preact/hooks';
import { type ProviderId } from '../core/settings';
import {
  ANTHROPIC_MODELS,
  baseUrlPreset,
  CLI_MODELS,
  cliEfforts,
  CUSTOM,
  selectedOption,
  type Preset,
} from '../options/presets';
import { isCli, PROVIDERS } from '../options/ProviderSection';
import { type ChatSettingsApi } from './useChatSettings';

function suggestions(provider: ProviderId): Preset[] {
  if (isCli(provider)) return CLI_MODELS[provider];
  return provider === 'anthropic-api' ? ANTHROPIC_MODELS : [];
}

function PresetChoice({
  id,
  label,
  presets,
  value,
  placeholder,
  disabled,
  onValue,
}: {
  id: string;
  label: string;
  presets: Preset[];
  value: string;
  placeholder: string;
  disabled: boolean;
  onValue(value: string): void;
}) {
  const [draft, setDraft] = useState(value);
  const [custom, setCustom] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const selected = selectedOption(presets, value, custom);
  const commit = () => {
    const next = draft.trim();
    if (next !== value) onValue(next);
  };
  return (
    <>
      {presets.length > 0 && (
        <select
          id={id}
          aria-label={label}
          title={label}
          value={selected}
          disabled={disabled}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setCustom(next === CUSTOM);
            if (next !== CUSTOM) onValue(next);
          }}
        >
          {presets.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
      )}
      {(presets.length === 0 || selected === CUSTOM) && (
        <input
          id={presets.length > 0 ? `${id}-custom` : id}
          class={presets.length > 0 ? 'custom-choice' : undefined}
          aria-label={presets.length > 0 ? `Custom ${label.toLowerCase()}` : label}
          placeholder={placeholder}
          value={draft}
          disabled={disabled}
          spellcheck={false}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onChange={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
        />
      )}
    </>
  );
}

export function ModelPicker({ api, disabled }: { api: ChatSettingsApi; disabled: boolean }) {
  const { settings, error } = api;
  const provider = settings?.chat.provider;
  if (!settings || !provider) {
    return error ? (
      <p class="notice error bar" role="alert">
        {error}
      </p>
    ) : null;
  }
  const model = settings.chat.models[provider] ?? '';
  const placeholder =
    provider === 'grok-cli'
      ? 'CLI default'
      : provider === 'openai-compatible'
        ? (baseUrlPreset(settings.openaiBaseUrl)?.modelPlaceholder ?? 'Model name')
        : 'Model';
  const efforts = isCli(provider) ? cliEfforts(provider, model) : [];
  return (
    <>
      <div class="model-bar">
        <select
          aria-label="Chat provider"
          value={provider}
          disabled={disabled}
          onChange={(event) => api.setProvider(event.currentTarget.value as ProviderId)}
        >
          {PROVIDERS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        <PresetChoice
          key={`${provider}-model`}
          id="chat-model"
          label="Chat model"
          presets={suggestions(provider)}
          value={model}
          placeholder={placeholder}
          disabled={disabled}
          onValue={(value) => api.setModel(provider, value)}
        />
        {isCli(provider) && efforts.length > 0 && (
          <PresetChoice
            key={`${provider}-effort`}
            id="chat-effort"
            label="Chat thinking effort"
            presets={efforts}
            value={settings.chat.efforts[provider]}
            placeholder="Effort"
            disabled={disabled}
            onValue={(value) => api.setEffort(provider, value)}
          />
        )}
      </div>
      {error && (
        <p class="notice error bar" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
