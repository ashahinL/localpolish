import { useEffect, useState } from 'preact/hooks';
import { type BridgeStatus } from '../core/messages';
import { bridgeStatus } from '../options/chrome';

export interface BridgeState {
  status: BridgeStatus | null;
  checking: boolean;
  check(): void;
}

export function useBridge(): BridgeState {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const check = (): void => {
    void (async () => {
      setChecking(true);
      setStatus(await bridgeStatus());
      setChecking(false);
    })();
  };

  useEffect(() => {
    check();
  }, []);

  return { status, checking, check };
}
