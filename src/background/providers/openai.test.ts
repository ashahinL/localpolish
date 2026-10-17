import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../core/settings';
import { openaiProvider } from './openai';
import { type PromptPair } from './types';

const prompt: PromptPair = { system: 'SYSTEM', user: 'USER' };

function settings(
  patch: Partial<Omit<Settings, 'models'>> & { models?: Partial<Settings['models']> } = {},
): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...patch,
    models: { ...DEFAULT_SETTINGS.models, ...patch.models },
  };
}

function streamResponse(chunks: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status });
}

function uneven(text: string): string[] {
  return [text.slice(0, 11), text.slice(11, 17), text.slice(17)];
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function rejection(pending: Promise<unknown>): Promise<string> {
  try {
    await pending;
  } catch (err) {
    if (err instanceof Error) return err.message;
    throw err;
  }
  throw new Error('expected a rejection');
}

describe('openaiProvider', () => {
  it('streams content and posts to the base URL without a trailing slash', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"I "}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"went."}}]}\n\n' +
      'data: [DONE]\n\n';
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => streamResponse(uneven(sse)),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    const parts: string[] = [];
    const signal = new AbortController().signal;

    await openaiProvider(
      prompt,
      settings({
        openaiBaseUrl: 'http://localhost:11434/v1/',
        models: { 'openai-compatible': 'llama3.2' },
        temperature: 0.3,
      }),
      (text) => parts.push(text),
      signal,
    );

    expect(parts).toEqual(['I ', 'went.']);
    const call = fetchMock.mock.calls[0];
    if (call === undefined) throw new Error('fetch was not called');
    expect(String(call[0])).toBe('http://localhost:11434/v1/chat/completions');
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.signal).toBe(signal);
    expect(call[1]?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      model: 'llama3.2',
      temperature: 0.3,
      stream: true,
      messages: [
        { role: 'system', content: 'SYSTEM' },
        { role: 'user', content: 'USER' },
      ],
    });
  });

  it('sends a bearer token only when an API key is set', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => streamResponse(['data: [DONE]\n\n']),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    const ready = settings({
      models: { 'openai-compatible': 'llama3.2' },
      openaiApiKey: 'sk-test',
    });

    await openaiProvider(prompt, ready, () => undefined, new AbortController().signal);

    const call = fetchMock.mock.calls[0];
    if (call === undefined) throw new Error('fetch was not called');
    expect(call[1]?.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer sk-test',
    });
  });

  it('starts a 401 message with the status', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 401 })) as typeof fetch;
    const message = await rejection(
      openaiProvider(
        prompt,
        settings({ models: { 'openai-compatible': 'llama3.2' } }),
        () => undefined,
        new AbortController().signal,
      ),
    );
    expect(message.startsWith('HTTP 401:')).toBe(true);
    expect(message).toBe('HTTP 401: nope');
  });

  it('explains a 403 from Ollama and leaves other servers alone', async () => {
    const signal = new AbortController().signal;
    globalThis.fetch = vi.fn(async () => new Response('blocked', { status: 403 })) as typeof fetch;
    const ollama = await rejection(
      openaiProvider(
        prompt,
        settings({
          openaiBaseUrl: 'http://localhost:11434/v1',
          models: { 'openai-compatible': 'llama3.2' },
        }),
        () => undefined,
        signal,
      ),
    );
    expect(ollama).toContain('OLLAMA_ORIGINS');
    expect(ollama.startsWith('HTTP 403:')).toBe(true);

    globalThis.fetch = vi.fn(async () => new Response('blocked', { status: 403 })) as typeof fetch;
    const other = await rejection(
      openaiProvider(
        prompt,
        settings({
          openaiBaseUrl: 'https://api.example.com/v1',
          models: { 'openai-compatible': 'llama3.2' },
        }),
        () => undefined,
        signal,
      ),
    );
    expect(other).toBe('HTTP 403: blocked');
  });

  it('asks for a model name when the setting is empty', async () => {
    const message = await rejection(
      openaiProvider(prompt, settings(), () => undefined, new AbortController().signal),
    );
    expect(message).toBe(
      'Set a model name for the OpenAI-compatible provider in LocalPolish settings.',
    );
  });

  it('reports a fetch TypeError as an unreachable server', async () => {
    globalThis.fetch = vi.fn(() => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const message = await rejection(
      openaiProvider(
        prompt,
        settings({
          openaiBaseUrl: 'http://localhost:11434/v1/',
          models: { 'openai-compatible': 'llama3.2' },
        }),
        () => undefined,
        new AbortController().signal,
      ),
    );
    expect(message).toBe('Cannot reach http://localhost:11434/v1. Is the server running?');
  });
});
