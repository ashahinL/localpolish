import { OUTPUT_LIMIT_MESSAGE } from '../core/limits';
import {
  CHAT_TOO_BIG,
  type ChatEvent,
  type ChatRequest,
  type ModelMessage,
} from '../core/messages';
import { buildChatMessages, CHAT_TIMEOUT_MS } from '../core/prompts';
import { type Settings } from '../core/settings';
import { reattributeUsage, recordUsage } from '../core/usage';
import { outputBudget } from './outputBudget';
import { BridgeMissingError } from './providers/cli';
import { type StreamFn } from './providers/types';

const TIMEOUT_MESSAGE = `Timed out after ${CHAT_TIMEOUT_MS / 1000} seconds.`;

/** Fix's settings with the chat's own choices, so streams and Usage follow the chat. */
export function chatSettings(settings: Settings): Settings {
  return {
    ...settings,
    provider: settings.chat.provider,
    models: { ...settings.chat.models },
    efforts: { ...settings.chat.efforts },
  };
}

export async function runChat(
  req: ChatRequest,
  settings: Settings,
  stream: StreamFn,
  post: (event: ChatEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  let messages: readonly ModelMessage[];
  try {
    messages = buildChatMessages(req.turns, req.attachment);
  } catch (err) {
    post({ type: 'error', message: (err as Error).message, code: CHAT_TOO_BIG });
    return;
  }
  // An attempt starts here, even if cancelled while its count is being saved.
  const effective = chatSettings(settings);
  const provider = effective.provider;
  const sourceModel = effective.models[provider];
  let recorded = false;
  await recordUsage(effective).then(
    () => {
      recorded = true;
    },
    () => undefined,
  );
  if (signal.aborted) return;

  let raw = '';
  const fits = outputBudget();
  let outputExceeded = false;
  const inner = new AbortController();
  let timedOut = false;
  let rejectStream: ((err: Error) => void) | undefined;
  let modelOpen = true;
  let acceptedModel = false;
  let transfer: Promise<void> | undefined;
  const onModel = (reported: string) => {
    if (!modelOpen || !recorded || acceptedModel) return;
    if (signal.aborted || inner.signal.aborted) return;
    if (provider !== 'grok-cli' || sourceModel !== '') return;
    const model = reported.trim();
    if (model === '' || model.length > 200) return;
    acceptedModel = true;
    transfer = reattributeUsage(provider, sourceModel, model).catch(() => undefined);
  };
  const onAbort = () => {
    modelOpen = false;
    inner.abort();
    rejectStream?.(new Error('Cancelled.'));
  };
  signal.addEventListener('abort', onAbort);
  if (signal.aborted) onAbort();
  const timer = setTimeout(() => {
    timedOut = true;
    modelOpen = false;
    inner.abort();
    rejectStream?.(new Error(TIMEOUT_MESSAGE));
  }, CHAT_TIMEOUT_MS);

  try {
    await new Promise<void>((resolve, reject) => {
      rejectStream = reject;
      if (inner.signal.aborted) {
        modelOpen = false;
        reject(new Error('Cancelled.'));
        return;
      }
      Promise.resolve(
        stream(
          messages,
          effective,
          (text) => {
            if (inner.signal.aborted) throw new Error('Cancelled.');
            if (outputExceeded) throw new Error(OUTPUT_LIMIT_MESSAGE);
            if (!fits(text)) {
              outputExceeded = true;
              inner.abort();
              throw new Error(OUTPUT_LIMIT_MESSAGE);
            }
            raw += text;
            post({ type: 'chunk', text });
          },
          inner.signal,
          onModel,
          { timeoutMs: CHAT_TIMEOUT_MS },
        ),
      ).then(
        () => {
          modelOpen = false;
          resolve();
        },
        (err: unknown) => {
          modelOpen = false;
          reject(err);
        },
      );
    });
    if (outputExceeded) throw new Error(OUTPUT_LIMIT_MESSAGE);
  } catch (err) {
    if (timedOut) {
      post({ type: 'error', message: TIMEOUT_MESSAGE });
      return;
    }
    if (signal.aborted) return;
    if (outputExceeded) {
      post({ type: 'error', message: OUTPUT_LIMIT_MESSAGE });
      return;
    }
    const message = err instanceof Error ? err.message : 'The chat failed.';
    post(
      err instanceof BridgeMissingError
        ? { type: 'error', message, code: err.code }
        : { type: 'error', message },
    );
    return;
  } finally {
    modelOpen = false;
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    await transfer;
  }

  if (signal.aborted) return;
  if (raw.trim() === '') {
    post({ type: 'error', message: 'The model returned an empty answer. Try again.' });
    return;
  }
  post({ type: 'done', text: raw });
}
