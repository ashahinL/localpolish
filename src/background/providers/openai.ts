import { readSSE } from '../sse';
import { type StreamFn } from './types';

const OLLAMA_HINT =
  ' Ollama blocks unknown origins: set OLLAMA_ORIGINS=chrome-extension://* and restart Ollama.';

export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    /^127(\.\d{1,3}){3}$/.test(hostname) ||
    hostname === '[::1]'
  );
}

export const openaiProvider: StreamFn = async (prompt, settings, onText, signal) => {
  const model = settings.models['openai-compatible'];
  if (model === '') {
    throw new Error('Set a model name for the OpenAI-compatible provider in LocalPolish settings.');
  }

  const baseUrl = settings.openaiBaseUrl.replace(/\/+$/, '');
  if (settings.openaiApiKey !== '') {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error(`The base URL is not valid: ${baseUrl}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('The base URL must start with http:// or https://.');
    }
    if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
      throw new Error(
        `Use an https:// base URL to send an API key to ${url.hostname}, or remove the key.`,
      );
    }
  }

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

  let sawStop = false;
  for await (const event of readSSE(res.body)) {
    if (event.data === '[DONE]') return;
    const parsed = JSON.parse(event.data) as {
      choices?: Array<{ delta?: { content?: unknown }; finish_reason?: string | null }>;
      error?: { message?: string };
    };
    if (parsed.error !== undefined) {
      throw new Error(parsed.error.message ?? 'The model returned an error.');
    }
    const choice = parsed.choices?.[0];
    const content = choice?.delta?.content;
    if (typeof content === 'string' && content !== '') onText(content);
    if (choice?.finish_reason === 'length') {
      throw new Error('The answer was cut off. Try a shorter text.');
    }
    const reason = choice?.finish_reason;
    if (reason === 'content_filter') {
      throw new Error('The provider blocked this answer.');
    }
    if (reason != null && reason !== 'stop') {
      throw new Error(`The answer ended early (${reason}). Try again.`);
    }
    if (reason === 'stop') sawStop = true;
  }
  if (!sawStop) {
    throw new Error('The answer was cut off. Try again.');
  }
};
