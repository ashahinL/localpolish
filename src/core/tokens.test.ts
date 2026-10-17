import { describe, expect, it } from 'vitest';
import { extractProtectedTokens, findMissingTokens } from './tokens';

describe('protected tokens', () => {
  it('strips a trailing period from a URL and ignores it when the URL remains', () => {
    const input = 'See https://example.com/a.';
    expect(extractProtectedTokens(input)).toEqual(['https://example.com/a']);
    expect(findMissingTokens(input, input)).toEqual([]);
  });

  it('reports a mention that was dropped', () => {
    expect(findMissingTokens('ask @sara', 'ask')).toEqual(['@sara']);
  });

  it('reports a hashtag whose case changed', () => {
    expect(findMissingTokens('use #AI', 'use #ai')).toEqual(['#AI']);
  });

  it('does not report a code span that is still in the output', () => {
    const input = 'run `npm test`';
    expect(extractProtectedTokens(input)).toEqual(['`npm test`']);
    expect(findMissingTokens(input, 'run `npm test` please')).toEqual([]);
  });

  it('reports an emoji that was dropped', () => {
    const input = 'nice 👍';
    expect(extractProtectedTokens(input)).toEqual(['👍']);
    expect(findMissingTokens(input, 'nice')).toEqual(['👍']);
  });

  it('does not treat an email address as a mention', () => {
    expect(extractProtectedTokens('a@b.com')).toEqual([]);
  });

  it('does not take a hashtag out of a URL fragment', () => {
    expect(extractProtectedTokens('https://x.com/a#top')).toEqual(['https://x.com/a#top']);
  });
});
