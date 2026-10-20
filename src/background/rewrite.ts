import { cleanOutput } from '../core/cleanup';
import {
  exceedsInputLimit,
  INPUT_LIMIT_MESSAGE,
  MAX_OUTPUT_BYTES,
  OUTPUT_LIMIT_MESSAGE,
} from '../core/limits';
import { type RewriteEvent, type RewriteRequest, type TestResult } from '../core/messages';
import { buildPrompt } from '../core/prompts';
import { type Settings } from '../core/settings';
import { recordUsage } from '../core/usage';
import { BridgeMissingError } from './providers/cli';
import { type StreamFn } from './providers/types';

const TEST_TIMEOUT_MS = 45_000;
export const REWRITE_TIMEOUT_MS = 60_000;
const TEST_REQUEST: RewriteRequest = {
  mode: 'fix',
  tone: 'polite',
  text: 'this are a test sentence',
};

export async function runRewrite(
  req: RewriteRequest,
  settings: Settings,
  stream: StreamFn,
  post: (event: RewriteEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  if (exceedsInputLimit(req.text)) {
    post({ type: 'error', message: INPUT_LIMIT_MESSAGE });
    return;
  }
  // An attempt starts here, even if cancelled while its count is being saved.
  await recordUsage(settings).catch(() => undefined);
  if (signal.aborted) return;

  const prompt = buildPrompt(req.mode, req.tone, req.text);
  let raw = '';
  let outputBytes = 0;
  let endsWithHighSurrogate = false;
  let outputExceeded = false;
  const utf8 = new TextEncoder();
  const inner = new AbortController();
  let timedOut = false;
  const onAbort = () => {
    inner.abort();
  };
  signal.addEventListener('abort', onAbort);
  if (signal.aborted) onAbort();
  const timer = setTimeout(() => {
    timedOut = true;
    inner.abort();
  }, REWRITE_TIMEOUT_MS);

  try {
    await stream(
      prompt,
      settings,
      (text) => {
        if (outputExceeded) throw new Error(OUTPUT_LIMIT_MESSAGE);
        const remainingBytes = MAX_OUTPUT_BYTES - outputBytes;
        const first = text.charCodeAt(0);
        // Separate encodings count a split pair as 3 + 3 bytes instead of 4.
        const correction = endsWithHighSurrogate && first >= 0xdc00 && first <= 0xdfff ? 2 : 0;
        const bytes =
          text.length > remainingBytes ? Infinity : utf8.encode(text).byteLength - correction;
        if (bytes > remainingBytes) {
          outputExceeded = true;
          inner.abort();
          throw new Error(OUTPUT_LIMIT_MESSAGE);
        }
        outputBytes += bytes;
        if (text.length > 0) {
          const last = text.charCodeAt(text.length - 1);
          endsWithHighSurrogate = last >= 0xd800 && last <= 0xdbff;
        }
        raw += text;
        post({ type: 'chunk', text });
      },
      inner.signal,
    );
    if (outputExceeded) throw new Error(OUTPUT_LIMIT_MESSAGE);
  } catch (err) {
    if (timedOut) {
      post({ type: 'error', message: 'Timed out after 60 seconds.' });
      return;
    }
    if (signal.aborted) return;
    if (outputExceeded) {
      post({ type: 'error', message: OUTPUT_LIMIT_MESSAGE });
      return;
    }
    const message = err instanceof Error ? err.message : 'The rewrite failed.';
    post(
      err instanceof BridgeMissingError
        ? { type: 'error', message, code: err.code }
        : { type: 'error', message },
    );
    return;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }

  const cleaned = cleanOutput(raw, req.text);
  if (cleaned.trim() === '') {
    post({ type: 'error', message: 'The model returned an empty answer. Try again.' });
    return;
  }
  post({ type: 'done', text: cleaned });
}

export async function testConnection(settings: Settings, stream: StreamFn): Promise<TestResult> {
  const started = Date.now();
  const controller = new AbortController();
  let sample: string | undefined;
  let failure: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  let onTimeout: () => void;
  const timeout = new Promise<'timeout'>((resolve) => {
    onTimeout = () => {
      controller.abort();
      resolve('timeout');
    };
  });
  const timedStream: StreamFn = (...args) => {
    timer = setTimeout(onTimeout, TEST_TIMEOUT_MS);
    return stream(...args);
  };

  try {
    const outcome = await Promise.race([
      runRewrite(
        TEST_REQUEST,
        settings,
        timedStream,
        (event) => {
          if (event.type === 'done') sample = event.text;
          else if (event.type === 'error') failure = event.message;
        },
        controller.signal,
      ).then(() => 'finished' as const),
      timeout,
    ]);
    if (outcome === 'timeout') {
      return { ok: false, message: 'Timed out after 45 seconds.' };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The rewrite failed.';
    return { ok: false, message };
  } finally {
    clearTimeout(timer);
  }

  if (failure !== undefined) return { ok: false, message: failure };
  if (sample === undefined) {
    return { ok: false, message: 'The model returned an empty answer. Try again.' };
  }
  return { ok: true, sample, ms: Date.now() - started };
}
