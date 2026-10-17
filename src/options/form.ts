import { type Settings } from '../core/settings';

export type SettingsKey = keyof Settings;

export function parseBlocklist(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export function parseTemperature(text: string): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 1) return null;
  return value;
}

export function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

/** Chrome reports "Ctrl+Shift+K" on Windows and Linux but "⇧⌘K" on macOS. */
export function shortcutKeys(shortcut: string): string[] {
  if (shortcut === '') return [];
  if (shortcut.includes('+')) return shortcut.split('+').filter((key) => key !== '');
  return Array.from(shortcut);
}

export function pickSettings(settings: Settings, keys: Iterable<SettingsKey>): Partial<Settings> {
  const patch: Partial<Settings> = {};
  for (const key of keys) {
    (patch as Record<SettingsKey, unknown>)[key] = settings[key];
  }
  return patch;
}

function originOf(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

/** Drop the saved key when the base URL points at a different server. */
export function baseUrlPatch(before: Settings, url: string): Partial<Settings> {
  const patch: Partial<Settings> = { openaiBaseUrl: url };
  if (before.openaiApiKey !== '' && originOf(url) !== originOf(before.openaiBaseUrl)) {
    patch.openaiApiKey = '';
  }
  return patch;
}

/** Take settings saved elsewhere, but keep the fields the user is still editing. */
export function mergeExternal(
  current: Settings,
  incoming: Settings,
  editing: ReadonlySet<SettingsKey>,
): Settings {
  return { ...incoming, ...pickSettings(current, editing) };
}
