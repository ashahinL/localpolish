import { useEffect, useRef, useState } from 'preact/hooks';
import { type ProviderId, type Settings } from '../core/settings';
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
import { ChevronUpIcon } from '../popup/icons';
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
            if (event.key !== 'Enter') return;
            // The picker sits inside the composer form; Enter must not send the draft.
            event.preventDefault();
            commit();
          }}
        />
      )}
    </>
  );
}

function chipLabel(settings: Settings, provider: ProviderId, efforts: Preset[]): string {
  const title = PROVIDERS.find((item) => item.id === provider)?.title ?? provider;
  const model = settings.chat.models[provider] ?? '';
  const modelLabel =
    suggestions(provider).find((preset) => preset.value === model)?.label ||
    model ||
    (isCli(provider) ? 'CLI default' : 'No model');
  const parts = [title, modelLabel];
  if (isCli(provider) && efforts.length > 0) {
    const effort = settings.chat.efforts[provider];
    if (effort) parts.push(efforts.find((preset) => preset.value === effort)?.label ?? effort);
  }
  return parts.join(', ');
}

export function ModelPicker({ api, disabled }: { api: ChatSettingsApi; disabled: boolean }) {
  const { settings } = api;
  const provider = settings?.chat.provider;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  if (!settings || !provider) return null;
  const model = settings.chat.models[provider] ?? '';
  const placeholder =
    provider === 'grok-cli'
      ? 'CLI default'
      : provider === 'openai-compatible'
        ? (baseUrlPreset(settings.openaiBaseUrl)?.modelPlaceholder ?? 'Model name')
        : 'Model';
  const efforts = isCli(provider) ? cliEfforts(provider, model) : [];
  return (
    <div
      class="model-picker"
      ref={root}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        setOpen(false);
        chip.current?.focus();
      }}
    >
      <div id="chat-models" class="pop" hidden={!open}>
        <div class="model-bar">
          <label class="field">
            <span>Provider</span>
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
          </label>
          <div class="two">
            <div class="field">
              <label for="chat-model">Model</label>
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
            </div>
            {isCli(provider) && efforts.length > 0 && (
              <div class="field effort">
                <label for="chat-effort">Thinking</label>
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
              </div>
            )}
          </div>
        </div>
      </div>
      <button
        ref={chip}
        type="button"
        class="model-chip"
        title="Chat model"
        aria-expanded={open}
        aria-controls="chat-models"
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <span>{chipLabel(settings, provider, efforts)}</span>
        <ChevronUpIcon />
      </button>
    </div>
  );
}
