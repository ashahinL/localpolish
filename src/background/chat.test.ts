import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_INPUT_BYTES } from '../core/limits';
import { type ChatEvent, type ChatRequest } from '../core/messages';
import { CHAT_SYSTEM_PROMPT } from '../core/prompts';
import { DEFAULT_SETTINGS, type Settings } from '../core/settings';
import { reattributeUsage, recordUsage } from '../core/usage';
import { chatSettings, runChat } from './chat';
import { BridgeMissingError } from './providers/cli';
import { type StreamFn } from './providers/types';

vi.mock('../core/usage', () => ({ recordUsage: vi.fn(), reattributeUsage: vi.fn() }));
beforeEach(() => {
  vi.mocked(recordUsage).mockReset().mockResolvedValue(undefined);
  vi.mocked(reattributeUsage).mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

const OUTPUT_LIMIT =
  'The generated text is over the 1 MiB output limit. Try again with a shorter text.';

function settings(chat: Partial<Settings['chat']> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    provider: 'claude-cli',
    models: { ...DEFAULT_SETTINGS.models, 'claude-cli': 'haiku' },
    chat: {
      provider: 'openai-compatible',
      models: { ...DEFAULT_SETTINGS.models, 'openai-compatible': 'chat-model' },
      efforts: { ...DEFAULT_SETTINGS.efforts },
      ...chat,
    },
  };
}

const twoTurns: ChatRequest = {
  turns: [
    { role: 'user', content: 'Summarize this.' },
    { role: 'assistant', content: 'It is about cats.' },
    { role: 'user', content: 'Shorter, please.' },
  ],
  attachment: { text: 'Cats sleep a lot.', title: 'Cats', url: 'https://example.test/cats' },
};

async function collect(
  stream: StreamFn,
  request: ChatRequest = twoTurns,
  signal = new AbortController().signal,
  saved = settings(),
): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  await runChat(request, saved, stream, (event) => events.push(event), signal);
  return events;
}

describe('runChat', () => {
  it('streams raw Markdown with the chat model and counts the chat in Usage', async () => {
    const stream = vi.fn<StreamFn>(async (_messages, _settings, onText) => {
      onText('**Cats**');
      onText(' sleep.\n\n```\ncode\n```\n');
    });
    const events = await collect(stream);

    const [messages, used, , , , options] = stream.mock.calls[0]!;
    expect(messages).toEqual([
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          '<attachment>{"text":"Cats sleep a lot.","title":"Cats","url":"https://example.test/cats"}</attachment>\nSummarize this.',
      },
      { role: 'assistant', content: 'It is about cats.' },
      { role: 'user', content: 'Shorter, please.' },
    ]);
    expect(used.provider).toBe('openai-compatible');
    expect(used.models['openai-compatible']).toBe('chat-model');
    expect(options).toEqual({ timeoutMs: 180_000 });
    expect(recordUsage).toHaveBeenCalledExactlyOnceWith(chatSettings(settings()));
    expect(events).toEqual([
      { type: 'chunk', text: '**Cats**' },
      { type: 'chunk', text: ' sleep.\n\n```\ncode\n```\n' },
      { type: 'done', text: '**Cats** sleep.\n\n```\ncode\n```\n' },
    ]);
  });

  it('rejects a conversation over the input limit before Usage or a provider call', async () => {
    const stream = vi.fn<StreamFn>();
    const events = await collect(stream, {
      turns: [
        { role: 'user', content: 'a'.repeat(MAX_INPUT_BYTES / 2) },
        { role: 'assistant', content: 'b'.repeat(MAX_INPUT_BYTES / 2) },
        { role: 'user', content: 'More.' },
      ],
    });
    expect(events).toEqual([
      {
        type: 'error',
        message: 'This chat is over the 256 KiB limit. Start a new chat with the last answer.',
        code: 'chat-too-big',
      },
    ]);
    expect(recordUsage).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it.each([0, 1])(
    'caps output at 1 MiB across a split surrogate pair (extra=%i)',
    async (extra) => {
      const prefix = 'a'.repeat(1048572 + extra);
      let upstream!: AbortSignal;
      const events = await collect(async (_messages, _settings, onText, signal) => {
        upstream = signal;
        for (const chunk of [prefix, '\ud83d', '\ude00']) onText(chunk);
      });
      expect(events.at(-1)).toEqual(
        extra ? { type: 'error', message: OUTPUT_LIMIT } : { type: 'done', text: `${prefix}😀` },
      );
      expect(upstream.aborted).toBe(extra === 1);
    },
  );

  it('times out after 180 seconds even when the provider ignores abort', async () => {
    vi.useFakeTimers();
    let upstream!: AbortSignal;
    const pending = collect((_messages, _settings, onText, signal) => {
      upstream = signal;
      onText('partial');
      return new Promise(() => {});
    });
    await vi.advanceTimersByTimeAsync(179_999);
    expect(upstream.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual([
      { type: 'chunk', text: 'partial' },
      { type: 'error', message: 'Timed out after 180 seconds.' },
    ]);
    expect(upstream.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops quietly on cancel and ignores late provider events', async () => {
    vi.useFakeTimers();
    const owner = new AbortController();
    let late!: (text: string) => void;
    let upstream!: AbortSignal;
    const pending = collect(
      (_messages, _settings, onText, signal) => {
        upstream = signal;
        late = onText;
        onText('first');
        return new Promise(() => {});
      },
      twoTurns,
      owner.signal,
    );
    await vi.advanceTimersByTimeAsync(0);
    owner.abort();
    const events = await pending;
    expect(() => late('after stop')).toThrow('Cancelled.');
    expect(events).toEqual([{ type: 'chunk', text: 'first' }]);
    expect(upstream.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start a provider when cancelled while Usage is saving', async () => {
    const owner = new AbortController();
    vi.mocked(recordUsage).mockImplementation(async () => owner.abort());
    const stream = vi.fn<StreamFn>();
    expect(await collect(stream, twoTurns, owner.signal)).toEqual([]);
    expect(stream).not.toHaveBeenCalled();
  });

  it('marks a missing bridge and reports other failures plainly', async () => {
    const missing = new BridgeMissingError();
    expect(
      await collect(async () => {
        throw missing;
      }),
    ).toEqual([{ type: 'error', message: missing.message, code: 'bridge-missing' }]);
    expect(
      await collect(async () => {
        throw new Error('HTTP 500');
      }),
    ).toEqual([{ type: 'error', message: 'HTTP 500' }]);
    expect(await collect(async (_m, _s, onText) => onText('  \n'))).toEqual([
      { type: 'chunk', text: '  \n' },
      { type: 'error', message: 'The model returned an empty answer. Try again.' },
    ]);
  });

  it("moves Grok's count to its first reported model when the chat model is empty", async () => {
    const grok = settings({
      provider: 'grok-cli',
      models: { ...DEFAULT_SETTINGS.models, 'grok-cli': '' },
    });
    await collect(
      async (_messages, _settings, onText, _signal, onModel) => {
        onModel?.('grok-4.7');
        onModel?.('grok-4.6');
        onText('Hi.');
      },
      twoTurns,
      new AbortController().signal,
      grok,
    );
    expect(recordUsage).toHaveBeenCalledExactlyOnceWith(chatSettings(grok));
    expect(reattributeUsage).toHaveBeenCalledExactlyOnceWith('grok-cli', '', 'grok-4.7');
  });
});
