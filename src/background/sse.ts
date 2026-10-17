export interface SseEvent {
  event?: string;
  data: string;
}

export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] | undefined;
  let eventName: string | undefined;

  const pullEvent = (): SseEvent | undefined => {
    if (dataLines === undefined) {
      eventName = undefined;
      return undefined;
    }
    const data = dataLines.join('\n');
    const event = eventName === undefined ? { data } : { event: eventName, data };
    dataLines = undefined;
    eventName = undefined;
    return event;
  };

  const consumeLine = (line: string): SseEvent | undefined => {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (normalized === '') return pullEvent();
    if (normalized.startsWith(':')) return undefined;

    const colon = normalized.indexOf(':');
    const field = colon === -1 ? normalized : normalized.slice(0, colon);
    let value = colon === -1 ? '' : normalized.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'data') {
      (dataLines ??= []).push(value);
      return undefined;
    }
    if (field === 'event') eventName = value;
    return undefined;
  };

  const drain = function* (final: boolean): Generator<SseEvent> {
    while (buffer.length > 0) {
      // LF only: a trailing CR stays buffered until the next chunk completes CRLF.
      const newlineAt = buffer.indexOf('\n');
      if (newlineAt === -1) break;
      const line = buffer.slice(0, newlineAt);
      buffer = buffer.slice(newlineAt + 1);
      const event = consumeLine(line);
      if (event !== undefined) yield event;
    }
    if (!final) return;
    if (buffer !== '') {
      const line = buffer;
      buffer = '';
      const event = consumeLine(line);
      if (event !== undefined) yield event;
    }
    const pending = pullEvent();
    if (pending !== undefined) yield pending;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        yield* drain(true);
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      yield* drain(false);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
