import { type DefaultMode, type Settings } from '../core/settings';
import { isCli } from '../options/ProviderSection';
import { useSettingsApi } from '../options/useSettings';
import { UsageSection } from '../usage/UsageSection';
import { BridgeErrorNote } from './BridgeErrorNote';
import { connection, providerSummary, type Connection } from './summary';
import { TestConnection } from './TestConnection';
import { type BridgeState } from './useBridge';
import { type TestState } from './useTest';

const MODES: { value: DefaultMode; label: string; title?: string }[] = [
  { value: 'fix', label: 'Fix' },
  { value: 'rephrase', label: 'Rephrase', title: 'Rephrase (keep tone)' },
  { value: 'shorter', label: 'Shorter' },
];

const MODE_HELP: Record<DefaultMode, string> = {
  fix: 'Corrects spelling and grammar, keeps your words.',
  rephrase: 'Rewrites for clarity and keeps your tone.',
  shorter: 'Trims the text and keeps the meaning.',
};

interface HomeTabProps {
  settings: Settings;
  bridge: BridgeState;
  test: TestState;
  onOpenProvider(): void;
}

function pillClass(tone: Connection['tone']): string {
  if (tone === 'ok') return 'pill ok';
  if (tone === 'error') return 'pill err';
  return 'pill';
}

export function HomeTab({ settings, bridge, test, onOpenProvider }: HomeTabProps) {
  const { change } = useSettingsApi();
  const summary = providerSummary(settings);
  const link = connection(settings, bridge.status);
  const status = bridge.status;

  return (
    <>
      <section class="card stack" aria-labelledby="status-h">
        <div class="ctitle">
          <h2 id="status-h">Using</h2>
          <span class={pillClass(link.tone)}>
            <span class="dot" aria-hidden="true" />
            {link.label}
          </span>
        </div>
        <div class="prov-line">
          <span class="pmark" aria-hidden="true">
            {summary.mark}
          </span>
          <div class="t">
            <b>{summary.title}</b>
            <span>{summary.detail}</span>
          </div>
          <button type="button" class="link" onClick={onOpenProvider}>
            Change
          </button>
        </div>
        {isCli(settings.provider) && status?.ok === false && (
          <BridgeErrorNote message={status.message} />
        )}
        <TestConnection test={test} />
      </section>
      <section class="card stack" aria-labelledby="mode-h">
        <div class="ctitle">
          <h2 id="mode-h">Default mode</h2>
        </div>
        <div class="seg" role="radiogroup" aria-labelledby="mode-h">
          {MODES.map((mode) => {
            const on = settings.defaultMode === mode.value;
            return (
              <label key={mode.value} class={on ? 'on' : undefined} title={mode.title}>
                <input
                  type="radio"
                  name="default-mode"
                  value={mode.value}
                  checked={on}
                  onChange={() => change({ defaultMode: mode.value })}
                />
                {mode.label}
              </label>
            );
          })}
        </div>
        <p class="help">{MODE_HELP[settings.defaultMode]}</p>
      </section>
      <UsageSection />
    </>
  );
}
