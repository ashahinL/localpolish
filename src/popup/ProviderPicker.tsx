import { type BridgeStatus } from '../core/messages';
import { type ProviderId, type Settings } from '../core/settings';
import { isCli, PROVIDERS } from '../options/ProviderSection';
import { useSettingsApi } from '../options/useSettings';
import { CLI_KEY } from './summary';

function rowTitle(title: string): string {
  return title === 'OpenAI-compatible API' ? 'OpenAI-compatible' : title;
}

/** The found CLI's version number, or nothing while the bridge has not listed it. */
function foundVersion(id: ProviderId, status: BridgeStatus | null | undefined): string | undefined {
  if (!isCli(id) || status?.ok !== true) return undefined;
  // Version lines differ per CLI ("codex-cli 0.98.0", "2.1.310 (Claude Code)").
  return status.clis[CLI_KEY[id]]?.version.match(/\d+(?:\.\d+)+/)?.[0];
}

function Row({
  id,
  title,
  meta,
  selected,
  onSelect,
}: {
  id: ProviderId;
  title: string;
  meta: string | undefined;
  selected: boolean;
  onSelect(): void;
}) {
  return (
    <label class={selected ? 'prov on' : 'prov'}>
      <input
        type="radio"
        name="provider"
        value={id}
        checked={selected}
        aria-labelledby={`pn-${id}`}
        aria-describedby={meta === undefined ? undefined : `pm-${id}`}
        onChange={onSelect}
      />
      <span class="radio" aria-hidden="true" />
      <span class="name" id={`pn-${id}`}>
        {title}
      </span>
      {meta !== undefined && (
        <span class="meta" id={`pm-${id}`}>
          {meta}
        </span>
      )}
    </label>
  );
}

export function ProviderPicker({
  settings,
  status,
}: {
  settings: Settings;
  status?: BridgeStatus | null;
}) {
  const { change } = useSettingsApi();
  const { provider } = settings;
  const subtitle = PROVIDERS.find((item) => item.id === provider)?.subtitle;
  const row = (item: (typeof PROVIDERS)[number]) => (
    <Row
      key={item.id}
      id={item.id}
      title={rowTitle(item.title)}
      meta={foundVersion(item.id, status)}
      selected={item.id === provider}
      onSelect={() => change({ provider: item.id })}
    />
  );

  return (
    <section class="sec" aria-labelledby="pp-h">
      <h2 id="pp-h" class="sr">
        AI provider
      </h2>
      <div class="prov-list" role="radiogroup" aria-labelledby="pp-h">
        <p class="group-label">Your subscription, through the bridge</p>
        {PROVIDERS.filter((item) => isCli(item.id)).map(row)}
        <p class="group-label">API key</p>
        {PROVIDERS.filter((item) => !isCli(item.id)).map(row)}
      </div>
      <p class="help">{subtitle}</p>
    </section>
  );
}
