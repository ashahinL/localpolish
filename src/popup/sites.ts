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

const HOST_ERROR = 'Enter a hostname such as example.com';

export function addSite(
  input: string,
  blocklist: string[],
): { list: string[] } | { error: string } {
  const trimmed = input.trim().toLowerCase();
  let host: string;
  if (trimmed.includes('://')) {
    try {
      host = new URL(trimmed).hostname;
    } catch {
      // A scheme with no host, such as "https://", makes URL throw.
      return { error: HOST_ERROR };
    }
  } else {
    const slash = trimmed.indexOf('/');
    host = slash === -1 ? trimmed : trimmed.slice(0, slash);
  }
  if (host === '' || /\s/.test(host)) return { error: HOST_ERROR };
  if (blocklist.some((entry) => sameHost(entry, host))) return { error: 'Already in the list' };
  return { list: [...blocklist, host] };
}
