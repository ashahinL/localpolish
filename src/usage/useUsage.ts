import { useEffect, useState } from 'preact/hooks';
import { loadUsage, USAGE_STORAGE_KEY, type UsageRow } from '../core/usage';
import { errorMessage, onStorageKeyChanged } from '../options/chrome';

export type UsageState =
  { kind: 'loading' } | { kind: 'ready'; rows: UsageRow[] } | { kind: 'error'; message: string };

export function useUsage(): UsageState {
  const [state, setState] = useState<UsageState>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    let latest = 0;
    const read = () => {
      const id = ++latest;
      // Only the newest read may land, so a slow older read cannot hide newer counts.
      const current = () => alive && id === latest;
      loadUsage().then(
        (rows) => current() && setState({ kind: 'ready', rows }),
        (err: unknown) => current() && setState({ kind: 'error', message: errorMessage(err) }),
      );
    };
    // Subscribe before the first read so a count saved in between is not missed.
    const stopListening = onStorageKeyChanged(USAGE_STORAGE_KEY, read);
    read();
    return () => {
      alive = false;
      stopListening();
    };
  }, []);

  return state;
}
