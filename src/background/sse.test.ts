import { describe, expect, it } from 'vitest';
import { readSSE, type SseEvent } from './sse';

async function collect(chunks: string[]): Promise<SseEvent[]> {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const events: SseEvent[] = [];
  for await (const event of readSSE(body)) events.push(event);
  return events;
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
});
