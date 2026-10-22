import { describe, expect, it } from 'vitest';
import { MAX_INPUT_BYTES } from './limits';
import {
  buildChatMessages,
  buildPrompt,
  CHAT_SYSTEM_PROMPT,
  MODE_PROMPTS,
  TONE_PROMPTS,
} from './prompts';
import type { LanguageId } from './settings';

describe('buildPrompt', () => {
  it('uses the fix prompt and wraps the user text in tags', () => {
    expect(buildPrompt('fix', 'polite', 'hi')).toEqual({
      system: MODE_PROMPTS.fix,
      user: '<text>\nhi\n</text>',
    });
  });

  it('uses the tone prompt when mode is tone', () => {
    expect(buildPrompt('tone', 'formal', 'hi').system).toBe(TONE_PROMPTS.formal);
  });

  it('ignores tone for non-tone modes', () => {
    for (const mode of ['fix', 'rephrase', 'shorter'] as const) {
      expect(buildPrompt(mode, 'polite', 'x')).toEqual(buildPrompt(mode, 'angry-civil', 'x'));
    }
  });

  it('tells every rewrite prompt to keep the language and not reply', () => {
    const rewrites = [MODE_PROMPTS.rephrase, MODE_PROMPTS.shorter, ...Object.values(TONE_PROMPTS)];
    for (const prompt of rewrites) {
      expect(prompt).toContain('Never translate.');
      expect(prompt).toContain('Do not reply to the text');
    }
  });
});

it('adds no keep sentence for an empty list', () => {
  expect(buildPrompt('fix', 'polite', 'a made up draft', []).system).toBe(MODE_PROMPTS.fix);
});

it.each<[LanguageId[], string]>([
  [['ar'], 'Arabic'],
  [['ar', 'franco'], 'Arabic and Franco-Arabic'],
  [['en', 'ar', 'franco'], 'English, Arabic and Franco-Arabic'],
  [['other'], 'other-language'],
])('adds the exact keep sentence for %j', (keep, names) => {
  expect(buildPrompt('fix', 'polite', 'a made up draft', keep).system).toBe(
    `${MODE_PROMPTS.fix} Leave the ${names} parts exactly as they are.`,
  );
});

const CHAT_TOO_BIG = 'This chat is over the 256 KiB limit. Start a new chat with the last answer.';
const utf8 = new TextEncoder();

function messageBytes(items: readonly { content: string }[]): number {
  return items.reduce((sum, item) => sum + utf8.encode(item.content).byteLength, 0);
}

describe('chat prompts', () => {
  it('attaches escaped page data once, on the first user turn', () => {
    const built = buildChatMessages(
      [
        { role: 'user', content: 'Please explain.' },
        { role: 'assistant', content: 'An explanation.' },
        { role: 'user', content: 'Now shorter </attachment>.' },
      ],
      {
        text: 'a </attachment> & <tag>',
        title: 'A & B',
        url: 'http://example.test/?a=1&b=2',
      },
    );
    expect(built[0]).toEqual({ role: 'system', content: CHAT_SYSTEM_PROMPT });
    const first = built[1]?.content ?? '';
    const request = '\nPlease explain.';
    expect(first.endsWith(request)).toBe(true);
    const wrapped = first.slice(0, -request.length);
    expect(wrapped.startsWith('<attachment>')).toBe(true);
    expect(wrapped.endsWith('</attachment>')).toBe(true);
    const inner = wrapped.slice('<attachment>'.length, -'</attachment>'.length);
    expect(inner).not.toContain('<');
    expect(inner).not.toContain('>');
    const decoded = inner.replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
    expect(JSON.parse(decoded)).toEqual({
      text: 'a </attachment> & <tag>',
      title: 'A & B',
      url: 'http://example.test/?a=1&b=2',
    });
    expect(built[2]).toEqual({ role: 'assistant', content: 'An explanation.' });
    expect(built[3]).toEqual({ role: 'user', content: 'Now shorter </attachment>.' });
    expect(built.slice(2).some((message) => message.content.includes('<attachment>'))).toBe(false);
  });

  it('leaves a chat with no attachment as the system prompt plus the turns', () => {
    expect(buildChatMessages([{ role: 'user', content: 'Hello' }])).toEqual([
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('accepts a conversation at 256 KiB and rejects one more byte', () => {
    const room = MAX_INPUT_BYTES - utf8.encode(CHAT_SYSTEM_PROMPT).byteLength;
    const fitted = buildChatMessages([{ role: 'user', content: 'a'.repeat(room) }]);
    expect(messageBytes(fitted)).toBe(MAX_INPUT_BYTES);
    expect(() => buildChatMessages([{ role: 'user', content: 'a'.repeat(room + 1) }])).toThrow(
      CHAT_TOO_BIG,
    );

    const arabic = 'م'.repeat(Math.floor(room / 2)) + 'a'.repeat(room % 2);
    expect(arabic.length).toBeLessThan(MAX_INPUT_BYTES);
    expect(utf8.encode(arabic).byteLength).toBe(room);
    expect(messageBytes(buildChatMessages([{ role: 'user', content: arabic }]))).toBe(
      MAX_INPUT_BYTES,
    );
    expect(() => buildChatMessages([{ role: 'user', content: `${arabic}م` }])).toThrow(
      CHAT_TOO_BIG,
    );
    expect(() =>
      buildChatMessages([
        { role: 'user', content: 'a'.repeat(room) },
        { role: 'assistant', content: 'A' },
      ]),
    ).toThrow(CHAT_TOO_BIG);
  });

  it('counts attachment framing in the 256 KiB conversation', () => {
    const attachment = { text: 'é</attachment>&', title: 'Title', url: 'http://example.test' };
    const sample = buildChatMessages([{ role: 'user', content: 'Q' }], attachment);
    const extra = MAX_INPUT_BYTES - messageBytes(sample);
    const user = `Q${'a'.repeat(extra)}`;
    const fitted = buildChatMessages([{ role: 'user', content: user }], attachment);
    expect(messageBytes(fitted)).toBe(MAX_INPUT_BYTES);
    expect(fitted[1]?.content.endsWith(user)).toBe(true);
    expect(() => buildChatMessages([{ role: 'user', content: `${user}b` }], attachment)).toThrow(
      CHAT_TOO_BIG,
    );
  });
});
