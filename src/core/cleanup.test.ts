import { describe, expect, it } from 'vitest';
import { cleanOutput } from './cleanup';

describe('cleanOutput', () => {
  it('drops a leading preamble line', () => {
    expect(cleanOutput('Here is the corrected text:\nI went home.', 'i go home')).toBe(
      'I went home.',
    );
  });

  it('removes a wrapping pair of straight quotes', () => {
    expect(cleanOutput('"I went home."', 'i go home')).toBe('I went home.');
  });

  it('keeps quotes that do not wrap the whole output', () => {
    expect(cleanOutput('"Hi," she said.', '"hi," she said')).toBe('"Hi," she said.');
  });

  it('removes text tags', () => {
    expect(cleanOutput('<text>\nI went home.\n</text>', 'i go home')).toBe('I went home.');
  });

  it('removes a code fence', () => {
    expect(cleanOutput('```\nI went home.\n```', 'i go home')).toBe('I went home.');
  });

  it('replaces a spaced em dash with a comma', () => {
    expect(cleanOutput('It works \u2014 mostly.', 'it work mostly')).toBe('It works, mostly.');
  });

  it('replaces a tight em dash with a comma', () => {
    expect(cleanOutput('It works\u2014mostly.', 'it work mostly')).toBe('It works, mostly.');
  });

  it('keeps an em dash when the input already has one', () => {
    expect(cleanOutput('A \u2014 B', 'A \u2014 b')).toBe('A \u2014 B');
  });

  it('replaces a curly apostrophe when the input has none', () => {
    expect(cleanOutput('She doesn\u2019t like it.', 'she dont like it')).toBe(
      "She doesn't like it.",
    );
  });

  it('restores the input outer whitespace', () => {
    expect(cleanOutput('Hello there.', '  hello there\n')).toBe('  Hello there.\n');
  });

  it('does not double whitespace-only input', () => {
    expect(cleanOutput('', ' \n')).toBe(' \n');
  });

  it('keeps a line that is not a preamble', () => {
    expect(cleanOutput('Sure, I can help with that.', 'sure i can help with that')).toBe(
      'Sure, I can help with that.',
    );
  });

  it('passes Arabic through', () => {
    expect(cleanOutput('مرحبا، كيف حالك؟', 'مرحبا كيف حالك')).toBe('مرحبا، كيف حالك؟');
  });
});
