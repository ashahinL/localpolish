import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/settings';
import {
  CLI_EFFORTS,
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
      const efforts = CLI_EFFORTS[provider].map((preset) => preset.value);
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
