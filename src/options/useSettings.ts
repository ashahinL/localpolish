import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useRef, useState } from 'preact/hooks';
import { loadSettings, saveSettings, type Settings } from '../core/settings';
import { errorMessage, onSettingsChanged } from './chrome';
import { mergeExternal, pickSettings, type SettingsKey } from './form';

const TYPING_DELAY_MS = 400;

export type SaveStatus =
  { kind: 'idle' } | { kind: 'saved'; at: number } | { kind: 'error'; message: string };

type Patch = Partial<Settings> | ((settings: Settings) => Partial<Settings>);

export interface SettingsApi {
  settings: Settings | null;
  loadError: string | null;
  status: SaveStatus;
  /** Typing changes wait for a pause before saving; everything else saves at once. */
  change(patch: Patch, typing?: boolean): void;
  flush(): Promise<boolean>;
  startEditing(key: SettingsKey): void;
  stopEditing(key: SettingsKey): void;
}

export function useSettings(): SettingsApi {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const current = useRef<Settings | null>(null);
  const pending = useRef(new Set<SettingsKey>());
  const editing = useRef(new Set<SettingsKey>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // saveSettings reads then writes storage, so overlapping saves could drop each other's fields.
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));

  const show = useCallback((next: Settings) => {
    current.current = next;
    setSettings(next);
  }, []);

  const flush = useCallback((): Promise<boolean> => {
    clearTimeout(timer.current);
    if (current.current && pending.current.size > 0) {
      const keys = new Set(pending.current);
      const patch = pickSettings(current.current, keys);
      pending.current.clear();
      queue.current = queue.current
        .then(() => saveSettings(patch))
        .then(
          () => {
            if (pending.current.size > 0) return false;
            setStatus({ kind: 'saved', at: Date.now() });
            return true;
          },
          (err: unknown) => {
            for (const key of keys) pending.current.add(key);
            setStatus({ kind: 'error', message: errorMessage(err) });
            return false;
          },
        );
    }
    return queue.current;
  }, []);

  useEffect(() => {
    let alive = true;
    loadSettings().then(
      (loaded) => alive && show(loaded),
      (err: unknown) => alive && setLoadError(errorMessage(err)),
    );
    const stopListening = onSettingsChanged(() => {
      void loadSettings().then((incoming) => {
        if (!alive || !current.current) return;
        const busy = new Set([...editing.current, ...pending.current]);
        show(mergeExternal(current.current, incoming, busy));
      });
    });
    const onPageHide = () => void flush();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      alive = false;
      stopListening();
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [show, flush]);

  const change = useCallback(
    (patch: Patch, typing = false) => {
      const before = current.current;
      if (!before) return;
      const changes = typeof patch === 'function' ? patch(before) : patch;
      show({ ...before, ...changes });
      for (const key of Object.keys(changes)) pending.current.add(key as SettingsKey);
      if (typing) {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), TYPING_DELAY_MS);
      } else {
        void flush();
      }
    },
    [show, flush],
  );

  const startEditing = useCallback((key: SettingsKey) => {
    editing.current.add(key);
  }, []);

  const stopEditing = useCallback(
    (key: SettingsKey) => {
      editing.current.delete(key);
      void flush();
    },
    [flush],
  );

  return { settings, loadError, status, change, flush, startEditing, stopEditing };
}

export const SettingsContext = createContext<SettingsApi | null>(null);

export function useSettingsApi(): SettingsApi {
  const api = useContext(SettingsContext);
  if (!api) throw new Error('useSettingsApi needs a SettingsContext provider');
  return api;
}
