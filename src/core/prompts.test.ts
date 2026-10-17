import { describe, expect, it } from 'vitest';
import { buildPrompt, MODE_PROMPTS, TONE_PROMPTS } from './prompts';

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
