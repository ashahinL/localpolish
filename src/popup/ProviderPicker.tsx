import { type ProviderId, type Settings } from '../core/settings';
import { isCli, PROVIDERS } from '../options/ProviderSection';
import { useSettingsApi } from '../options/useSettings';

function chipTitle(title: string): string {
  return title === 'OpenAI-compatible API' ? 'OpenAI-compatible' : title;
}

function Chip({
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
    <label class={selected ? 'chip selected' : 'chip'}>
      <input type="radio" name="provider" value={id} checked={selected} onChange={onSelect} />
      {title}
    </label>
  );
}

export function ProviderPicker({ settings }: { settings: Settings }) {
  const { change } = useSettingsApi();
  const { provider } = settings;
  const subtitle = PROVIDERS.find((item) => item.id === provider)?.subtitle;
  const cli = PROVIDERS.filter((item) => isCli(item.id));
  const api = PROVIDERS.filter((item) => !isCli(item.id));

  return (
    <section class="card" aria-labelledby="pp-h">
      <h2 id="pp-h" class="sr">
        AI provider
      </h2>
      <div role="radiogroup" aria-labelledby="pp-h">
        <p class="pgroup-label">Your subscription · via the bridge</p>
        <div class="chips">
          {cli.map((item) => (
            <Chip
              key={item.id}
              id={item.id}
              title={chipTitle(item.title)}
              selected={item.id === provider}
              onSelect={() => change({ provider: item.id })}
            />
          ))}
        </div>
        <p class="pgroup-label">API</p>
        <div class="chips two">
          {api.map((item) => (
            <Chip
              key={item.id}
              id={item.id}
              title={chipTitle(item.title)}
              selected={item.id === provider}
              onSelect={() => change({ provider: item.id })}
            />
          ))}
        </div>
      </div>
      <p class="psub">{subtitle}</p>
    </section>
  );
}
