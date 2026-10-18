/** The hosts of this frame and every frame above it. Null when a parent's origin is hidden. */
export function frameHosts(hostname: string, ancestorOrigins: readonly string[]): string[] | null {
  const hosts = hostname === '' ? [] : [hostname];
  for (const origin of ancestorOrigins) {
    if (origin === 'null') return null;
    try {
      hosts.push(new URL(origin).hostname);
    } catch {
      return null;
    }
  }
  return hosts;
}
