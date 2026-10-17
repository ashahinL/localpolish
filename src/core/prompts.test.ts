import { describe, expect, it } from 'vitest';
import { buildPrompt, MODE_TASKS, SYSTEM_BASE, TONE_TASKS } from './prompts';

describe('buildPrompt', () => {
  it('builds a fix prompt and wraps the user text', () => {
    const prompt = buildPrompt('fix', 'polite', 'hi');
    expect(prompt.system.startsWith(SYSTEM_BASE)).toBe(true);
    expect(prompt.system.endsWith(MODE_TASKS.fix)).toBe(true);
    expect(prompt.system).toBe(`${SYSTEM_BASE}\n\n${MODE_TASKS.fix}`);
    expect(prompt.user).toBe('<text>\nhi\n</text>');
  });

  it('uses the formal tone task when mode is tone', () => {
    const prompt = buildPrompt('tone', 'formal', 'hi');
    expect(prompt.system.endsWith(TONE_TASKS.formal)).toBe(true);
    expect(prompt.system).toBe(`${SYSTEM_BASE}\n\n${TONE_TASKS.formal}`);
  });

  it('ignores tone for non-tone modes', () => {
    const modes = ['fix', 'rephrase', 'shorter'] as const;
    for (const mode of modes) {
      expect(buildPrompt(mode, 'polite', 'x')).toEqual(buildPrompt(mode, 'angry-civil', 'x'));
      expect(buildPrompt(mode, 'polite', 'x').system.endsWith(MODE_TASKS[mode])).toBe(true);
    }
  });
});
