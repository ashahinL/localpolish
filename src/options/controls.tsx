import { type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { type SettingsKey } from './form';
import { CUSTOM, selectedOption, type Preset } from './presets';
import { useSettingsApi } from './useSettings';

const COPIED_MS = 1500;

interface FieldProps {
  id: string;
  label: string;
  help?: ComponentChildren;
  children: ComponentChildren;
}

export function Field({ id, label, help, children }: FieldProps) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      {children}
      {help && <p class="help">{help}</p>}
    </div>
  );
}

interface TextInputProps {
  id: string;
  settingsKey: SettingsKey;
  value: string;
  onText(text: string): void;
  type?: 'text' | 'password' | 'number' | 'url';
  placeholder?: string;
  multiline?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
  min?: number;
  max?: number;
  step?: number;
}

/** Keeps the raw text while focused, so parsed values (lists, numbers) do not fight the cursor. */
export function TextInput({
  settingsKey,
  value,
  onText,
  multiline,
  ariaLabel,
  type = 'text',
  ...rest
}: TextInputProps) {
  const api = useSettingsApi();
  const [draft, setDraft] = useState<string | null>(null);
  const props = {
    ...rest,
    'aria-label': ariaLabel,
    value: draft ?? value,
    spellcheck: false,
    onFocus: () => {
      api.startEditing(settingsKey);
      setDraft(value);
    },
    onBlur: () => {
      setDraft(null);
      api.stopEditing(settingsKey);
    },
    onInput: (event: Event) => {
      const text = (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
      setDraft(text);
      onText(text);
    },
  };
  if (multiline) return <textarea rows={5} {...props} />;
  // Preact types allowed ARIA roles per input type and cannot check a union of types.
  return <input type={type as 'text'} {...props} />;
}

export function SecretInput(props: Omit<TextInputProps, 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <div class="inline">
      <TextInput {...props} type={shown ? 'text' : 'password'} />
      <button
        type="button"
        class="secondary"
        aria-pressed={shown}
        onClick={() => setShown((value) => !value)}
      >
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

interface PresetPickerProps {
  id: string;
  label: string;
  presets: Preset[];
  value: string;
  settingsKey: SettingsKey;
  onValue(value: string, typing: boolean): void;
  help?: ComponentChildren;
}

export function PresetPicker({
  id,
  label,
  presets,
  value,
  settingsKey,
  onValue,
  help,
}: PresetPickerProps) {
  const [customChosen, setCustomChosen] = useState(false);
  const selected = selectedOption(presets, value, customChosen);
  return (
    <Field id={id} label={label} help={help}>
      <div class="inline">
        <select
          id={id}
          value={selected}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setCustomChosen(next === CUSTOM);
            if (next !== CUSTOM) onValue(next, false);
          }}
        >
          {presets.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
        {selected === CUSTOM && (
          <TextInput
            id={`${id}-custom`}
            ariaLabel={`Custom ${label.toLowerCase()}`}
            settingsKey={settingsKey}
            value={value}
            autoFocus={customChosen}
            onText={(text) => {
              // Typing a preset name must not flip the select back and unmount this input.
              setCustomChosen(true);
              onValue(text, true);
            }}
          />
        )}
      </div>
    </Field>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      class="secondary copy"
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function CodeLine({ text }: { text: string }) {
  return (
    <div class="code-line">
      <code>{text}</code>
      <CopyButton text={text} />
    </div>
  );
}

export function Note({
  tone,
  children,
}: {
  tone: 'info' | 'error' | 'ok';
  children: ComponentChildren;
}) {
  return (
    <div class={`note note-${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  );
}
