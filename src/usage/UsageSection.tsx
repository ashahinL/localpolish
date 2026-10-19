import { Note } from '../options/controls';
import { DEFAULT_MODEL_LABEL, providerTitle, sortUsage, totalRequests } from './rows';
import { useUsage, type UsageState } from './useUsage';
import './usage.css';

export function UsageSection() {
  const state = useUsage();
  return (
    <section class="card usage" aria-labelledby="usage-h">
      <div class="card-head ctitle">
        <h2 id="usage-h">Usage</h2>
      </div>
      <UsageBody state={state} />
      <p class="help">
        Counts start with this update. Includes failed or cancelled attempts and connection tests.
        Cached answers do not count. Only these totals are stored, on this browser.
      </p>
    </section>
  );
}

function UsageBody({ state }: { state: UsageState }) {
  if (state.kind === 'loading') return <p class="muted">Loading usage…</p>;
  if (state.kind === 'error') {
    return <Note tone="error">Could not load usage: {state.message}</Note>;
  }
  if (state.rows.length === 0) return <p class="muted">No requests recorded yet.</p>;
  return (
    <table class="usage-table">
      <thead>
        <tr>
          <th scope="col">Model</th>
          <th scope="col">Provider</th>
          <th scope="col" class="usage-num">
            Requests
          </th>
        </tr>
      </thead>
      <tbody>
        {sortUsage(state.rows).map((row) => (
          <tr key={`${row.provider}\n${row.model}`}>
            <td class={row.model ? 'usage-model' : 'usage-model muted'}>
              {row.model || DEFAULT_MODEL_LABEL}
            </td>
            <td>{providerTitle(row.provider)}</td>
            <td class="usage-num">{row.requests.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" colSpan={2}>
            Total
          </th>
          <td class="usage-num">{totalRequests(state.rows).toLocaleString()}</td>
        </tr>
      </tfoot>
    </table>
  );
}
