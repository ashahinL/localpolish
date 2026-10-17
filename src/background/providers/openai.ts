import { readSSE } from '../sse';
import { type StreamFn } from './types';

const OLLAMA_HINT =
  ' Ollama blocks unknown origins: set OLLAMA_ORIGINS=chrome-extension://* and restart Ollama.';

export const openaiProvider: StreamFn = async (prompt, settings, onText, signal) => {
  const model = settings.models['openai-compatible'];
  if (model === '') {
    throw new Error('Set a model name for the OpenAI-compatible provider in LocalPolish settings.');
  }

  const baseUrl = settings.openaiBaseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (settings.openaiApiKey !== '') {
    headers.authorization = `Bearer ${settings.openaiApiKey}`;
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: settings.temperature,
        stream: true,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
      signal,
    });
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error(`Cannot reach ${baseUrl}. Is the server running?`, { cause: err });
    }
    throw err;
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    let message = `HTTP ${res.status}: ${detail}`;
    if (res.status === 403 && settings.openaiBaseUrl.includes(':11434')) {
      message += OLLAMA_HINT;
    }
    throw new Error(message);
  }

  if (res.body === null) {
    throw new Error(`HTTP ${res.status}: empty response`);
  }

  for await (const event of readSSE(res.body)) {
    if (event.data === '[DONE]') return;
    const parsed = JSON.parse(event.data) as {
      choices?: Array<{ delta?: { content?: unknown } }>;
    };
    const content = parsed.choices?.[0]?.delta?.content;
    if (typeof content === 'string' && content !== '') onText(content);
  }
};
