import { useEffect, useState } from 'preact/hooks';
import { type ProviderId } from '../core/settings';
import { ANTHROPIC_MODELS, baseUrlPreset, CLI_MODELS, type Preset } from '../options/presets';
import { isCli, PROVIDERS } from '../options/ProviderSection';
import { type ChatSettingsApi } from './useChatSettings';

function suggestions(provider: ProviderId): Preset[] {
  if (isCli(provider)) return CLI_MODELS[provider].filter((preset) => preset.value !== '');
  return provider === 'anthropic-api' ? ANTHROPIC_MODELS : [];
}

export function ModelPicker({ api, disabled }: { api: ChatSettingsApi; disabled: boolean }) {
  const { settings, error } = api;
  const provider = settings?.chat.provider;
  const saved = provider ? (settings?.chat.models[provider] ?? '') : '';
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved, provider]);

  if (!settings || !provider) {
    return error ? (
      <p class="notice error bar" role="alert">
        {error}
      </p>
    ) : null;
  }

  const placeholder =
    provider === 'grok-cli'
      ? 'CLI default'
      : provider === 'openai-compatible'
        ? (baseUrlPreset(settings.openaiBaseUrl)?.modelPlaceholder ?? 'Model name')
        : 'Model';
  const commit = () => {
    const model = draft.trim();
    if (model !== saved) api.setModel(provider, model);
  };

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
        <input
          aria-label="Chat model"
          list="chat-models"
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
        <datalist id="chat-models">
          {suggestions(provider).map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </datalist>
      </div>
      {error && (
        <p class="notice error bar" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
