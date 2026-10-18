import { Note } from '../options/controls';
import { formatSeconds } from '../options/form';
import { AlertIcon } from './icons';
import { type TestState } from './useTest';

export function TestConnection({ test, wide }: { test: TestState; wide?: boolean }) {
  const { running, result, run } = test;
  return (
    <>
      <div class="test-row">
        <button
          type="button"
          class="primary"
          disabled={running}
          style={wide ? { flex: '1' } : undefined}
          onClick={run}
        >
          Test connection
        </button>
        {running && (
          <span class="testing" role="status">
            <span class="spinner" aria-hidden="true" />
            Testing…
          </span>
        )}
      </div>
      {result?.ok === true && (
        <Note tone="ok">
          Works. Got “{result.sample}” in {formatSeconds(result.ms)} s
        </Note>
      )}
      {result?.ok === false && (
        <Note tone="error">
          <p class="nhead">
            <AlertIcon />
            <span>Test failed</span>
          </p>
          <p>{result.message}</p>
        </Note>
      )}
    </>
  );
}
