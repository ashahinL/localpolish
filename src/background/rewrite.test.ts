import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../core/settings';
import { type RewriteEvent, type RewriteRequest } from '../core/messages';
import { REWRITE_TIMEOUT_MS, runRewrite, testConnection } from './rewrite';
import { type StreamFn } from './providers/types';

function settings(
  patch: Partial<Omit<Settings, 'models'>> & { models?: Partial<Settings['models']> } = {},
): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...patch,
    models: { ...DEFAULT_SETTINGS.models, ...patch.models },
  };
}

const request: RewriteRequest = { mode: 'fix', tone: 'polite', text: 'i went home' };

describe('runRewrite', () => {
  it('posts each chunk and then the cleaned text', async () => {
    const stream: StreamFn = async (prompt, _settings, onText) => {
      expect(prompt.user).toContain('<text>\ni went home\n</text>');
      onText('Here is the text:\n');
      onText('I went home.');
    };
    const events: RewriteEvent[] = [];

    await runRewrite(
      request,
      settings(),
      stream,
      (event) => events.push(event),
      new AbortController().signal,
    );

    expect(events).toEqual([
      { type: 'chunk', text: 'Here is the text:\n' },
      { type: 'chunk', text: 'I went home.' },
      { type: 'done', text: 'I went home.' },
    ]);
  });

  it('posts an error when the provider rejects', async () => {
    const stream: StreamFn = async () => {
      throw new Error('The model is offline.');
    };
    const events: RewriteEvent[] = [];

    await runRewrite(
      request,
      settings(),
      stream,
      (event) => events.push(event),
      new AbortController().signal,
    );

    expect(events).toEqual([{ type: 'error', message: 'The model is offline.' }]);
  });

  it('posts nothing when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const stream: StreamFn = async () => {
      throw new Error('socket closed');
    };
    const events: RewriteEvent[] = [];

    await runRewrite(request, settings(), stream, (event) => events.push(event), controller.signal);

    expect(events).toEqual([]);
  });

  it('posts a timeout error when the stream is still running after 60 seconds', async () => {
    vi.useFakeTimers();
    try {
      const stream: StreamFn = (_prompt, _settings, _onText, signal) =>
        new Promise((_resolve, reject) => {
          const fail = () => reject(new Error('aborted'));
          if (signal.aborted) fail();
          else signal.addEventListener('abort', fail, { once: true });
        });
      const events: RewriteEvent[] = [];
      const pending = runRewrite(
        request,
        settings(),
        stream,
        (event) => events.push(event),
        new AbortController().signal,
      );

      await vi.advanceTimersByTimeAsync(REWRITE_TIMEOUT_MS - 1);
      expect(events).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(events).toEqual([{ type: 'error', message: 'Timed out after 60 seconds.' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('posts nothing when the caller aborts while the stream is running', async () => {
    const controller = new AbortController();
    const stream: StreamFn = (_prompt, _settings, _onText, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    const events: RewriteEvent[] = [];
    const pending = runRewrite(
      request,
      settings(),
      stream,
      (event) => events.push(event),
      controller.signal,
    );

    controller.abort();
    await pending;
    expect(events).toEqual([]);
  });

  it('posts an error when the cleaned answer is empty', async () => {
    const stream: StreamFn = async () => undefined;
    const events: RewriteEvent[] = [];

    await runRewrite(
      request,
      settings(),
      stream,
      (event) => events.push(event),
      new AbortController().signal,
    );

    expect(events).toEqual([
      { type: 'error', message: 'The model returned an empty answer. Try again.' },
    ]);
  });
});

describe('testConnection', () => {
  it('returns the cleaned sample and how long it took', async () => {
    const stream: StreamFn = async (prompt, _settings, onText) => {
      expect(prompt.user).toContain('<text>\nthis are a test sentence\n</text>');
      onText('This is a test sentence.');
    };

    const result = await testConnection(settings(), stream);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sample).toBe('This is a test sentence.');
    expect(result.ms).toBeGreaterThanOrEqual(0);
    expect(result.ms).toBeLessThan(45_000);
  });

  it('returns the provider error', async () => {
    const stream: StreamFn = async () => {
      throw new Error('no key');
    };
    await expect(testConnection(settings(), stream)).resolves.toEqual({
      ok: false,
      message: 'no key',
    });
  });

  it('fails when the provider does not answer within 45 seconds', async () => {
    vi.useFakeTimers();
    try {
      const stream: StreamFn = () => new Promise(() => undefined);
      const pending = testConnection(settings(), stream);
      await vi.advanceTimersByTimeAsync(45_000);
      await expect(pending).resolves.toEqual({
        ok: false,
        message: 'Timed out after 45 seconds.',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
