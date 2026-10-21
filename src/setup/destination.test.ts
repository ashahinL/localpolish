import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../core/settings';
import { destination } from './destination';

function settings(patch: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

describe('destination', () => {
  it('explains Antigravity delivery and conversation deletion', () => {
    expect(destination(settings({ provider: 'antigravity-cli' }))).toBe(
      'Your text goes from this computer, through the bridge, to the Antigravity CLI, which sends it to Google. LocalPolish deletes each Antigravity conversation after the answer.',
    );
  });
  it.each([
    ['claude-cli', 'Anthropic'],
    ['codex-cli', 'OpenAI'],
    ['grok-cli', 'xAI'],
  ] as const)('sends %s through the bridge to %s', (provider, company) => {
    const line = destination(settings({ provider }));
    expect(line).toContain('this computer, through the bridge');
    expect(line).toContain(`sends it to ${company}.`);
  });

  it('says Grok keeps history and can search X', () => {
    expect(destination(settings({ provider: 'grok-cli' }))).toContain(
      'Grok keeps history in ~/.grok and can search X.',
    );
    expect(destination(settings({ provider: 'codex-cli' }))).not.toContain('~/.grok');
  });

  it("names Anthropic's API", () => {
    expect(destination(settings({ provider: 'anthropic-api' }))).toBe(
      "Your text goes to Anthropic's API.",
    );
  });

  it.each([
    'http://localhost:11434/v1',
    'http://127.0.0.1:1234/v1',
    'http://127.4.5.6/v1',
    'http://[::1]:8080/v1',
    'http://ollama.localhost:11434/v1',
  ])('calls %s a server on this computer', (openaiBaseUrl) => {
    expect(destination(settings({ provider: 'openai-compatible', openaiBaseUrl }))).toBe(
      `Your text goes to ${openaiBaseUrl}, a server on this computer.`,
    );
  });

  it.each([
    'https://api.openai.com/v1',
    'http://localhost.example.com/v1',
    'http://127.0.0.1.example.com/v1',
    'http://10.0.0.5:11434/v1',
  ])('calls %s a server outside this computer', (openaiBaseUrl) => {
    expect(destination(settings({ provider: 'openai-compatible', openaiBaseUrl }))).toBe(
      `Your text goes to ${openaiBaseUrl}, a server outside this computer.`,
    );
  });

  it('falls back when the base URL is half-typed', () => {
    expect(destination(settings({ provider: 'openai-compatible', openaiBaseUrl: 'http://' }))).toBe(
      'Your text goes to the base URL you set above.',
    );
  });
});
