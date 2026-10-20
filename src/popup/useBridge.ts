import { useEffect, useRef, useState } from 'preact/hooks';
import { type BridgeStatus } from '../core/messages';
import { type ProviderId } from '../core/settings';
import { bridgeStatus } from '../options/chrome';
import { isCli } from '../options/ProviderSection';

export interface BridgeState {
  status: BridgeStatus | null;
  checking: boolean;
  check(): void;
}

interface Snapshot {
  provider: ProviderId | undefined;
  status: BridgeStatus | null;
  checking: boolean;
}

export function useBridge(provider: ProviderId | undefined): BridgeState {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    provider,
    status: null,
    checking: false,
  });
  // Only the newest request may write. Provider changes and unmount retire older ones.
  const generation = useRef(0);

  const requestStatus = (force: boolean): void => {
    const request = ++generation.current;
    setSnapshot((previous) => ({
      provider,
      status: previous.provider === provider ? previous.status : null,
      checking: true,
    }));
    void bridgeStatus(force).then((status) => {
      if (request === generation.current) setSnapshot({ provider, status, checking: false });
    });
  };

  useEffect(() => {
    setSnapshot({ provider, status: null, checking: false });
    if (provider !== undefined && isCli(provider)) requestStatus(false);
    return () => {
      generation.current += 1;
    };
  }, [provider]);

  // Hides the previous provider's state during the render before the effect resets it.
  const current = snapshot.provider === provider ? snapshot : { status: null, checking: false };
  return { status: current.status, checking: current.checking, check: () => requestStatus(true) };
}
