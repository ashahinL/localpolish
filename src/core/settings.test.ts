import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, isBlocked, loadSettings, saveSettings } from './settings';

let memory: Map<string, unknown>;

beforeEach(() => {
  memory = new Map();
  const chrome = {
    storage: {
      local: {
        get: (key: string) => {
          if (!memory.has(key)) return Promise.resolve({});
          return Promise.resolve({ [key]: memory.get(key) });
        },
        set: (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) memory.set(key, value);
          return Promise.resolve();
        },
      },
    },
  };
  (globalThis as unknown as { chrome: typeof chrome }).chrome = chrome;
});

describe('loadSettings', () => {
  it('returns defaults when nothing is stored', async () => {
    const loaded = await loadSettings();
    expect(loaded).toEqual(DEFAULT_SETTINGS);

    loaded.blocklist.push('evil.com');
    loaded.models['claude-cli'] = 'changed';
    expect(DEFAULT_SETTINGS.blocklist).toEqual([]);
    expect(DEFAULT_SETTINGS.models['claude-cli']).toBe('haiku');
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('merges partial stored data and fills missing model keys', async () => {
    memory.set('settings', {
      provider: 'openai-compatible',
      temperature: 0,
      models: { 'claude-cli': 'opus' },
      blocklist: ['news.example.com'],
    });

    const settings = await loadSettings();
    expect(settings.provider).toBe('openai-compatible');
    expect(settings.temperature).toBe(0);
    expect(settings.blocklist).toEqual(['news.example.com']);
    expect(settings.openaiBaseUrl).toBe('http://localhost:11434/v1');
    expect(settings.defaultMode).toBe('fix');
    expect(settings.models).toEqual({
      'claude-cli': 'opus',
      'codex-cli': 'gpt-6-luna',
      'grok-cli': '',
      'openai-compatible': '',
      'anthropic-api': 'claude-haiku-5-5',
    });
  });
});

describe('saveSettings', () => {
  it('round trips a patch and keeps fields the patch does not set', async () => {
    await saveSettings({
      provider: 'anthropic-api',
      anthropicApiKey: 'sk-test',
      blocklist: ['example.com'],
    });
    await saveSettings({ temperature: 0 });

    const settings = await loadSettings();
    expect(settings.provider).toBe('anthropic-api');
    expect(settings.anthropicApiKey).toBe('sk-test');
    expect(settings.temperature).toBe(0);
    expect(settings.blocklist).toEqual(['example.com']);
    expect(settings.defaultMode).toBe('fix');
    expect(settings.defaultTone).toBe('polite');
    expect(settings.models['claude-cli']).toBe('haiku');
    expect(settings.openaiBaseUrl).toBe(DEFAULT_SETTINGS.openaiBaseUrl);
  });
});

describe('isBlocked', () => {
  it('blocks the hostname itself', () => {
    expect(isBlocked('example.com', ['example.com'])).toBe(true);
  });

  it('blocks a subdomain', () => {
    expect(isBlocked('mail.example.com', ['example.com'])).toBe(true);
  });

  it('does not block a different host that only shares a suffix', () => {
    expect(isBlocked('notexample.com', ['example.com'])).toBe(false);
  });

  it('compares without case', () => {
    expect(isBlocked('Mail.Example.COM', ['Example.COM'])).toBe(true);
  });

  it('trims entries and ignores empty ones', () => {
    expect(isBlocked('example.com', ['  example.com  '])).toBe(true);
    expect(isBlocked('example.com', ['', '   '])).toBe(false);
  });

  it('ignores a leading *. or www. on the entry', () => {
    expect(isBlocked('example.com', ['*.example.com'])).toBe(true);
    expect(isBlocked('mail.example.com', ['*.example.com'])).toBe(true);
    expect(isBlocked('example.com', ['www.example.com'])).toBe(true);
    expect(isBlocked('mail.example.com', ['www.example.com'])).toBe(true);
    expect(isBlocked('notexample.com', ['*.example.com'])).toBe(false);
    expect(isBlocked('mail.example.com', ['*.www.example.com'])).toBe(true);
  });
});
