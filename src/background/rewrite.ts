import { cleanOutput } from '../core/cleanup';
import { type RewriteEvent, type RewriteRequest, type TestResult } from '../core/messages';
import { buildPrompt } from '../core/prompts';
import { type Settings } from '../core/settings';
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
  const prompt = buildPrompt(req.mode, req.tone, req.text);
  let raw = '';
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
        raw += text;
        post({ type: 'chunk', text });
      },
      inner.signal,
    );
  } catch (err) {
    if (timedOut) {
      post({ type: 'error', message: 'Timed out after 60 seconds.' });
      return;
    }
    if (signal.aborted) return;
    const message = err instanceof Error ? err.message : 'The rewrite failed.';
    post({ type: 'error', message });
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

  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve('timeout');
    }, TEST_TIMEOUT_MS);
  });

  try {
    const outcome = await Promise.race([
      runRewrite(
        TEST_REQUEST,
        settings,
        stream,
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
