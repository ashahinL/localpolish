const ZONE = 'Africa/Cairo';
const DAY_MS = 24 * 60 * 60 * 1000;

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE });
const TIME = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: ZONE,
});
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: ZONE });
const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: ZONE });

/** Whole calendar days between two instants, counted on Cairo dates. */
function daysBetween(timestamp: number, now: number): number {
  return Math.round((Date.parse(DAY.format(now)) - Date.parse(DAY.format(timestamp))) / DAY_MS);
}

/** `12:40` today, `Yesterday`, `Mon` within the week, else `Oct 3`, all in Cairo time. */
export function shortWhen(timestamp: number, now = Date.now()): string {
  const days = daysBetween(timestamp, now);
  if (days === 0) return TIME.format(timestamp);
  if (days === 1) return 'Yesterday';
  if (days >= 2 && days <= 6) return WEEKDAY.format(timestamp);
  return DATE.format(timestamp);
}
