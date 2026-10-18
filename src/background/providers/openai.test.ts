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

  it('rejects a stream cut off at the length limit', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"I "}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n' +
      'data: [DONE]\n\n';
    globalThis.fetch = vi.fn(async () => streamResponse(uneven(sse))) as typeof fetch;
    const message = await rejection(
      openaiProvider(
        prompt,
        settings({
          openaiBaseUrl: 'http://localhost:11434/v1',
          models: { 'openai-compatible': 'llama3.2' },
        }),
        () => undefined,
        new AbortController().signal,
      ),
    );
    expect(message).toBe('The answer was cut off. Try a shorter text.');
  });

  it.each([
    ['content_filter', 'The provider blocked this answer.'],
    ['tool_calls', 'The answer ended early (tool_calls). Try again.'],
  ])('rejects a stream ending with %s before [DONE]', async (reason, expected) => {
    const sse =
      'data: {"choices":[{"delta":{"content":"I "}}]}\n\n' +
      `data: {"choices":[{"delta":{},"finish_reason":"${reason}"}]}\n\n` +
      'data: [DONE]\n\n';
    globalThis.fetch = vi.fn(async () => streamResponse(uneven(sse))) as typeof fetch;
    const message = await rejection(
      openaiProvider(
        prompt,
        settings({ models: { 'openai-compatible': 'llama3.2' } }),
        () => undefined,
        new AbortController().signal,
      ),
    );
    expect(message).toBe(expected);
  });

  it('rejects with the message from an error event', async () => {
    const sse = 'data: {"error":{"message":"Overloaded"}}\n\n';
    globalThis.fetch = vi.fn(async () => streamResponse(uneven(sse))) as typeof fetch;
    const message = await rejection(
      openaiProvider(
        prompt,
        settings({
          openaiBaseUrl: 'http://localhost:11434/v1',
          models: { 'openai-compatible': 'llama3.2' },
        }),
        () => undefined,
        new AbortController().signal,
      ),
    );
    expect(message).toBe('Overloaded');
  });

  it('rejects an error event that has no message', async () => {
    const sse = 'data: {"error":{}}\n\n';
    globalThis.fetch = vi.fn(async () => streamResponse([sse])) as typeof fetch;
    const message = await rejection(
      openaiProvider(
        prompt,
        settings({
          openaiBaseUrl: 'http://localhost:11434/v1',
          models: { 'openai-compatible': 'llama3.2' },
        }),
        () => undefined,
        new AbortController().signal,
      ),
    );
    expect(message).toBe('The model returned an error.');
  });

  it('rejects a stream that ends without [DONE] or a stop reason', async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"I "}}]}\n\n';
    globalThis.fetch = vi.fn(async () => streamResponse(uneven(sse))) as typeof fetch;
    const message = await rejection(
      openaiProvider(
        prompt,
        settings({
          openaiBaseUrl: 'http://localhost:11434/v1',
          models: { 'openai-compatible': 'llama3.2' },
        }),
        () => undefined,
        new AbortController().signal,
      ),
    );
    expect(message).toBe('The answer was cut off. Try again.');
  });

  it.each(['', 'data: [DONE]\n\n'])(
    'accepts a stream that finishes with stop followed by %j',
    async (ending) => {
      const sse =
        'data: {"choices":[{"delta":{"content":"I went."}}]}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
        ending;
      globalThis.fetch = vi.fn(async () => streamResponse(uneven(sse))) as typeof fetch;
      const parts: string[] = [];
      await openaiProvider(
        prompt,
        settings({
          openaiBaseUrl: 'http://localhost:11434/v1',
          models: { 'openai-compatible': 'llama3.2' },
        }),
        (text) => parts.push(text),
        new AbortController().signal,
      );
      expect(parts).toEqual(['I went.']);
    },
  );

  it('refuses to send an API key to a remote http server', async () => {
    globalThis.fetch = vi.fn(() => {
      throw new Error('fetch should not run');
    }) as typeof fetch;
    const message = await rejection(
      openaiProvider(
        prompt,
        settings({
          openaiBaseUrl: 'http://example.com/v1',
          openaiApiKey: 'sk-test',
          models: { 'openai-compatible': 'llama3.2' },
        }),
        () => undefined,
        new AbortController().signal,
      ),
    );
    expect(message).toBe(
      'Use an https:// base URL to send an API key to example.com, or remove the key.',
    );
  });

  it.each([
    [
      'http://127.audit.invalid/v1',
      'Use an https:// base URL to send an API key to 127.audit.invalid, or remove the key.',
    ],
    ['ftp://localhost/v1', 'The base URL must start with http:// or https://.'],
  ])('refuses to send an API key to %s', async (baseUrl, expected) => {
    const fetchMock = vi.fn(() => {
      throw new Error('fetch should not run');
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const message = await rejection(
      openaiProvider(
        prompt,
        settings({
          openaiBaseUrl: baseUrl,
          openaiApiKey: 'sk-test',
          models: { 'openai-compatible': 'llama3.2' },
        }),
        () => undefined,
        new AbortController().signal,
      ),
    );
    expect(message).toBe(expected);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a base URL that is not valid when an API key is set', async () => {
    globalThis.fetch = vi.fn(() => {
      throw new Error('fetch should not run');
    }) as typeof fetch;
    const message = await rejection(
      openaiProvider(
        prompt,
        settings({
          openaiBaseUrl: 'not a url',
          openaiApiKey: 'sk-test',
          models: { 'openai-compatible': 'llama3.2' },
        }),
        () => undefined,
        new AbortController().signal,
      ),
    );
    expect(message).toBe('The base URL is not valid: not a url');
  });

  it('sends an API key to loopback over http', async () => {
    for (const baseUrl of [
      'http://127.0.0.1:1234/v1',
      'http://127.1:1234/v1',
      'http://[::1]:1234/v1',
      'http://localhost:1234/v1',
      'http://ollama.localhost:11434/v1',
    ]) {
      const fetchMock = vi.fn(async () => streamResponse(['data: [DONE]\n\n']));
      globalThis.fetch = fetchMock as typeof fetch;
      await openaiProvider(
        prompt,
        settings({
          openaiBaseUrl: baseUrl,
          openaiApiKey: 'sk-test',
          models: { 'openai-compatible': 'llama3.2' },
        }),
        () => undefined,
        new AbortController().signal,
      );
      expect(fetchMock).toHaveBeenCalledOnce();
    }
  });

  it('still calls a remote http server when no API key is set', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => streamResponse(['data: [DONE]\n\n']),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    await openaiProvider(
      prompt,
      settings({
        openaiBaseUrl: 'http://192.168.1.5:11434/v1',
        models: { 'openai-compatible': 'llama3.2' },
      }),
      () => undefined,
      new AbortController().signal,
    );
    const call = fetchMock.mock.calls[0];
    if (call === undefined) throw new Error('fetch was not called');
    expect(String(call[0])).toBe('http://192.168.1.5:11434/v1/chat/completions');
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
