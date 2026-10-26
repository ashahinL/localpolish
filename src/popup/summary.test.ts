import { describe, expect, it } from 'vitest';
import { type BridgeStatus } from '../core/messages';
import { DEFAULT_SETTINGS, type Settings } from '../core/settings';
import { connection, providerSummary } from './summary';

function settings(
  patch: Partial<Omit<Settings, 'models' | 'efforts'>> & {
    models?: Partial<Settings['models']>;
    efforts?: Partial<Settings['efforts']>;
  } = {},
): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...patch,
    models: { ...DEFAULT_SETTINGS.models, ...patch.models },
    efforts: { ...DEFAULT_SETTINGS.efforts, ...patch.efforts },
  };
}

function bridge(missing: 'claude' | 'codex' | 'grok' | 'agy' | null = null): BridgeStatus {
  return {
    ok: true,
    clis: {
      claude: missing === 'claude' ? null : { version: '1.2.3' },
      codex: missing === 'codex' ? null : { version: '1.2.3' },
      grok: missing === 'grok' ? null : { version: '1.2.3' },
      agy: missing === 'agy' ? null : { version: '1.2.3' },
    },
  };
}

describe('providerSummary', () => {
  it('shows Antigravity Gemini with Low effort', () => {
    expect(providerSummary(settings({ provider: 'antigravity-cli' }))).toEqual({
      title: 'Antigravity CLI',
      mark: 'Ag',
      detail: 'Gemini 3.8 Flash · Low',
    });
  });
  it('shows Antigravity Sonnet without an effort part', () => {
    expect(
      providerSummary(
        settings({
          provider: 'antigravity-cli',
          models: { 'antigravity-cli': 'claude-sonnet-4-6' },
          efforts: { 'antigravity-cli': 'low' },
        }),
      ).detail,
    ).toBe('Claude Sonnet 4.6');
  });

  it('uses the Codex preset labels for the default settings', () => {
    expect(providerSummary(DEFAULT_SETTINGS)).toEqual({
      title: 'Codex',
      mark: 'Cx',
      detail: 'GPT-6.1 Terra · None',
    });
  });

  it('uses the Grok CLI default model label', () => {
    expect(providerSummary(settings({ provider: 'grok-cli' }))).toEqual({
      title: 'Grok CLI',
      mark: 'Gk',
      detail: 'CLI default (grok-4.7) · Low',
    });
  });

  it('uses Claude Code preset labels', () => {
    expect(
      providerSummary(
        settings({
          provider: 'claude-cli',
          models: { 'claude-cli': 'sonnet' },
          efforts: { 'claude-cli': 'xhigh' },
        }),
      ),
    ).toEqual({
      title: 'Claude Code',
      mark: 'CC',
      detail: 'Sonnet · Extra high',
    });
  });

  it('shows a CLI model and effort that are not presets as typed', () => {
    expect(
      providerSummary(
        settings({
          provider: 'claude-cli',
          models: { 'claude-cli': 'my-model' },
          efforts: { 'claude-cli': 'ultra' },
        }),
      ),
    ).toEqual({
      title: 'Claude Code',
      mark: 'CC',
      detail: 'my-model · ultra',
    });
  });

  it('shortens the OpenAI-compatible title and names the base URL preset', () => {
    expect(providerSummary(settings({ provider: 'openai-compatible' }))).toEqual({
      title: 'OpenAI-compatible',
      mark: 'AI',
      detail: 'No model set · Ollama',
    });
  });

  it('shows the model and another preset label', () => {
    expect(
      providerSummary(
        settings({
          provider: 'openai-compatible',
          models: { 'openai-compatible': 'llama3.2' },
          openaiBaseUrl: 'https://api.openai.com/v1',
        }),
      ),
    ).toEqual({
      title: 'OpenAI-compatible',
      mark: 'AI',
      detail: 'llama3.2 · OpenAI',
    });
  });

  it('shows the host when the base URL is not a preset', () => {
    expect(
      providerSummary(
        settings({
          provider: 'openai-compatible',
          openaiBaseUrl: 'https://example.com:8080/v1',
        }),
      ),
    ).toEqual({
      title: 'OpenAI-compatible',
      mark: 'AI',
      detail: 'No model set · example.com:8080',
    });
  });

  it('shows the raw text when the base URL cannot be parsed', () => {
    expect(
      providerSummary(
        settings({
          provider: 'openai-compatible',
          openaiBaseUrl: 'not a url',
        }),
      ),
    ).toEqual({
      title: 'OpenAI-compatible',
      mark: 'AI',
      detail: 'No model set · not a url',
    });
  });

  it('uses the Anthropic model label and the temperature', () => {
    expect(providerSummary(settings({ provider: 'anthropic-api', temperature: 0.7 }))).toEqual({
      title: 'Anthropic API',
      mark: 'An',
      detail: 'Claude Haiku 5.5 · Temperature 0.7',
    });
  });

  it('shows an Anthropic model that is not a preset as typed', () => {
    expect(
      providerSummary(
        settings({
          provider: 'anthropic-api',
          models: { 'anthropic-api': 'claude-custom' },
        }),
      ),
    ).toEqual({
      title: 'Anthropic API',
      mark: 'An',
      detail: 'claude-custom · Temperature 0.3',
    });
  });
});

