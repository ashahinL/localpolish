import { describe, expect, it } from 'vitest';
import { hideSite, hostOf, showSite, siteState } from './sites';

describe('hostOf', () => {
  it('returns the hostname of an https or http url', () => {
    expect(hostOf('https://mail.google.com/mail/u/0/')).toBe('mail.google.com');
    expect(hostOf('http://example.com/path')).toBe('example.com');
  });

  it('returns null for other pages, a missing url and invalid text', () => {
    expect(hostOf('chrome://extensions')).toBeNull();
    expect(hostOf('file:///x')).toBeNull();
    expect(hostOf(undefined)).toBeNull();
    expect(hostOf('not a url')).toBeNull();
  });
});

describe('siteState', () => {
  it('is hidden when an entry matches the host', () => {
    expect(siteState('mail.google.com', ['mail.google.com'])).toEqual({ kind: 'hidden' });
  });

  it('treats spaces and capitals as the same host', () => {
    expect(siteState('mail.google.com', ['  Mail.Google.com  '])).toEqual({ kind: 'hidden' });
  });

  it('stays hidden when a broader rule is listed before the exact host', () => {
    expect(siteState('mail.google.com', ['google.com', 'mail.google.com'])).toEqual({
      kind: 'hidden',
    });
  });

  it('is hidden by the first broader rule, with the rule trimmed', () => {
    expect(siteState('mail.google.com', ['example.com', ' google.com '])).toEqual({
      kind: 'hidden-by',
      rule: 'google.com',
    });
  });

  it('is shown when no entry matches', () => {
    expect(siteState('mail.google.com', [])).toEqual({ kind: 'shown' });
  });
});

describe('hideSite', () => {
  it('adds the host once and never twice', () => {
    const original = ['docs.google.com'];
    const added = hideSite('mail.google.com', original);
    expect(added).toEqual(['docs.google.com', 'mail.google.com']);
    expect(original).toEqual(['docs.google.com']);

    const again = hideSite('mail.google.com', added);
    expect(again).toEqual(['docs.google.com', 'mail.google.com']);
    expect(again).not.toBe(added);
  });

  it('still adds the host when only a broader rule is present', () => {
    expect(hideSite('mail.google.com', ['google.com'])).toEqual(['google.com', 'mail.google.com']);
  });
});

describe('showSite', () => {
  it('removes the exact entry and keeps a broader one', () => {
    expect(showSite('mail.google.com', ['  Mail.Google.com ', 'google.com'])).toEqual([
      'google.com',
    ]);
  });
});
