import { describe, expect, it } from 'vitest';
import { frameHosts } from './site';

describe('frameHosts', () => {
  it('keeps the own hostname with no ancestors', () => {
    expect(frameHosts('editor.example', [])).toEqual(['editor.example']);
  });

  it('includes two ancestor hosts', () => {
    expect(
      frameHosts('editor.example', ['https://embed.example', 'http://site.example:8080']),
    ).toEqual(['editor.example', 'embed.example', 'site.example']);
  });

  it('uses the ancestor host for a blank frame', () => {
    expect(frameHosts('', ['https://site.example'])).toEqual(['site.example']);
  });

  it('returns null when an ancestor origin is hidden', () => {
    expect(frameHosts('editor.example', ['https://embed.example', 'null'])).toBeNull();
  });

  it('returns null when an ancestor origin cannot be parsed', () => {
    expect(frameHosts('editor.example', ['invalid origin'])).toBeNull();
  });
});
