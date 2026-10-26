import { type ProviderId, type Settings } from '../core/settings';
import { isCli, PROVIDERS } from '../options/ProviderSection';
import { useSettingsApi } from '../options/useSettings';

function rowTitle(title: string): string {
  return title === 'OpenAI-compatible API' ? 'OpenAI-compatible' : title;
}

function Row({
  id,
  title,
  selected,
  onSelect,
}: {
  id: ProviderId;
  title: string;
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
        onChange={onSelect}
      />
      <span class="radio" aria-hidden="true" />
      <span class="name" id={`pn-${id}`}>
        {title}
      </span>
    </label>
  );
}

export function ProviderPicker({ settings }: { settings: Settings }) {
  const { change } = useSettingsApi();
  const { provider } = settings;
  const subtitle = PROVIDERS.find((item) => item.id === provider)?.subtitle;
  const row = (item: (typeof PROVIDERS)[number]) => (
    <Row
      key={item.id}
      id={item.id}
      title={rowTitle(item.title)}
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
