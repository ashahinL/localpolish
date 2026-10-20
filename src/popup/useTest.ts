import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { type TestResult } from '../core/messages';
import { testConnection } from '../options/chrome';
import { useSettingsApi } from '../options/useSettings';

export interface TestState {
  running: boolean;
  result: TestResult | null;
  run(): void;
}

export function useTest(): TestState {
  const { flush, settings } = useSettingsApi();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const runId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useLayoutEffect(() => {
    runId.current += 1;
    controller.current?.abort();
    setResult(null);
    setRunning(false);
    return () => {
      runId.current += 1;
      controller.current?.abort();
    };
  }, [settings?.provider]);

  const run = (): void => {
    const id = ++runId.current;
    controller.current?.abort();
    const owner = new AbortController();
    controller.current = owner;
    void (async () => {
      setRunning(true);
      setResult(null);
      const saved = await flush();
      if (id !== runId.current || owner.signal.aborted) return;
      if (!saved) {
        setResult({
          ok: false,
          message: 'Settings were not saved, so the test did not run. Try again.',
        });
        setRunning(false);
        return;
      }
      const next = await testConnection(owner.signal);
      if (id !== runId.current || owner.signal.aborted) return;
      setResult(next);
      setRunning(false);
    })();
  };

  return { running, result, run };
}
