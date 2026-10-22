import { exceedsMultiTurnInput, INPUT_LIMIT_MESSAGE } from '../../core/limits';
import { readSSE } from '../sse';
import { readErrorDetail } from './httpError';
import { type StreamFn } from './types';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

interface AnthropicEvent {
  type?: string;
  delta?: { type?: string; text?: string; stop_reason?: string };
  error?: { message?: string };
}

export const anthropicProvider: StreamFn = async (messages, settings, onText, signal) => {
  if (settings.anthropicApiKey === '') {
    throw new Error('Add your Anthropic API key in LocalPolish settings.');
  }
  if (exceedsMultiTurnInput(messages)) throw new Error(INPUT_LIMIT_MESSAGE);

  const first = messages[0];
  const system = first?.role === 'system' ? first.content : '';
  const turns = first?.role === 'system' ? messages.slice(1) : messages;
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.models['anthropic-api'],
      max_tokens: 4096,
      temperature: settings.temperature,
      system,
      stream: true,
      messages: turns.map((message) => ({ role: message.role, content: message.content })),
    }),
    signal,
  });

  if (!res.ok) {
    const detail = await readErrorDetail(res);
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }

  if (res.body === null) {
    throw new Error(`HTTP ${res.status}: empty response`);
  }

  for await (const event of readSSE(res.body)) {
    const parsed = JSON.parse(event.data) as AnthropicEvent;
    if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
      if (typeof parsed.delta.text === 'string') onText(parsed.delta.text);
      continue;
    }
    if (parsed.type === 'error') {
      throw new Error(parsed.error?.message ?? 'The model returned an error.');
    }
    if (parsed.type === 'message_delta' && parsed.delta?.stop_reason === 'max_tokens') {
      throw new Error('The answer was cut off. Try a shorter text.');
    }
    if (parsed.type === 'message_stop') return;
  }
  throw new Error('The answer was cut off. Try again.');
};
