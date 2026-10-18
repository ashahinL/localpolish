import { isBlocked } from '../core/settings';

export type SiteState =
  { kind: 'shown' } | { kind: 'hidden' } | { kind: 'hidden-by'; rule: string };

function sameHost(entry: string, host: string): boolean {
  return entry.trim().toLowerCase() === host.trim().toLowerCase();
}

export function hostOf(url: string | undefined): string | null {
  if (url === undefined) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname;
  } catch {
    return null;
  }
}

export function siteState(host: string, blocklist: string[]): SiteState {
  if (blocklist.some((entry) => sameHost(entry, host))) return { kind: 'hidden' };
  for (const entry of blocklist) {
    if (isBlocked(host, [entry])) return { kind: 'hidden-by', rule: entry.trim() };
  }
  return { kind: 'shown' };
}

export function hideSite(host: string, blocklist: string[]): string[] {
  if (blocklist.some((entry) => sameHost(entry, host))) return [...blocklist];
  return [...blocklist, host];
}

export function showSite(host: string, blocklist: string[]): string[] {
  return blocklist.filter((entry) => !sameHost(entry, host));
}
