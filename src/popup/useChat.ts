import { useEffect, useState } from 'preact/hooks';
import { chatTarget, openPlainChat, type ChatTarget, type DocumentEntry } from './chrome';

export interface TargetState {
  target: ChatTarget | undefined;
  error: string;
}

export function useChatTarget(): TargetState {
  const [state, setState] = useState<TargetState>({ target: undefined, error: '' });
  useEffect(() => {
    let alive = true;
    void chatTarget().then(
      (target) => {
        if (alive) setState({ target, error: '' });
      },
      () => {
        if (alive)
          setState({
            target: undefined,
            error: 'Could not find the active tab. Reopen the popup.',
          });
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

export interface OpenState {
  opening: boolean;
  error: string;
  open(entry?: DocumentEntry): void;
}

/** Opens the side panel; the popup closes on success and shows the error otherwise. */
export function useOpenChat(target: ChatTarget | undefined): OpenState {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const open = (entry?: DocumentEntry): void => {
    if (!target) return;
    setOpening(true);
    setError('');
    void openPlainChat(target, entry).catch((error: unknown) => {
      setOpening(false);
      setError(error instanceof Error ? error.message : 'Could not open chat.');
    });
  };
  return { opening, error, open };
}
