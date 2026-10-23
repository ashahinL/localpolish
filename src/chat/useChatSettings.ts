import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  loadSettings,
  saveSettings,
  type CliProviderId,
  type ProviderId,
  type Settings,
} from '../core/settings';
import { errorMessage, onSettingsChanged } from '../options/chrome';

export interface ChatSettingsApi {
  settings: Settings | null;
  error: string | null;
  setProvider(provider: ProviderId): void;
  setModel(provider: ProviderId, model: string): void;
  setEffort(provider: CliProviderId, effort: string): void;
  /**
   * Resolves once the shown chat settings are stored. After a failed write it saves the shown
   * choice again, and rejects if that fails too, so nothing is sent to a provider the user left.
   */
  saved(): Promise<void>;
}

// Writes only the nested chat settings. Fix's choices stay as they are.
export function useChatSettings(): ChatSettingsApi {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = useRef<Settings | null>(null);
  // Writes never reject, so one failure does not block later writes.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const writes = useRef(0);
  // Every read and write bumps this, so only the newest read may replace what is shown.
  const generation = useRef(0);
  const failure = useRef<unknown>(undefined);

  const show = useCallback((next: Settings) => {
    shown.current = next;
    setSettings(next);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => {
      const started = ++generation.current;
      loadSettings().then(
        (loaded) => {
          const stale = started !== generation.current || writes.current > 0;
          if (alive && !stale && failure.current === undefined) show(loaded);
        },
        (err: unknown) => alive && setError(errorMessage(err)),
      );
    };
    load();
    const stop = onSettingsChanged(load);
    return () => {
      alive = false;
      stop();
    };
  }, [show]);

  // Each write stores the whole shown chat choice as it is when the write runs. A success
  // therefore also stores any earlier change whose own write failed.
  const write = useCallback((): Promise<void> => {
    generation.current++;
    writes.current++;
    queue.current = queue.current
      .then(() => {
        const chat = shown.current?.chat;
        if (chat) return saveSettings({ chat });
      })
      .then(
        () => {
          failure.current = undefined;
          setError(null);
        },
        (err: unknown) => {
          failure.current = err;
          setError(`Could not save: ${errorMessage(err)}`);
        },
      )
      .finally(() => {
        writes.current--;
      });
    return queue.current;
  }, []);

  const update = useCallback(
    (chat: Settings['chat']) => {
      if (!shown.current) return;
      show({ ...shown.current, chat });
      void write();
    },
    [show, write],
  );

  const setProvider = useCallback(
    (provider: ProviderId) => {
      if (shown.current) update({ ...shown.current.chat, provider });
    },
    [update],
  );

  const setModel = useCallback(
    (provider: ProviderId, model: string) => {
      const chat = shown.current?.chat;
      if (chat) update({ ...chat, models: { ...chat.models, [provider]: model } });
    },
    [update],
  );

  const saved = useCallback(async () => {
    let retried = false;
    while (true) {
      const pending = queue.current;
      await pending;
      if (pending !== queue.current) continue;
      if (failure.current === undefined) return;
      if (retried) throw new Error(errorMessage(failure.current));
      retried = true;
      void write();
    }
  }, [write]);

  const setEffort = useCallback(
    (provider: CliProviderId, effort: string) => {
      const chat = shown.current?.chat;
      if (chat) update({ ...chat, efforts: { ...chat.efforts, [provider]: effort } });
    },
    [update],
  );

  return { settings, error, setProvider, setModel, setEffort, saved };
}
