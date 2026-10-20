import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../core/settings';
import { anthropicProvider } from './anthropic';
import { type PromptPair } from './types';

const prompt: PromptPair = { system: 'SYSTEM', user: 'USER' };
const originalFetch = globalThis.fetch;

function settings(
  patch: Partial<Omit<Settings, 'models'>> & { models?: Partial<Settings['models']> } = {},
): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...patch,
    models: { ...DEFAULT_SETTINGS.models, ...patch.models },
  };
}

function streamResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body);
}

function uneven(text: string): string[] {
  return [text.slice(0, 20), text.slice(20, 45), text.slice(45)];
}

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

describe('anthropicProvider', () => {
  it('rejects oversized streamed SSE and cancels the response body', async () => {
    const cancel = vi.fn();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(
            new TextEncoder().encode(pulls++ === 0 ? 'data: ' : 'x'.repeat(64 * 1024)),
          );
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const fetchMock = vi.fn(async () => new Response(body));
    globalThis.fetch = fetchMock as typeof fetch;
    const onText = vi.fn();
    await expect(
      anthropicProvider(
        prompt,
        settings({ anthropicApiKey: 'sk-ant' }),
        onText,
        new AbortController().signal,
      ),
    ).rejects.toThrow('SSE line exceeds the 1 MiB limit.');
    expect(onText).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('streams text deltas and sends the Anthropic request', async () => {
    const sse = [
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"I "}}\n\n',
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"went."}}\n\n',
      'event: message_stop\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => streamResponse(uneven(sse)),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    const parts: string[] = [];
    const signal = new AbortController().signal;

    await anthropicProvider(
      prompt,
      settings({ anthropicApiKey: 'sk-ant', temperature: 0.2 }),
      (text) => parts.push(text),
      signal,
    );

    expect(parts).toEqual(['I ', 'went.']);
    const call = fetchMock.mock.calls[0];
    if (call === undefined) throw new Error('fetch was not called');
    expect(String(call[0])).toBe('https://api.anthropic.com/v1/messages');
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.signal).toBe(signal);
    expect(call[1]?.headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': 'sk-ant',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 4096,
      temperature: 0.2,
      system: 'SYSTEM',
      stream: true,
      messages: [{ role: 'user', content: 'USER' }],
    });
  });

  it('rejects with the message from an error event', async () => {
    const sse =
      'event: error\ndata: {"type":"error","error":{"type":"api_error","message":"Overloaded"}}\n\n';
    globalThis.fetch = vi.fn(async () => streamResponse(uneven(sse))) as typeof fetch;
    const message = await rejection(
      anthropicProvider(
        prompt,
        settings({ anthropicApiKey: 'sk-ant' }),
        () => undefined,
        new AbortController().signal,
      ),
    );
    expect(message).toBe('Overloaded');
  });

  it('rejects a stream cut off at max_tokens', async () => {
    const sse = [
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"I "}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n',
    ].join('');
    globalThis.fetch = vi.fn(async () => streamResponse(uneven(sse))) as typeof fetch;
    const message = await rejection(
      anthropicProvider(
        prompt,
        settings({ anthropicApiKey: 'sk-ant' }),
        () => undefined,
        new AbortController().signal,
      ),
    );
    expect(message).toBe('The answer was cut off. Try a shorter text.');
  });

  it('rejects a stream that ends without message_stop', async () => {
    const sse =
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"I "}}\n\n';
    globalThis.fetch = vi.fn(async () => streamResponse(uneven(sse))) as typeof fetch;
    const message = await rejection(
      anthropicProvider(
        prompt,
        settings({ anthropicApiKey: 'sk-ant' }),
        () => undefined,
        new AbortController().signal,
      ),
    );
    expect(message).toBe('The answer was cut off. Try again.');
  });

  it('accepts a stop reason other than max_tokens when message_stop follows', async () => {
    const sse = [
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"I went."}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');
    globalThis.fetch = vi.fn(async () => streamResponse(uneven(sse))) as typeof fetch;
    const parts: string[] = [];
    await anthropicProvider(
      prompt,
      settings({ anthropicApiKey: 'sk-ant' }),
      (text) => parts.push(text),
      new AbortController().signal,
    );
    expect(parts).toEqual(['I went.']);
  });

  it('asks for an API key when the setting is empty', async () => {
    globalThis.fetch = vi.fn(() => {
      throw new Error('fetch should not run');
    }) as typeof fetch;
    const message = await rejection(
      anthropicProvider(prompt, settings(), () => undefined, new AbortController().signal),
    );
    expect(message).toBe('Add your Anthropic API key in LocalPolish settings.');
  });
});
