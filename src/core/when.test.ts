import { expect, it } from 'vitest';
import { shortWhen } from './when';

// Saturday 24 October 2026, 21:00 in Cairo (UTC+3).
const NOW = Date.parse('2026-10-24T18:00:00Z');

it.each([
  ['2026-10-24T12:15:00Z', '15:15'],
  ['2026-10-24T05:05:00Z', '08:05'],
  ['2026-10-23T12:00:00Z', 'Yesterday'],
  ['2026-10-22T12:00:00Z', 'Thu'],
  ['2026-10-18T12:00:00Z', 'Sun'],
  ['2026-10-17T12:00:00Z', 'Oct 17'],
  ['2026-10-03T12:00:00Z', 'Oct 3'],
])('shows %s as %s', (at, expected) => {
  expect(shortWhen(Date.parse(at), NOW)).toBe(expected);
});

it('counts days on the Cairo calendar, not UTC', () => {
  // 00:30 on 25 October in Cairo, while UTC is still on the 24th.
  const now = Date.parse('2026-10-24T21:30:00Z');
  expect(shortWhen(Date.parse('2026-10-24T20:50:00Z'), now)).toBe('Yesterday');
  expect(shortWhen(Date.parse('2026-10-24T21:10:00Z'), now)).toBe('00:10');
});
