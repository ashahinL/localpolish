import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../core/settings';
import { anthropicProvider } from './anthropic';
import { type PromptPair } from './types';

const prompt: PromptPair = { system: 'SYSTEM', user: 'USER' };
const originalFetch = globalThis.fetch;
const errorByteBudget = 8 * 1024;
const errorCodePoints = 300;

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

function errorResponse(response: Response): Promise<unknown> {
  globalThis.fetch = vi.fn(async () => response) as typeof fetch;
  return anthropicProvider(
    prompt,
    settings({ anthropicApiKey: 'sk-ant' }),
    () => undefined,
    new AbortController().signal,
  );
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

  it('stops an endless 1 KiB error body at 8 KiB and shows 300 code points', async () => {
    let pulls = 0;
    let enqueued = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          const chunk = new Uint8Array(1024).fill(0x61);
          enqueued += chunk.byteLength;
          controller.enqueue(chunk);
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const message = await rejection(errorResponse(new Response(body, { status: 500 })));
    expect(message).toBe(`HTTP 500: ${'a'.repeat(errorCodePoints)}`);
    expect(pulls).toBe(errorByteBudget / 1024);
    expect(enqueued).toBe(errorByteBudget);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('keeps the prefix of one oversized error chunk and cancels the rest', async () => {
    const delivered = 20 * 1024;
    let pulls = 0;
    let enqueued = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          const chunk = new Uint8Array(delivered);
          chunk.fill(0x62, 0, errorByteBudget);
          chunk.fill(0x63, errorByteBudget);
          enqueued += chunk.byteLength;
          controller.enqueue(chunk);
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const message = await rejection(errorResponse(new Response(body, { status: 500 })));
    expect(message).toBe(`HTTP 500: ${'b'.repeat(errorCodePoints)}`);
    expect(message).not.toContain('c');
    expect(pulls).toBe(1);
    expect(enqueued).toBe(delivered);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('reports an empty detail when the error body is missing', async () => {
    const message = await rejection(errorResponse(new Response(null, { status: 502 })));
    expect(message).toBe('HTTP 502: ');
  });

  it('reports an empty detail when the error body closes immediately', async () => {
    let pulls = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.close();
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const message = await rejection(errorResponse(new Response(body, { status: 502 })));
    expect(message).toBe('HTTP 502: ');
    expect(pulls).toBe(1);
    expect(cancel).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });

  it('decodes Arabic and emoji split across bytes and shows 300 code points', async () => {
    const emoji = '😀';
    const head = 'م'.repeat(errorCodePoints - 1);
    const hidden = 'ن'.repeat(40);
    const encoded = new TextEncoder().encode(head + emoji + hidden);
    const bytes = new Uint8Array(errorByteBudget + 64);
    bytes.set(encoded);
    bytes.fill(0x78, encoded.length);
    let offset = 0;
    let pulls = 0;
    let enqueued = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          const chunk = bytes.subarray(offset, offset + 1);
          offset += chunk.byteLength;
          enqueued += chunk.byteLength;
          controller.enqueue(chunk);
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const message = await rejection(errorResponse(new Response(body, { status: 422 })));
    const detail = message.slice('HTTP 422: '.length);
    expect([...detail]).toEqual([...head, emoji]);
    expect(detail.endsWith(emoji)).toBe(true);
    expect(detail).not.toContain('ن');
    expect(detail).not.toContain('x');
    expect(pulls).toBe(errorByteBudget);
    expect(enqueued).toBe(errorByteBudget);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('reassembles split Arabic and flushes a cut UTF-8 tail at the end of the body', async () => {
    const parts = [new Uint8Array([0xd9]), new Uint8Array([0x85]), new Uint8Array([0xf0, 0x9f])];
    let pulls = 0;
    let enqueued = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const next = parts[pulls];
          pulls += 1;
          if (next === undefined) {
            controller.close();
            return;
          }
          enqueued += next.byteLength;
          controller.enqueue(next);
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const message = await rejection(errorResponse(new Response(body, { status: 400 })));
    expect(message).toBe('HTTP 400: م\uFFFD');
    expect(enqueued).toBe(4);
    expect(pulls).toBe(4);
    expect(cancel).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });

  it('shows the status and at most 300 code points from a short error body', async () => {
    let pulls = 0;
    let enqueued = 0;
    const cancel = vi.fn();
    const payload = new TextEncoder().encode('a'.repeat(errorCodePoints + 1));
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          if (pulls === 1) {
            enqueued += payload.byteLength;
            controller.enqueue(payload);
            return;
          }
          controller.close();
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const message = await rejection(errorResponse(new Response(body, { status: 429 })));
    expect(message).toBe(`HTTP 429: ${'a'.repeat(errorCodePoints)}`);
    expect(pulls).toBe(2);
    expect(enqueued).toBe(errorCodePoints + 1);
    expect(cancel).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });

  it.each([
    new Error('read failed'),
    new TypeError('body read failed'),
    new DOMException('Request aborted', 'AbortError'),
  ])('preserves %s from an error body and releases the reader', async (error) => {
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.error(error);
        },
      },
      { highWaterMark: 0 },
    );
    await expect(errorResponse(new Response(body, { status: 500 }))).rejects.toBe(error);
    expect(body.locked).toBe(false);
  });

  it('keeps the HTTP error when cancel rejects and releases the reader', async () => {
    let pulls = 0;
    let enqueued = 0;
    const cancel = vi.fn(async () => {
      throw new Error('cancel failed');
    });
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          const chunk = new Uint8Array(1024).fill(0x61);
          enqueued += chunk.byteLength;
          controller.enqueue(chunk);
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const message = await rejection(errorResponse(new Response(body, { status: 500 })));
    expect(message).toBe(`HTTP 500: ${'a'.repeat(errorCodePoints)}`);
    expect(pulls).toBe(errorByteBudget / 1024);
    expect(enqueued).toBe(errorByteBudget);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });
});
