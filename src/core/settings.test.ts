import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  isBlocked,
  loadSettings,
  pageSettings,
  saveSettings,
  type Settings,
} from './settings';

let memory: Map<string, unknown>;
let delayedGet: boolean;

beforeEach(() => {
  memory = new Map();
  delayedGet = false;
  const chrome = {
    storage: {
      local: {
        get: async (key: string) => {
          const stored = memory.has(key) ? { [key]: memory.get(key) } : {};
          if (delayedGet) await new Promise((resolve) => setTimeout(resolve, 0));
          return stored;
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

afterEach(() => vi.unstubAllGlobals());

describe('loadSettings', () => {
  it('returns defaults when nothing is stored', async () => {
    const loaded = await loadSettings();
    expect(loaded).toEqual(DEFAULT_SETTINGS);
    expect(loaded.models['antigravity-cli']).toBe('gemini-3.8-flash');
    expect(loaded.efforts['antigravity-cli']).toBe('low');

    loaded.blocklist.push('evil.com');
    loaded.models['claude-cli'] = 'changed';
    expect(DEFAULT_SETTINGS.blocklist).toEqual([]);
    expect(DEFAULT_SETTINGS.models['claude-cli']).toBe('haiku');
    expect(DEFAULT_SETTINGS.idleFix).toBe(true);
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it.each([
    ['gemini-3.8-flash-low', 'gemini-3.8-flash', 'low'],
    ['gemini-3.8-flash-medium', 'gemini-3.8-flash', 'medium'],
    ['gemini-3.8-flash-high', 'gemini-3.8-flash', 'high'],
    ['gpt-oss-120b-medium', 'gpt-oss-120b', ''],
  ])('migrates the old Antigravity model %s', async (oldModel, model, effort) => {
    memory.set('settings', {
      models: { 'antigravity-cli': oldModel },
      efforts: { 'antigravity-cli': 'max', 'codex-cli': 'high' },
    });
    const loaded = await loadSettings();
    expect(loaded.models['antigravity-cli']).toBe(model);
    expect(loaded.efforts['antigravity-cli']).toBe(effort);
    expect(loaded.efforts['codex-cli']).toBe('high');
  });

  it('loads a stored idleFix of false', async () => {
    memory.set('settings', { idleFix: false });
    expect((await loadSettings()).idleFix).toBe(false);
  });

  it('falls back to true when stored idleFix is not a boolean', async () => {
    memory.set('settings', { idleFix: 'no' });
    expect((await loadSettings()).idleFix).toBe(true);
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
      'antigravity-cli': 'gemini-3.8-flash',
      'openai-compatible': '',
      'anthropic-api': 'claude-haiku-5-5',
    });
  });

  it('loads an old tone default mode as Fix and drops the old default tone', async () => {
    memory.set('settings', { defaultMode: 'tone', defaultTone: 'formal' });
    const settings = await loadSettings();
    expect(settings.defaultMode).toBe('fix');
    expect(settings).not.toHaveProperty('defaultTone');

    memory.set('settings', { defaultMode: 'shorter' });
    expect((await loadSettings()).defaultMode).toBe('shorter');
  });

  it('drops damaged blocklist entries before matching sites', async () => {
    memory.set('settings', { blocklist: [null, 'a.com', 5] });
    const settings = await loadSettings();
    expect(settings.blocklist).toEqual(['a.com']);
    expect(isBlocked('a.com', settings.blocklist)).toBe(true);
  });

  it('keeps only known models and efforts with string values', async () => {
    memory.set('settings', {
      models: {
        'codex-cli': null,
        'claude-cli': 'opus',
        'openai-compatible': 'my-model:7b',
        bogus: 'x',
      },
      efforts: { 'codex-cli': null, 'claude-cli': 'high', 'anthropic-api': 'low', bogus: 'x' },
    });
    const settings = await loadSettings();
    expect(settings.models).toEqual({
      ...DEFAULT_SETTINGS.models,
      'claude-cli': 'opus',
      'openai-compatible': 'my-model:7b',
    });
    expect(settings.efforts).toEqual({ ...DEFAULT_SETTINGS.efforts, 'claude-cli': 'high' });
  });

  it('uses defaults for an invalid provider and drops unknown fields', async () => {
    memory.set('settings', { provider: 'nope', unknownField: 'value' });
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it.each([7, -1, NaN, Infinity, '0.5', null])(
    'uses the default for invalid temperature %s',
    async (temperature) => {
      memory.set('settings', { temperature });
      expect((await loadSettings()).temperature).toBe(0.3);
    },
  );

  it('uses defaults for invalid string fields and records', async () => {
    memory.set('settings', {
      openaiBaseUrl: null,
      openaiApiKey: 5,
      anthropicApiKey: false,
      models: [],
      efforts: null,
      blocklist: 'a.com',
    });
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps the other CLI efforts when one is saved', async () => {
    await saveSettings({ efforts: { 'codex-cli': 'xhigh' } as Settings['efforts'] });

    const settings = await loadSettings();
    expect(settings.efforts).toEqual({
      'claude-cli': 'low',
      'codex-cli': 'xhigh',
      'grok-cli': 'low',
      'antigravity-cli': 'low',
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
    expect(settings).not.toHaveProperty('defaultTone');
    expect(settings.models['claude-cli']).toBe('haiku');
    expect(settings.openaiBaseUrl).toBe(DEFAULT_SETTINGS.openaiBaseUrl);
  });

  it('keeps concurrent saves with the fallback queue', async () => {
    vi.stubGlobal('navigator', { locks: undefined });
    delayedGet = true;
    await Promise.all([saveSettings({ idleFix: false }), saveSettings({ defaultMode: 'shorter' })]);
    expect(memory.get('settings')).toEqual({
      ...DEFAULT_SETTINGS,
      idleFix: false,
      defaultMode: 'shorter',
    });
  });

  it.skipIf(!globalThis.navigator?.locks)(
    'keeps concurrent saves from separate modules',
    async () => {
      vi.resetModules();
      const first = await import('./settings');
      vi.resetModules();
      const second = await import('./settings');
      delayedGet = true;
      await Promise.all([
        first.saveSettings({ idleFix: false }),
        second.saveSettings({ defaultMode: 'shorter' }),
      ]);
      expect(memory.get('settings')).toEqual({
        ...DEFAULT_SETTINGS,
        idleFix: false,
        defaultMode: 'shorter',
      });
    },
  );

  it('saves idleFix off and keeps the other defaults', async () => {
    await saveSettings({ idleFix: false });
    expect(await loadSettings()).toEqual({ ...DEFAULT_SETTINGS, idleFix: false });
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

  it.each([
    ['example.com', 'example.com:8080/path'],
    ['example.com', 'https://Example.com/x'],
    ['example.com', 'https://www.example.com/x'],
    ['sub.example.com', '*.example.com'],
    ['[::1]', '[::1]:5179'],
    ['xn--bcher-kva.de', 'bücher.de'],
  ])('blocks %s using the site entry %s', (host, entry) => {
    expect(isBlocked(host, [entry])).toBe(true);
  });

  it('ignores text that is not a site', () => {
    expect(isBlocked('example.com', ['not a site', 'https://', 'file:///x'])).toBe(false);
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

describe('language settings', () => {
  it('defaults all four languages on and copies the defaults', async () => {
    const settings = await loadSettings();
    expect(settings.languages).toEqual({ en: true, ar: true, franco: true, other: true });
    settings.languages.ar = false;
    expect((await loadSettings()).languages.ar).toBe(true);
  });

  it.each([null, [], 'off', { ar: 'false', en: 0, franco: null, other: false, unknown: true }])(
    'ignores damaged language values: %j',
    async (languages) => {
      memory.set('settings', { languages });
      expect((await loadSettings()).languages).toEqual({
        en: true,
        ar: true,
        franco: true,
        other:
          typeof languages === 'object' && languages !== null && !Array.isArray(languages)
            ? false
            : true,
      });
    },
  );

  it('saves each switch without losing the others', async () => {
    await saveSettings({ languages: { ar: false } });
    await saveSettings({ languages: { franco: false } });
    await saveSettings({ temperature: 0 });
    expect((await loadSettings()).languages).toEqual({
      en: true,
      ar: false,
      franco: false,
      other: true,
    });
  });

  it('includes sanitized languages in page settings', () => {
    expect(pageSettings({ languages: { ar: false, bogus: false } })).toEqual({
      blocklist: [],
      idleFix: true,
      defaultMode: 'fix',
      languages: { en: true, ar: false, franco: true, other: true },
    });
  });
});

describe('chat settings', () => {
  it('copies stored Fix choices on first load and does not alias the model maps', async () => {
    const storedModels = {
      'claude-cli': 'opus',
      'antigravity-cli': 'gemini-3.8-flash-high',
      'openai-compatible': 'local-model',
    };
    memory.set('settings', { provider: 'openai-compatible', models: storedModels });
    const loaded = await loadSettings();
    storedModels['claude-cli'] = 'changed';
    expect(loaded.provider).toBe('openai-compatible');
    expect(loaded.models['claude-cli']).toBe('opus');
    expect(loaded.models['antigravity-cli']).toBe('gemini-3.8-flash');
    expect(loaded.efforts['antigravity-cli']).toBe('high');
    expect(loaded.models['openai-compatible']).toBe('local-model');
    expect(loaded.chat.provider).toBe('openai-compatible');
    expect(loaded.chat.models).toEqual(loaded.models);
    expect(loaded.chat.models).not.toBe(loaded.models);
    expect(loaded.chat.models).not.toBe(DEFAULT_SETTINGS.chat.models);
    expect(loaded.models).not.toBe(DEFAULT_SETTINGS.models);
    expect(DEFAULT_SETTINGS.chat.models).not.toBe(DEFAULT_SETTINGS.models);
    loaded.chat.models['codex-cli'] = 'changed';
    loaded.models['codex-cli'] = 'changed-too';
    expect(DEFAULT_SETTINGS.chat.models['codex-cli']).toBe('gpt-6-luna');
    expect(DEFAULT_SETTINGS.models['codex-cli']).toBe('gpt-6-luna');
    expect((await loadSettings()).chat.models['codex-cli']).toBe('gpt-6-luna');
    expect((await loadSettings()).models['codex-cli']).toBe('gpt-6-luna');
  });

  it('keeps saved chat choices when Fix changes later', async () => {
    await saveSettings({
      chat: { provider: 'grok-cli', models: { 'grok-cli': 'grok-4' } },
    });
    await saveSettings({
      provider: 'anthropic-api',
      models: { ...DEFAULT_SETTINGS.models, 'claude-cli': 'opus', 'grok-cli': 'other' },
    });
    const loaded = await loadSettings();
    expect(loaded.provider).toBe('anthropic-api');
    expect(loaded.models['claude-cli']).toBe('opus');
    expect(loaded.models['grok-cli']).toBe('other');
    expect(loaded.chat.provider).toBe('grok-cli');
    expect(loaded.chat.models['grok-cli']).toBe('grok-4');
    expect(loaded.chat.models['claude-cli']).toBe('haiku');
    const stored = memory.get('settings') as Settings;
    expect(Object.keys(stored.chat.models).sort()).toEqual(
      Object.keys(DEFAULT_SETTINGS.models).sort(),
    );
  });

  it('merges partial chat model saves and keeps the other chat models', async () => {
    await saveSettings({ chat: { models: { 'claude-cli': 'opus' } } });
    await saveSettings({ chat: { models: { 'codex-cli': 'gpt-6' } } });
    const loaded = await loadSettings();
    expect(loaded.chat.provider).toBe('codex-cli');
    expect(loaded.chat.models['claude-cli']).toBe('opus');
    expect(loaded.chat.models['codex-cli']).toBe('gpt-6');
    expect(loaded.chat.models['anthropic-api']).toBe('claude-haiku-5-5');
    loaded.chat.models['claude-cli'] = 'mutated';
    expect((await loadSettings()).chat.models['claude-cli']).toBe('opus');
  });

  it('fills missing chat fields from normalized Fix values and drops bad data', async () => {
    memory.set('settings', {
      provider: 'anthropic-api',
      models: { 'claude-cli': 'opus', 'anthropic-api': 'sonnet-custom' },
      chat: { models: { 'codex-cli': 'custom' } },
    });
    const partial = await loadSettings();
    expect(partial.chat.provider).toBe('anthropic-api');
    expect(partial.chat.models['codex-cli']).toBe('custom');
    expect(partial.chat.models['claude-cli']).toBe('opus');
    expect(partial.chat.models['anthropic-api']).toBe('sonnet-custom');

    memory.set('settings', {
      provider: 'openai-compatible',
      models: { 'openai-compatible': 'local-model' },
      chat: ['claude-cli'],
    });
    const array = await loadSettings();
    expect(array.chat.provider).toBe('openai-compatible');
    expect(array.chat.models).toEqual(array.models);
    expect(array.chat).not.toHaveProperty('0');

    memory.set('settings', {
      provider: 'codex-cli',
      chat: {
        provider: 'nope',
        models: { 'claude-cli': 5, 'codex-cli': 'custom', bogus: 'x' },
        extra: true,
      },
    });
    const malformed = await loadSettings();
    expect(malformed.chat.provider).toBe('codex-cli');
    expect(malformed.chat.models['claude-cli']).toBe('haiku');
    expect(malformed.chat.models['codex-cli']).toBe('custom');
    expect(malformed.chat.models).not.toHaveProperty('bogus');
    expect(malformed.chat).not.toHaveProperty('extra');

    memory.set('settings', {
      provider: 'grok-cli',
      chat: { provider: 'claude-cli', models: [] },
    });
    const badModels = await loadSettings();
    expect(badModels.chat.provider).toBe('claude-cli');
    expect(badModels.chat.models).toEqual(badModels.models);
    expect(badModels.models['grok-cli']).toBe('');
  });

  it('keeps page settings to the same four fields when chat is stored', () => {
    expect(
      pageSettings({
        chat: { provider: 'grok-cli', models: { 'claude-cli': 'opus' } },
        languages: { ar: false },
        blocklist: ['example.com'],
      }),
    ).toEqual({
      blocklist: ['example.com'],
      idleFix: true,
      defaultMode: 'fix',
      languages: { en: true, ar: false, franco: true, other: true },
    });
  });
});
