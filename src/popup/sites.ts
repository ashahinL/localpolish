import { isBlocked, normalizeSiteEntry } from '../core/settings';

export type SiteState =
  { kind: 'shown' } | { kind: 'hidden' } | { kind: 'hidden-by'; rule: string };

function sameHost(entry: string, host: string): boolean {
  const rule = normalizeSiteEntry(entry);
  return rule !== null && rule === normalizeSiteEntry(host);
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

const HOST_ERROR = 'Enter a hostname such as example.com';

export function addSite(
  input: string,
  blocklist: string[],
): { list: string[] } | { error: string } {
  const host = normalizeSiteEntry(input);
  if (host === null) return { error: HOST_ERROR };
  if (blocklist.some((entry) => sameHost(entry, host))) return { error: 'Already in the list' };
  return { list: [...blocklist, host] };
}
