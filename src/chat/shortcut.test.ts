import { describe, expect, it } from 'vitest';
import { matchesShortcut } from './shortcut';

describe('matchesShortcut', () => {
  it('matches Ctrl+Shift+K in either case and rejects a wrong modifier set', () => {
    expect(
      matchesShortcut('Ctrl+Shift+K', {
        key: 'K',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe(true);
    expect(
      matchesShortcut('Ctrl+Shift+K', {
        key: 'k',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe(true);
    expect(
      matchesShortcut('Ctrl+Shift+K', {
        key: 'K',
        ctrlKey: true,
        metaKey: false,
        altKey: true,
        shiftKey: true,
      }),
    ).toBe(false);
    expect(
      matchesShortcut('Ctrl+Shift+K', {
        key: 'K',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(false);
  });

  it('matches ⇧⌘K with meta and shift, not ctrl and shift', () => {
    expect(
      matchesShortcut('⇧⌘K', {
        key: 'k',
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe(true);
    expect(
      matchesShortcut('⇧⌘K', {
        key: 'k',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe(false);
  });

  it('matches ⌥⇧L with alt and shift', () => {
    expect(
      matchesShortcut('⌥⇧L', {
        key: 'L',
        ctrlKey: false,
        metaKey: false,
        altKey: true,
        shiftKey: true,
      }),
    ).toBe(true);
  });

  it('matches ⌃⇧K with ctrl and shift', () => {
    expect(
      matchesShortcut('⌃⇧K', {
        key: 'K',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe(true);
  });

  it('never matches an empty shortcut', () => {
    expect(
      matchesShortcut('', {
        key: 'K',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe(false);
    expect(
      matchesShortcut('', {
        key: '',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(false);
  });

  it('matches macOS Option shortcuts by key position when Option changes the typed letter', () => {
    const event = {
      key: 'Ò',
      code: 'KeyL',
      ctrlKey: false,
      metaKey: false,
      altKey: true,
      shiftKey: true,
    };
    expect(matchesShortcut('⌥⇧L', event)).toBe(true);
    expect(matchesShortcut('⌥⇧K', event)).toBe(false);
  });
});
