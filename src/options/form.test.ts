import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../core/settings';
import {
  formatSeconds,
  mergeExternal,
  parseBlocklist,
  parseTemperature,
  pickSettings,
  shortcutKeys,
} from './form';

describe('parseBlocklist', () => {
  it('keeps trimmed, non-empty lines', () => {
    expect(parseBlocklist('  mail.google.com \n\n\texample.com\n   \n')).toEqual([
      'mail.google.com',
      'example.com',
    ]);
  });
});

describe('parseTemperature', () => {
  it('accepts numbers from 0 to 1', () => {
    expect(parseTemperature('0')).toBe(0);
    expect(parseTemperature('0.7')).toBe(0.7);
    expect(parseTemperature('1')).toBe(1);
  });

  it('rejects empty, out of range and non-numeric text', () => {
    expect(parseTemperature('')).toBeNull();
    expect(parseTemperature('1.5')).toBeNull();
    expect(parseTemperature('-0.1')).toBeNull();
    expect(parseTemperature('warm')).toBeNull();
  });
});

describe('formatSeconds', () => {
  it('shows seconds with one decimal', () => {
    expect(formatSeconds(1234)).toBe('1.2');
    expect(formatSeconds(980)).toBe('1.0');
  });
});

describe('shortcutKeys', () => {
  it('splits Windows and Linux shortcuts on plus signs', () => {
    expect(shortcutKeys('Ctrl+Shift+K')).toEqual(['Ctrl', 'Shift', 'K']);
  });

  it('splits macOS symbol shortcuts per character', () => {
    expect(shortcutKeys('⇧⌘K')).toEqual(['⇧', '⌘', 'K']);
  });

  it('returns no keys when the shortcut is not set', () => {
    expect(shortcutKeys('')).toEqual([]);
  });
});

describe('pickSettings', () => {
  it('copies only the named fields', () => {
    expect(pickSettings(DEFAULT_SETTINGS, ['provider', 'temperature'])).toEqual({
      provider: 'codex-cli',
      temperature: 0.3,
    });
  });
});

describe('mergeExternal', () => {
  it('takes saved changes but keeps the fields being edited', () => {
    const current: Settings = { ...DEFAULT_SETTINGS, openaiApiKey: 'typing', temperature: 0.3 };
    const incoming: Settings = { ...DEFAULT_SETTINGS, openaiApiKey: 'old', temperature: 0.9 };
    const merged = mergeExternal(current, incoming, new Set(['openaiApiKey']));
    expect(merged.openaiApiKey).toBe('typing');
    expect(merged.temperature).toBe(0.9);
  });
});
