import { CLIS } from '../options/sections';
import { BridgeErrorNote } from './BridgeErrorNote';
import { type BridgeState } from './useBridge';

export function BridgeCard({ bridge }: { bridge: BridgeState }) {
  const { status, checking, check } = bridge;

  return (
    <section class="card stack" aria-labelledby="br-h" aria-busy={checking}>
      <div class="ctitle">
        <h2 id="br-h">Bridge</h2>
        <button type="button" class="link" disabled={checking} onClick={check}>
          Check again
        </button>
      </div>
      {status === null && <p class="muted">Checking…</p>}
      {status?.ok === false && <BridgeErrorNote message={status.message} />}
      {status?.ok === true && (
        <ul class="clis">
          {CLIS.map(({ key, name }) => {
            const cli = status.clis[key];
            return (
              <li key={key}>
                <span class={cli ? 'dot on' : 'dot off'} aria-hidden="true" />
                <span class="n">{name}</span>
                <span class="muted">{cli ? cli.version : 'not found'}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
