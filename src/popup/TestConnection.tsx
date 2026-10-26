import { Note } from '../options/controls';
import { formatSeconds } from '../options/form';
import { AlertIcon } from './icons';
import { type TestState } from './useTest';

export function TestConnection({ test, wide }: { test: TestState; wide?: boolean }) {
  const { running, run } = test;
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
        {running && <Testing />}
      </div>
      <TestResult test={test} />
    </>
  );
}

export function TestStatus({ test }: { test: TestState }) {
  return (
    <>
      {test.running && <Testing />}
      <TestResult test={test} />
    </>
  );
}

function Testing() {
  return (
    <span class="testing" role="status">
      <span class="spinner" aria-hidden="true" />
      Testing…
    </span>
  );
}

function TestResult({ test: { result } }: { test: TestState }) {
  if (result?.ok === true) {
    return (
      <Note tone="ok">
        Works. Got “{result.sample}” in {formatSeconds(result.ms)} s
      </Note>
    );
  }
  if (result?.ok === false) {
    return (
      <Note tone="error">
        <p class="nhead">
          <AlertIcon />
          <span>Test failed</span>
        </p>
        <p>{result.message}</p>
      </Note>
    );
  }
  return null;
}
