export const MAX_INPUT_BYTES = 256 * 1024;

export const INPUT_LIMIT_MESSAGE =
  'This text is over the 256 KiB limit, so it was not sent. Shorten it and try again.';

const utf8 = new TextEncoder();

// A UTF-16 unit is at least one UTF-8 byte, so a longer string cannot fit.
export function exceedsInputLimit(text: string): boolean {
  if (text.length > MAX_INPUT_BYTES) return true;
  return utf8.encode(text).byteLength > MAX_INPUT_BYTES;
}
