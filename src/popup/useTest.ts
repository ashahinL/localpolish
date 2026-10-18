import { useEffect, useRef, useState } from 'preact/hooks';
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
  // A late answer must not restore a result cleared by a provider change.
  const runId = useRef(0);

  useEffect(() => {
    runId.current += 1;
    setResult(null);
    setRunning(false);
  }, [settings?.provider]);

  const run = (): void => {
    const id = ++runId.current;
    void (async () => {
      setRunning(true);
      setResult(null);
      if (!(await flush())) {
        if (id !== runId.current) return;
        setResult({
          ok: false,
          message: 'Settings were not saved, so the test did not run. Try again.',
        });
        setRunning(false);
        return;
      }
      const next = await testConnection();
      if (id !== runId.current) return;
      setResult(next);
      setRunning(false);
    })();
  };

  return { running, result, run };
}
