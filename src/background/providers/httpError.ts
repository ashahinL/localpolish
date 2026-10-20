import { MAX_HTTP_ERROR_BODY_BYTES, MAX_HTTP_ERROR_CODE_POINTS } from '../../core/limits';

function limitCodePoints(text: string, maxCodePoints: number): string {
  if (text.length <= maxCodePoints) return text;
  let seen = 0;
  let end = 0;
  for (const character of text) {
    if (seen === maxCodePoints) return text.slice(0, end);
    end += character.length;
    seen += 1;
  }
  return text;
}

export async function readErrorDetail(response: Response): Promise<string> {
  if (response.body === null) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let retained = 0;
  let detail = '';
  let reachedBudget = false;

  try {
    while (retained < MAX_HTTP_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) {
        detail += decoder.decode();
        break;
      }
      const room = MAX_HTTP_ERROR_BODY_BYTES - retained;
      const prefix = value.byteLength > room ? value.subarray(0, room) : value;
      detail += decoder.decode(prefix, { stream: true });
      retained += prefix.byteLength;
      if (retained >= MAX_HTTP_ERROR_BODY_BYTES) {
        detail += decoder.decode();
        reachedBudget = true;
        break;
      }
    }
  } finally {
    if (reachedBudget) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  return limitCodePoints(detail, MAX_HTTP_ERROR_CODE_POINTS);
}
