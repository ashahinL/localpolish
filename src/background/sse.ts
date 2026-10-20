import { MAX_SSE_EVENT_BYTES, MAX_SSE_LINE_BYTES } from '../core/limits';

export interface SseEvent {
  event?: string;
  data: string;
}

export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let completed = false;
  let linePieces: string[] = [];
  let lineBytes = 0;
  let dataLines: string[] | undefined;
  let eventName: string | undefined;
  let eventNameBytes = 0;
  let eventBytes = 0;

  const pullEvent = (): SseEvent | undefined => {
    eventBytes = 0;
    eventNameBytes = 0;
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

  const consumeLine = (line: string, bytes: number): SseEvent | undefined => {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (normalized === '') return pullEvent();
    if (normalized.startsWith(':')) return undefined;

    const colon = normalized.indexOf(':');
    const field = colon === -1 ? normalized : normalized.slice(0, colon);
    let value = colon === -1 ? '' : normalized.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'data') {
      const valueBytes = bytes - (normalized.length - value.length);
      const nextBytes = eventBytes + valueBytes + (dataLines === undefined ? 0 : 1);
      if (nextBytes > MAX_SSE_EVENT_BYTES) throw new Error('SSE event exceeds the 1 MiB limit.');
      eventBytes = nextBytes;
      (dataLines ??= []).push(value);
      return undefined;
    }
    if (field === 'event') {
      const valueBytes = bytes - (normalized.length - value.length);
      const nextBytes = eventBytes - eventNameBytes + valueBytes;
      if (nextBytes > MAX_SSE_EVENT_BYTES) throw new Error('SSE event exceeds the 1 MiB limit.');
      eventBytes = nextBytes;
      eventNameBytes = valueBytes;
      eventName = value;
    }
    return undefined;
  };

  const append = (piece: string) => {
    if (piece === '') return;
    const bytes = lineBytes + encoder.encode(piece).byteLength;
    // Only the last CR may be excluded. A later character makes it part of the line.
    if (bytes - (piece.endsWith('\r') ? 1 : 0) > MAX_SSE_LINE_BYTES) {
      throw new Error('SSE line exceeds the 1 MiB limit.');
    }
    lineBytes = bytes;
    linePieces.push(piece);
  };

  const finishLine = (): SseEvent | undefined => {
    const line = linePieces.join('');
    const bytes = lineBytes - (line.endsWith('\r') ? 1 : 0);
    linePieces = [];
    lineBytes = 0;
    return consumeLine(line, bytes);
  };

  const drain = function* (fragment: string): Generator<SseEvent> {
    let start = 0;
    while (start < fragment.length) {
      const newlineAt = fragment.indexOf('\n', start);
      if (newlineAt === -1) {
        append(fragment.slice(start));
        return;
      }
      append(fragment.slice(start, newlineAt));
      start = newlineAt + 1;
      const event = finishLine();
      if (event !== undefined) yield event;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        yield* drain(decoder.decode());
        if (linePieces.length > 0) {
          const event = finishLine();
          if (event !== undefined) yield event;
        }
        const pending = pullEvent();
        if (pending !== undefined) yield pending;
        return;
      }
      yield* drain(decoder.decode(value, { stream: true }));
    }
  } finally {
    try {
      if (!completed) await reader.cancel().catch(() => undefined);
    } finally {
      reader.releaseLock();
    }
  }
}
