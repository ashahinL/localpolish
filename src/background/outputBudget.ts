import { MAX_OUTPUT_BYTES } from '../core/limits';

/** Counts streamed UTF-8 bytes. Returns false, without counting, once a chunk would pass the cap. */
export function outputBudget(limit = MAX_OUTPUT_BYTES): (text: string) => boolean {
  const utf8 = new TextEncoder();
  let used = 0;
  let endsWithHighSurrogate = false;
  return (text) => {
    const remaining = limit - used;
    const first = text.charCodeAt(0);
    // Separate encodings count a split pair as 3 + 3 bytes instead of 4.
    const correction = endsWithHighSurrogate && first >= 0xdc00 && first <= 0xdfff ? 2 : 0;
    const bytes = text.length > remaining ? Infinity : utf8.encode(text).byteLength - correction;
    if (bytes > remaining) return false;
    used += bytes;
    if (text.length > 0) {
      const last = text.charCodeAt(text.length - 1);
      endsWithHighSurrogate = last >= 0xd800 && last <= 0xdbff;
    }
    return true;
  };
}
