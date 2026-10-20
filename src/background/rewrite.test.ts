import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../core/settings';
import { type RewriteEvent, type RewriteRequest } from '../core/messages';
import { recordUsage } from '../core/usage';
import { BridgeMissingError } from './providers/cli';
import { REWRITE_TIMEOUT_MS, runRewrite, testConnection } from './rewrite';
import { type StreamFn } from './providers/types';

vi.mock('../core/usage', () => ({ recordUsage: vi.fn() }));
beforeEach(() => vi.mocked(recordUsage).mockReset().mockResolvedValue(undefined));

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

    expect(recordUsage).toHaveBeenCalledExactlyOnceWith(settings());
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

    expect(recordUsage).toHaveBeenCalledExactlyOnceWith(settings());
    expect(events).toEqual([{ type: 'error', message: 'The model is offline.' }]);
  });

  it('marks a missing bridge with its error code', async () => {
    const stream: StreamFn = async () => {
      throw new BridgeMissingError();
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
      { type: 'error', message: new BridgeMissingError().message, code: 'bridge-missing' },
    ]);
  });

  it('posts nothing when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const stream = vi.fn<StreamFn>();
    const events: RewriteEvent[] = [];

    await runRewrite(request, settings(), stream, (event) => events.push(event), controller.signal);

    expect(events).toEqual([]);
    expect(recordUsage).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
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
    let started!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const stream: StreamFn = (_prompt, _settings, _onText, signal) =>
      new Promise((_resolve, reject) => {
        started();
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

    await providerStarted;
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

  it.each([
    { script: 'ASCII', unit: 'a', unitBytes: 1, edge: 'below', bytesFromExact: -1 },
    { script: 'ASCII', unit: 'a', unitBytes: 1, edge: 'exact', bytesFromExact: 0 },
    { script: 'ASCII', unit: 'a', unitBytes: 1, edge: 'above', bytesFromExact: 1 },
    { script: 'Arabic', unit: 'م', unitBytes: 2, edge: 'below', bytesFromExact: -1 },
    { script: 'Arabic', unit: 'م', unitBytes: 2, edge: 'exact', bytesFromExact: 0 },
    { script: 'Arabic', unit: 'م', unitBytes: 2, edge: 'above', bytesFromExact: 1 },
    { script: 'emoji', unit: '😀', unitBytes: 4, edge: 'below', bytesFromExact: -1 },
    { script: 'emoji', unit: '😀', unitBytes: 4, edge: 'exact', bytesFromExact: 0 },
    { script: 'emoji', unit: '😀', unitBytes: 4, edge: 'above', bytesFromExact: 1 },
  ])(
    '$script $edge the 262144-byte limit is sent intact or refused',
    async ({ unit, unitBytes, bytesFromExact }) => {
      const targetBytes = 262144 + bytesFromExact;
      const text =
        unit.repeat(Math.floor(targetBytes / unitBytes)) + 'a'.repeat(targetBytes % unitBytes);
      expect(new TextEncoder().encode(unit).byteLength).toBe(unitBytes);
      expect(new TextEncoder().encode(text).byteLength).toBe(262144 + bytesFromExact);

      let seen = '';
      const stream = vi.fn<StreamFn>(async (prompt, _settings, onText) => {
        seen = prompt.user;
        onText('ok');
      });
      const events: RewriteEvent[] = [];
      await runRewrite(
        { ...request, text },
        settings(),
        stream,
        (event) => events.push(event),
        new AbortController().signal,
      );

      if (bytesFromExact <= 0) {
        expect(seen).toBe(`<text>\n${text}\n</text>`);
        expect(stream).toHaveBeenCalledOnce();
        expect(recordUsage).toHaveBeenCalledExactlyOnceWith(settings());
        expect(events).toEqual([
          { type: 'chunk', text: 'ok' },
          { type: 'done', text: 'ok' },
        ]);
        return;
      }

      expect(events).toEqual([
        {
          type: 'error',
          message:
            'This text is over the 256 KiB limit, so it was not sent. Shorten it and try again.',
        },
      ]);
      expect(stream).not.toHaveBeenCalled();
      expect(recordUsage).not.toHaveBeenCalled();
    },
  );

  it('posts nothing when an oversized request is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const stream = vi.fn<StreamFn>();
    const events: RewriteEvent[] = [];

    await runRewrite(
      { ...request, text: 'a'.repeat(262145) },
      settings(),
      stream,
      (event) => events.push(event),
      controller.signal,
    );

    expect(events).toEqual([]);
    expect(recordUsage).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });
});

describe('testConnection', () => {
  it('returns the cleaned sample and how long it took', async () => {
    const stream: StreamFn = async (prompt, _settings, onText) => {
      expect(prompt.user).toContain('<text>\nthis are a test sentence\n</text>');
      onText('This is a test sentence.');
    };

    const result = await testConnection(settings(), stream);

    expect(recordUsage).toHaveBeenCalledExactlyOnceWith(settings());
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
    expect(recordUsage).toHaveBeenCalledExactlyOnceWith(settings());
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

it('does not start a provider cancelled during the count save or leave a timeout', async () => {
  vi.useFakeTimers();
  try {
    let saved!: () => void;
    vi.mocked(recordUsage).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          saved = resolve;
        }),
    );
    const controller = new AbortController();
    const stream = vi.fn<StreamFn>();
    const post = vi.fn();
    const pending = runRewrite(request, settings(), stream, post, controller.signal);
    controller.abort();
    saved();
    await pending;
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('still rewrites if saving usage fails', async () => {
  vi.mocked(recordUsage).mockRejectedValueOnce(new Error('disk full'));
  const post = vi.fn();
  await runRewrite(
    request,
    settings(),
    async (_prompt, _settings, onText) => {
      onText('I went home.');
    },
    post,
    new AbortController().signal,
  );
  expect(post).toHaveBeenLastCalledWith({ type: 'done', text: 'I went home.' });
});

it('starts the connection timeout only when the provider starts', async () => {
  vi.useFakeTimers();
  try {
    let saved!: () => void;
    vi.mocked(recordUsage).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          saved = resolve;
        }),
    );
    const stream = vi.fn<StreamFn>(() => new Promise(() => undefined));
    const pending = testConnection(settings(), stream);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(stream).not.toHaveBeenCalled();
    saved();
    await vi.advanceTimersByTimeAsync(0);
    expect(stream).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(45_000);
    await expect(pending).resolves.toEqual({ ok: false, message: 'Timed out after 45 seconds.' });
  } finally {
    vi.useRealTimers();
  }
});
