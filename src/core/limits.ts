export const MAX_INPUT_BYTES = 256 * 1024;
// Total raw generated text, before output cleanup, counted in UTF-8 bytes.
export const MAX_OUTPUT_BYTES = 1024 * 1024;
export const OUTPUT_LIMIT_MESSAGE =
  'The generated text is over the 1 MiB output limit. Try again with a shorter text.';

// Decoded UTF-8 bytes per SSE line, excluding LF and one final CR, including at EOF.
export const MAX_SSE_LINE_BYTES = 1024 * 1024;
// Retained event-name and data bytes, including newlines between data fields.
// Replacing the event name replaces its byte contribution. Ignored fields do not accumulate.
// These limits do not bound network transfer or exact JavaScript heap usage.
export const MAX_SSE_EVENT_BYTES = 1024 * 1024;

// UTF-8 bytes retained and decoded from a non-OK HTTP response body.
// A chunk the transport has already delivered may be larger. This does not cap
// bytes on the wire or the JavaScript heap.
export const MAX_HTTP_ERROR_BODY_BYTES = 8 * 1024;
// Unicode code points shown from that decoded prefix.
export const MAX_HTTP_ERROR_CODE_POINTS = 300;

export const INPUT_LIMIT_MESSAGE =
  'This text is over the 256 KiB limit, so it was not sent. Shorten it and try again.';

const utf8 = new TextEncoder();

// A UTF-16 unit is at least one UTF-8 byte, so a longer string cannot fit.
export function exceedsInputLimit(text: string): boolean {
  if (text.length > MAX_INPUT_BYTES) return true;
  return utf8.encode(text).byteLength > MAX_INPUT_BYTES;
}

export function exceedsConversationLimit(messages: readonly { content: string }[]): boolean {
  let total = 0;
  for (const message of messages) {
    const text = message.content;
    if (text.length > MAX_INPUT_BYTES) return true;
    total += utf8.encode(text).byteLength;
    if (total > MAX_INPUT_BYTES) return true;
  }
  return false;
}

// Fix uses this two-message shape and checks its raw text limit before wrapping.
export function exceedsMultiTurnInput(
  messages: readonly { role: string; content: string }[],
): boolean {
  const first = messages[0];
  const second = messages[1];
  if (messages.length === 2 && first?.role === 'system' && second?.role === 'user') return false;
  return exceedsConversationLimit(messages);
}
