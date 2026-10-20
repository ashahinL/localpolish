import { describe, expect, it, vi } from 'vitest';
import { readSSE, type SseEvent } from './sse';

function stream(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks)
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  });
  return body;
}

async function collectBody(body: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of readSSE(body)) events.push(event);
  return events;
}

async function collect(chunks: (string | Uint8Array)[]): Promise<SseEvent[]> {
  return collectBody(stream(chunks));
}

const cap = 1024 * 1024;
const alphabets = [
  ['ASCII', 'a', 1],
  ['Arabic', 'أ', 2],
  ['emoji', '🌍', 4],
] as const;

function sized(character: string, bytes: number, size: number): string {
  return character.repeat(Math.floor(size / bytes)) + 'x'.repeat(size % bytes);
}

describe('readSSE', () => {
  it('joins an event split across three chunks', async () => {
    const events = await collect(['eve', 'nt: update\nda', 'ta: hello\n\n']);
    expect(events).toEqual([{ event: 'update', data: 'hello' }]);
  });

  it('accepts CRLF line endings', async () => {
    const events = await collect(['event: ping\r\ndata: pong\r', '\n\r\n']);
    expect(events).toEqual([{ event: 'ping', data: 'pong' }]);
  });

  it('joins data lines and strips one leading space', async () => {
    const events = await collect(['data: one\ndata:  two\n\n']);
    expect(events).toEqual([{ data: 'one\n two' }]);
  });

  it('skips comment lines and events that have no data', async () => {
    const events = await collect([': keep-alive\n', 'data: visible\n\n', ': hidden\n\n']);
    expect(events).toEqual([{ data: 'visible' }]);
  });

  it('captures the event field', async () => {
    const events = await collect(['event: ping\n\n', 'event: delta\ndata: hi\n\n']);
    expect(events).toEqual([{ event: 'delta', data: 'hi' }]);
  });

  describe.each(alphabets)('%s byte boundaries', (_name, character, bytes) => {
    it.each([0, 1])('bounds a line at cap + %i bytes', async (extra) => {
      const value = sized(character, bytes, cap - 6 + extra);
      const pending = collect(['data: ', value, '\n\n']);
      if (extra === 0) await expect(pending).resolves.toEqual([{ data: value }]);
      else await expect(pending).rejects.toThrow('SSE line exceeds the 1 MiB limit.');
    });

    it.each(['', 'أ🌍'])('bounds multiline event bytes with name %j', async (name) => {
      const nameBytes = name === '' ? 0 : 6;
      const first = sized(character, bytes, cap / 2);
      const last = sized(character, bytes, cap / 2 - 1 - nameBytes);
      for (const extra of ['', 'x']) {
        const pending = collect([`event: ${name}\ndata: ${first}\ndata: ${last}${extra}\n\n`]);
        if (extra === '') {
          await expect(pending).resolves.toEqual([{ event: name, data: first + '\n' + last }]);
        } else await expect(pending).rejects.toThrow('SSE event exceeds the 1 MiB limit.');
      }
    });
  });

  it.each(['\n\n', ''])('accepts a cap line with split CRLF or EOF %j', async (ending) => {
    const value = 'x'.repeat(cap - 6);
    await expect(collect(['data: ' + value, '\r', '', ending])).resolves.toEqual([{ data: value }]);
  });

  it('counts an internal CR when the next fragment is not LF', async () => {
    await expect(collect(['data: ' + 'x'.repeat(cap - 6), '\r', 'x'])).rejects.toThrow(
      'SSE line exceeds the 1 MiB limit.',
    );
  });

  it.each([':', 'unknown: '])('bounds ignored lines starting with %j', async (prefix) => {
    await expect(
      collect([prefix + 'x'.repeat(cap - prefix.length), '\n', 'data: ok\n\n']),
    ).resolves.toEqual([{ data: 'ok' }]);
    await expect(collect([prefix + 'x'.repeat(cap - prefix.length + 1)])).rejects.toThrow(
      'SSE line exceeds the 1 MiB limit.',
    );
  });

  it('does not accumulate comments or unknown fields across bounded lines', async () => {
    await expect(
      collect([
        ':' + 'x'.repeat(cap - 1) + '\n',
        'ignored: ' + 'x'.repeat(cap - 9) + '\n',
        'data: visible\n\n',
      ]),
    ).resolves.toEqual([{ data: 'visible' }]);
  });

  it('replaces event-name bytes and resets the event budget after dispatch', async () => {
    const value = 'x'.repeat(cap / 2 - 1);
    await expect(
      collect([
        `event: ${'a'.repeat(cap / 2)}\nevent: أ\ndata: ${value}\ndata: ${value.slice(1)}\n\n`,
        'data: next\n\n',
      ]),
    ).resolves.toEqual([{ event: 'أ', data: value + '\n' + value.slice(1) }, { data: 'next' }]);
  });

  it('rejects an event-name replacement that overflows retained data', async () => {
    const value = 'x'.repeat(cap / 2 - 1);
    await expect(collect([`data: ${value}\ndata: ${value}\nevent: أ\n`])).rejects.toThrow(
      'SSE event exceeds the 1 MiB limit.',
    );
  });

  it('preserves colonless fields, case, value spaces, bare CR and final events', async () => {
    await expect(
      collect(['event: ignored\n\nData: hidden\ndata\ndata:  two\ndata: a\rb\n', 'event: final\r']),
    ).resolves.toEqual([{ event: 'final', data: '\n two\na\rb' }]);
  });

  it('decodes split BOM, Arabic and emoji, empty fragments and an incomplete EOF sequence', async () => {
    const encoded = new TextEncoder().encode('\uFEFFdata: أ🌍\uFEFF');
    const chunks = Array.from(encoded, (byte) => new Uint8Array([byte]));
    chunks.splice(5, 0, new Uint8Array());
    chunks.push(new Uint8Array([0xf0, 0x9f]));
    await expect(collect(chunks)).resolves.toEqual([{ data: 'أ🌍\uFEFF�' }]);
  });

  it('releases the reader after completion', async () => {
    const body = stream(['data: final']);
    await expect(collectBody(body)).resolves.toEqual([{ data: 'final' }]);
    expect(body.locked).toBe(false);
  });

  it('cancels an endless no-newline stream after overflow and releases the reader', async () => {
    const cancel = vi.fn();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++;
          controller.enqueue(new TextEncoder().encode('x'.repeat(64 * 1024)));
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    await expect(collectBody(body)).rejects.toThrow('SSE line exceeds the 1 MiB limit.');
    expect(pulls).toBe(17);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it.each([false, true])(
    'cancels and releases on consumer break, cancel rejects = %s',
    async (rejects) => {
      const cancel = vi.fn(() =>
        rejects ? Promise.reject(new Error('cancel failed')) : undefined,
      );
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: first\n\ndata: unread'));
        },
        cancel,
      });
      const events = [];
      for await (const event of readSSE(body)) {
        events.push(event);
        break;
      }
      expect(events).toEqual([{ data: 'first' }]);
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
    },
  );

  it('preserves overflow when cancellation rejects and releases the reader', async () => {
    const cancel = vi.fn(async () => {
      throw new Error('cancel failed');
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(cap + 1)));
      },
      cancel,
    });
    await expect(collectBody(body)).rejects.toThrow('SSE line exceeds the 1 MiB limit.');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('cancels event overflow and releases the reader', async () => {
    const cancel = vi.fn();
    const value = 'x'.repeat(cap / 2);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${value}\ndata: ${value}\n`));
      },
      cancel,
    });
    await expect(collectBody(body)).rejects.toThrow('SSE event exceeds the 1 MiB limit.');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('releases an errored fetch body and preserves AbortError', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new DOMException('Request aborted', 'AbortError'));
      },
    });
    await expect(collectBody(body)).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Request aborted',
    });
    expect(body.locked).toBe(false);
  });
});