describe('connection', () => {
  it('is neutral while a CLI bridge check has not returned', () => {
    expect(connection(DEFAULT_SETTINGS, null)).toEqual({ tone: 'neutral', label: 'Checking…' });
  });

  it('is an error when the bridge is down', () => {
    expect(connection(DEFAULT_SETTINGS, { ok: false, message: 'gone' })).toEqual({
      tone: 'error',
      label: 'No bridge',
    });
  });

  it('names Claude Code when that CLI is missing', () => {
    expect(connection(settings({ provider: 'claude-cli' }), bridge('claude'))).toEqual({
      tone: 'error',
      label: 'Claude Code not found',
    });
  });

  it('names Codex when that CLI is missing', () => {
    expect(connection(DEFAULT_SETTINGS, bridge('codex'))).toEqual({
      tone: 'error',
      label: 'Codex not found',
    });
  });

  it('names Antigravity when agy is missing', () => {
    expect(connection(settings({ provider: 'antigravity-cli' }), bridge('agy'))).toEqual({
      tone: 'error',
      label: 'Antigravity CLI not found',
    });
    expect(connection(settings({ provider: 'antigravity-cli' }), bridge())).toEqual({
      tone: 'ok',
      label: 'Bridge ready',
    });
  });

  it('names Grok CLI when that CLI is missing', () => {
    expect(connection(settings({ provider: 'grok-cli' }), bridge('grok'))).toEqual({
      tone: 'error',
      label: 'Grok CLI not found',
    });
  });

  it('is ready when the selected CLI is installed', () => {
    expect(connection(DEFAULT_SETTINGS, bridge())).toEqual({ tone: 'ok', label: 'Bridge ready' });
    expect(connection(settings({ provider: 'claude-cli' }), bridge('codex'))).toEqual({
      tone: 'ok',
      label: 'Bridge ready',
    });
    expect(connection(settings({ provider: 'grok-cli' }), bridge())).toEqual({
      tone: 'ok',
      label: 'Bridge ready',
    });
  });

  it('says the Anthropic key is saved only when one is stored', () => {
    expect(connection(settings({ provider: 'anthropic-api' }), null)).toEqual({
      tone: 'error',
      label: 'No API key',
    });
    expect(
      connection(settings({ provider: 'anthropic-api', anthropicApiKey: 'sk-ant' }), {
        ok: false,
        message: 'gone',
      }),
    ).toEqual({ tone: 'ok', label: 'Key saved' });
  });

  it('says the OpenAI key is saved even for a local server', () => {
    expect(
      connection(settings({ provider: 'openai-compatible', openaiApiKey: 'sk-test' }), null),
    ).toEqual({ tone: 'ok', label: 'Key saved' });
  });

  it('treats localhost, 127.0.0.1 and [::1] as a local server when no key is saved', () => {
    const local = { tone: 'neutral', label: 'Local server' } as const;
    expect(connection(settings({ provider: 'openai-compatible' }), null)).toEqual(local);
    expect(
      connection(
        settings({ provider: 'openai-compatible', openaiBaseUrl: 'http://127.0.0.1:1234/v1' }),
        null,
      ),
    ).toEqual(local);
    expect(
      connection(
        settings({ provider: 'openai-compatible', openaiBaseUrl: 'http://[::1]:11434/v1' }),
        null,
      ),
    ).toEqual(local);
  });

  it('asks for a key when the OpenAI host is not local and no key is saved', () => {
    const missing = { tone: 'error', label: 'No API key' } as const;
    expect(
      connection(
        settings({ provider: 'openai-compatible', openaiBaseUrl: 'https://api.openai.com/v1' }),
        null,
      ),
    ).toEqual(missing);
    expect(
      connection(
        settings({ provider: 'openai-compatible', openaiBaseUrl: 'http://127.0.0.2:1234/v1' }),
        null,
      ),
    ).toEqual(missing);
    expect(
      connection(settings({ provider: 'openai-compatible', openaiBaseUrl: 'not a url' }), null),
    ).toEqual(missing);
  });
});
