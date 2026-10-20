import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../core/settings';
import { type RewriteEvent, type RewriteRequest } from '../core/messages';
import { recordUsage } from '../core/usage';
import { BridgeMissingError, cliProvider } from './providers/cli';
import { openaiProvider } from './providers/openai';
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
  const outputLimitMessage =
    'The generated text is over the 1 MiB output limit. Try again with a shorter text.';

  it.each([undefined, 'idle'] as const)(
    'keeps the final answer but only previews manual requests (trigger=%s)',
    async (trigger) => {
      const events: RewriteEvent[] = [];
      await runRewrite(
        { ...request, trigger },
        settings(),
        async (_prompt, _settings, onText) => {
          for (let i = 0; i < 1000; i++) onText('x');
        },
        (event) => events.push(event),
        new AbortController().signal,
      );
      expect(events.filter((event) => event.type === 'chunk')).toHaveLength(
        trigger === 'idle' ? 0 : 1000,
      );
      expect(events.filter((event) => event.type !== 'chunk')).toEqual([
        { type: 'done', text: 'x'.repeat(1000) },
      ]);
      expect(recordUsage).toHaveBeenCalledExactlyOnceWith(settings());
    },
  );

  it('cancels and releases a held HTTP reader when bounded events exceed total output', async () => {
    const originalFetch = globalThis.fetch;
    const cancel = vi.fn();
    let sent = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const text = sent++ < 256 ? 'a'.repeat(4096) : 'a';
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
            ),
          );
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(body));
    globalThis.fetch = fetchMock;
    const events: RewriteEvent[] = [];
    const saved = settings({ models: { 'openai-compatible': 'mock-model' } });
    try {
      await runRewrite(
        request,
        saved,
        openaiProvider,
        (event) => events.push(event),
        new AbortController().signal,
      );
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
      expect(sent).toBe(257);
      expect(events.filter((event) => event.type !== 'chunk')).toEqual([
        { type: 'error', message: outputLimitMessage },
      ]);
      expect(
        events
          .filter((event) => event.type === 'chunk')
          .map((event) => event.text)
          .join(''),
      ).toBe('a'.repeat(1048576));
      expect(recordUsage).toHaveBeenCalledExactlyOnceWith(saved);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each(['cancel', 'timeout'])(
    'preserves %s priority when it overlaps output overflow',
    async (priority) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const events: RewriteEvent[] = [];
      try {
        await runRewrite(
          request,
          settings(),
          async (_prompt, _settings, onText) => {
            if (priority === 'cancel') controller.abort();
            else await vi.advanceTimersByTimeAsync(60000);
            onText('a'.repeat(1048577));
          },
          (event) => events.push(event),
          controller.signal,
        );
        expect(events).toEqual(
          priority === 'cancel' ? [] : [{ type: 'error', message: 'Timed out after 60 seconds.' }],
        );
        expect(recordUsage).toHaveBeenCalledExactlyOnceWith(settings());
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each([
    { script: 'ASCII', unit: 'a', unitBytes: 1, extra: 0 },
    { script: 'ASCII', unit: 'a', unitBytes: 1, extra: 1 },
    { script: 'Arabic', unit: 'م', unitBytes: 2, extra: 0 },
    { script: 'Arabic', unit: 'م', unitBytes: 2, extra: 1 },
    { script: 'emoji', unit: '😀', unitBytes: 4, extra: 0 },
    { script: 'emoji', unit: '😀', unitBytes: 4, extra: 1 },
  ])('bounds many $script chunks at 1048576 + $extra bytes', async ({ unit, unitBytes, extra }) => {
    const block = unit.repeat(1024 / unitBytes);
    const chunks = [...Array<string>(1024).fill(block), ...(extra ? ['a'] : [])];
    const events: RewriteEvent[] = [];
    let upstream!: AbortSignal;
    await runRewrite(
      request,
      settings(),
      async (_prompt, _settings, onText, signal) => {
        upstream = signal;
        for (const chunk of chunks) onText(chunk);
      },
      (event) => events.push(event),
      new AbortController().signal,
    );

    expect(recordUsage).toHaveBeenCalledExactlyOnceWith(settings());
    expect(events.filter((event) => event.type === 'chunk')).toEqual(
      Array.from({ length: 1024 }, () => ({ type: 'chunk', text: block })),
    );
    expect(events.filter((event) => event.type !== 'chunk')).toEqual(
      extra
        ? [{ type: 'error', message: outputLimitMessage }]
        : [{ type: 'done', text: unit.repeat(1048576 / unitBytes) }],
    );
    expect(upstream.aborted).toBe(extra === 1);
  });

  it.each([
    { extra: 0, empty: false },
    { extra: 1, empty: false },
    { extra: 0, empty: true },
    { extra: 1, empty: true },
  ])('counts split surrogate pairs with extra=$extra, empty=$empty', async ({ extra, empty }) => {
    const prefix = 'a'.repeat(1048572 + extra);
    const chunks = [prefix, '\ud83d', ...(empty ? ['', ''] : []), '\ude00'];
    const events: RewriteEvent[] = [];
    let upstream!: AbortSignal;
    await runRewrite(
      request,
      settings(),
      async (_prompt, _settings, onText, signal) => {
        upstream = signal;
        for (const chunk of chunks) onText(chunk);
      },
      (event) => events.push(event),
      new AbortController().signal,
    );
    expect(events.filter((event) => event.type === 'chunk')).toEqual(
      (extra ? chunks.slice(0, -1) : chunks).map((text) => ({ type: 'chunk', text })),
    );
    expect(events.filter((event) => event.type !== 'chunk')).toEqual(
      extra
        ? [{ type: 'error', message: outputLimitMessage }]
        : [{ type: 'done', text: prefix + '😀' }],
    );
    expect(upstream.aborted).toBe(extra === 1);
    expect(recordUsage).toHaveBeenCalledExactlyOnceWith(settings());
  });

  it.each(['rejects Cancelled', 'resolves'])(
    'reports one raw-output error even when the aborted provider %s',
    async (outcome) => {
      const events: RewriteEvent[] = [];
      let upstream!: AbortSignal;
      await runRewrite(
        request,
        settings(),
        async (_prompt, _settings, onText, signal) => {
          upstream = signal;
          try {
            onText(' '.repeat(1048577));
          } catch {
            if (outcome === 'rejects Cancelled') throw new Error('Cancelled.');
          }
        },
        (event) => events.push(event),
        new AbortController().signal,
      );
      expect(events).toEqual([{ type: 'error', message: outputLimitMessage }]);
      expect(upstream.aborted).toBe(true);
      expect(recordUsage).toHaveBeenCalledExactlyOnceWith(settings());
    },
  );

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
  it('rejects a preaborted owner before accepting an attempt', async () => {
    const owner = new AbortController();
    owner.abort();
    const stream = vi.fn<StreamFn>();
    expect(await testConnection(settings(), stream, owner.signal)).toEqual({
      ok: false,
      message: 'Cancelled.',
    });
    expect(recordUsage).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it('cancels promptly during usage saving and never starts the provider afterward', async () => {
    vi.useFakeTimers();
    try {
      let save!: () => void;
      vi.mocked(recordUsage).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            save = resolve;
          }),
      );
      const owner = new AbortController();
      const stream = vi.fn<StreamFn>();
      const pending = testConnection(settings(), stream, owner.signal);
      owner.abort();
      expect(await pending).toEqual({ ok: false, message: 'Cancelled.' });
      expect(recordUsage).toHaveBeenCalledExactlyOnceWith(settings());
      expect(stream).not.toHaveBeenCalled();
      save();
      await vi.advanceTimersByTimeAsync(90_000);
      expect(stream).not.toHaveBeenCalled();
      expect(recordUsage).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears both timers when an active provider ignores owner cancellation', async () => {
    vi.useFakeTimers();
    try {
      let start!: () => void;
      const started = new Promise<void>((resolve) => {
        start = resolve;
      });
      let providerSignal!: AbortSignal;
      const owner = new AbortController();
      const pending = testConnection(
        settings(),
        (_prompt, _settings, _onText, signal) => {
          providerSignal = signal;
          start();
          return new Promise(() => {});
        },
        owner.signal,
      );
      await started;
      expect(vi.getTimerCount()).toBe(2);
      owner.abort();
      expect(await pending).toEqual({ ok: false, message: 'Cancelled.' });
      expect(providerSignal.aborted).toBe(true);
      expect(recordUsage).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases a real Response reader when the fetch boundary aborts', async () => {
    const originalFetch = globalThis.fetch;
    let reading!: () => void;
    const started = new Promise<void>((resolve) => {
      reading = resolve;
    });
    let body!: ReadableStream<Uint8Array>;
    let fetchSignal!: AbortSignal;
    globalThis.fetch = vi.fn<typeof fetch>(async (_url, init) => {
      fetchSignal = init!.signal!;
      body = new ReadableStream<Uint8Array>({
        start(controller) {
          fetchSignal.addEventListener(
            'abort',
            () => controller.error(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        },
        pull() {
          reading();
        },
      });
      return new Response(body);
    });
    try {
      const owner = new AbortController();
      const pending = testConnection(
        settings({ models: { 'openai-compatible': 'mock-model' } }),
        openaiProvider,
        owner.signal,
      );
      await started;
      expect(body.locked).toBe(true);
      owner.abort();
      expect(await pending).toEqual({ ok: false, message: 'Cancelled.' });
      expect(fetchSignal.aborted).toBe(true);
      await vi.waitFor(() => expect(body.locked).toBe(false));
      expect(recordUsage).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('disconnects only its active native provider on owner cancellation', async () => {
    const messages: Array<(message: unknown) => void> = [];
    const disconnects: Array<() => void> = [];
    let start!: () => void;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const disconnect = vi.fn(() => disconnects.forEach((cb) => cb()));
    vi.stubGlobal('chrome', {
      runtime: {
        connectNative: () => ({
          postMessage: () => start(),
          disconnect,
          onMessage: { addListener: (cb: (message: unknown) => void) => messages.push(cb) },
          onDisconnect: { addListener: (cb: () => void) => disconnects.push(cb) },
        }),
      },
    });
    try {
      const owner = new AbortController();
      const pending = testConnection(settings(), cliProvider('claude'), owner.signal);
      await started;
      owner.abort();
      expect(await pending).toEqual({ ok: false, message: 'Cancelled.' });
      expect(disconnect).toHaveBeenCalledOnce();
      expect(recordUsage).toHaveBeenCalledOnce();
      messages.forEach((cb) => cb({ type: 'done' }));
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns the cleaned sample and how long it took', async () => {
    const stream: StreamFn = async (prompt, _settings, onText) => {
      expect(prompt.user).toContain('<text>\nthis are a test sentence\n</text>');
      onText('This is a test sentence.');
    };

    const result = await testConnection(settings(), stream, new AbortController().signal);

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
    await expect(testConnection(settings(), stream, new AbortController().signal)).resolves.toEqual(
      {
        ok: false,
        message: 'no key',
      },
    );
    expect(recordUsage).toHaveBeenCalledExactlyOnceWith(settings());
  });

  it('keeps the 45-second timeout result when abort immediately rejects the provider', async () => {
    vi.useFakeTimers();
    try {
      let signal!: AbortSignal;
      const pending = testConnection(
        settings(),
        (_prompt, _settings, _onText, providerSignal) => {
          signal = providerSignal;
          return new Promise((_resolve, reject) => {
            providerSignal.addEventListener(
              'abort',
              () => reject(new Error('Native port disconnected.')),
              { once: true },
            );
          });
        },
        new AbortController().signal,
      );
      await vi.advanceTimersByTimeAsync(44_999);
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ ok: false, message: 'Timed out after 45 seconds.' });
      expect(signal.aborted).toBe(true);
      expect(recordUsage).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails when the provider does not answer within 45 seconds', async () => {
    vi.useFakeTimers();
    try {
      const stream: StreamFn = () => new Promise(() => undefined);
      const pending = testConnection(settings(), stream, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(45_000);
      await expect(pending).resolves.toEqual({
        ok: false,
        message: 'Timed out after 45 seconds.',
      });
      expect(recordUsage).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
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
    const pending = testConnection(settings(), stream, new AbortController().signal);
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

it('settles runRewrite and clears its timer when the provider ignores abort', async () => {
  vi.useFakeTimers();
  try {
    const owner = new AbortController();
    let start!: () => void;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const post = vi.fn();
    const pending = runRewrite(
      request,
      settings(),
      () => {
        start();
        return new Promise(() => {});
      },
      post,
      owner.signal,
    );
    await started;
    owner.abort();
    await pending;
    expect(post).not.toHaveBeenCalled();
    expect(recordUsage).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
