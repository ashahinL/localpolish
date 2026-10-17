import { type ProviderId } from '../../core/settings';
import { anthropicProvider } from './anthropic';
import { cliProvider } from './cli';
import { openaiProvider } from './openai';
import { type StreamFn } from './types';

export function getProvider(id: ProviderId): StreamFn {
  switch (id) {
    case 'claude-cli':
      return cliProvider('claude');
    case 'codex-cli':
      return cliProvider('codex');
    case 'grok-cli':
      return cliProvider('grok');
    case 'openai-compatible':
      return openaiProvider;
    case 'anthropic-api':
      return anthropicProvider;
  }
}
