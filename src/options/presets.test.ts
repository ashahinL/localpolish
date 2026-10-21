import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/settings';
import {
  CLI_EFFORTS,
  cliEfforts,
  CLI_MODELS,
  CUSTOM,
  isOllamaUrl,
  OPENAI_BASE_URLS,
  selectedOption,
} from './presets';

describe('selectedOption', () => {
  const presets = CLI_MODELS['claude-cli'];

  it('selects the preset that matches the stored value', () => {
    expect(selectedOption(presets, 'sonnet', false)).toBe('sonnet');
  });

  it('shows a stored value that is not a preset as Custom', () => {
    expect(selectedOption(presets, 'claude-opus-5-5[1m]', false)).toBe(CUSTOM);
  });

  it('stays on Custom once chosen, even when the text matches a preset', () => {
    expect(selectedOption(presets, 'haiku', true)).toBe(CUSTOM);
  });

  it('treats the empty Grok model as the CLI default preset', () => {
    expect(selectedOption(CLI_MODELS['grok-cli'], '', false)).toBe('');
  });
});

describe('presets', () => {
  it('include every default model and effort', () => {
    for (const provider of ['claude-cli', 'codex-cli', 'grok-cli', 'antigravity-cli'] as const) {
      const models = CLI_MODELS[provider].map((preset) => preset.value);
      const efforts = cliEfforts(provider, DEFAULT_SETTINGS.models[provider]).map(
        (preset) => preset.value,
      );
      expect(models).toContain(DEFAULT_SETTINGS.models[provider]);
      expect(efforts).toContain(DEFAULT_SETTINGS.efforts[provider]);
    }
    expect(OPENAI_BASE_URLS.map((preset) => preset.value)).toContain(
      DEFAULT_SETTINGS.openaiBaseUrl,
    );
  });
});

describe('isOllamaUrl', () => {
  it('matches the preset and other hosts on the Ollama port', () => {
    expect(isOllamaUrl('http://localhost:11434/v1')).toBe(true);
    expect(isOllamaUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isOllamaUrl('http://localhost:1234/v1')).toBe(false);
    expect(isOllamaUrl('http://localhost:114345/v1')).toBe(false);
  });
});

describe('cliEfforts', () => {
  const levels = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
  ];

  it('offers Low, Medium and High for Antigravity Gemini', () => {
    expect(cliEfforts('antigravity-cli', 'gemini-3.8-flash')).toEqual(levels);
  });

  it.each(['gpt-oss-120b', 'claude-sonnet-4-6', 'claude-opus-4-6'])(
    'offers no effort for Antigravity %s',
    (model) => expect(cliEfforts('antigravity-cli', model)).toEqual([]),
  );

  it('offers the model default and levels for a custom Antigravity model', () => {
    expect(cliEfforts('antigravity-cli', 'custom-model')).toEqual([
      { value: '', label: 'Model default' },
      ...levels,
    ]);
  });

  it('keeps other providers unchanged', () => {
    expect(cliEfforts('codex-cli', 'gpt-6-luna')).toBe(CLI_EFFORTS['codex-cli']);
  });
});
