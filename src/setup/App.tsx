import { type ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { type Settings } from '../core/settings';
import { isCli } from '../options/ProviderSection';
import { SettingsContext, useSettings, useSettingsApi } from '../options/useSettings';
import { BridgeCard } from '../popup/BridgeCard';
import { Header } from '../popup/Header';
import { BoltIcon } from '../popup/icons';
import { ProviderPicker } from '../popup/ProviderPicker';
import { ProviderDetails } from '../popup/ProviderTab';
import { providerSummary } from '../popup/summary';
import { Switch } from '../popup/Switch';
import { TestConnection } from '../popup/TestConnection';
import { useBridge } from '../popup/useBridge';
import { useTest } from '../popup/useTest';
import { closeThisTab } from './chrome';
import { destination } from './destination';

export function App() {
  const api = useSettings();
  return (
    <SettingsContext.Provider value={api}>
      <SetupApp />
    </SettingsContext.Provider>
  );
}

function SetupApp() {
  const { settings, loadError } = useSettingsApi();
  return (
    <div class="setup">
      <Header />
      <main class="setup-body">
        <div class="setup-intro">
          <h1>Set up LocalPolish</h1>
          <p class="help">
            Three short steps. You can change all of this later in the toolbar popup.
          </p>
        </div>
        {loadError && <p class="note note-error">Could not load settings: {loadError}</p>}
        {!settings && !loadError && <p class="muted">Loading…</p>}
        {settings && <Steps settings={settings} />}
      </main>
    </div>
  );
}

function Steps({ settings }: { settings: Settings }) {
  const bridge = useBridge(settings.provider);
  const test = useTest();
  const { title } = providerSummary(settings);

  return (
    <>
      <Step n={1} title="Pick a provider">
        <ProviderPicker settings={settings} />
        <ProviderDetails settings={settings} />
        {isCli(settings.provider) && <BridgeCard bridge={bridge} />}
      </Step>
      <Step n={2} title="Test it">
        <section class="card stack" aria-label="Test connection">
          <p class="help">Runs a tiny Fix with {title} on a fixed sample, never your own text.</p>
          <TestConnection test={test} wide />
        </section>
      </Step>
      <Step n={3} title="Fix while I type">
        <IdleCard settings={settings} />
      </Step>
      <DoneRow />
    </>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ComponentChildren }) {
  return (
    <section class="step" aria-labelledby={`step-${n}`}>
      <h2 class="step-head" id={`step-${n}`}>
        <span class="step-n" aria-hidden="true">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function IdleCard({ settings }: { settings: Settings }) {
  const { change } = useSettingsApi();
  return (
    <section class="card stack" aria-label="Fix while I type">
      <div class="qrow">
        <span class="qicon" aria-hidden="true">
          <BoltIcon />
        </span>
        <div class="qtxt">
          <b id="idle-title">Fix while I type</b>
          <span id="idle-desc">
            {settings.idleFix
              ? 'Fixes a message box after a 3 s pause and marks what it changed.'
              : 'Off. The button and the shortcut still work.'}
          </span>
        </div>
        <Switch
          checked={settings.idleFix}
          labelId="idle-title"
          descId="idle-desc"
          onToggle={() => change({ idleFix: !settings.idleFix })}
        />
      </div>
      <p class="help">{destination(settings)}</p>
    </section>
  );
}

function DoneRow() {
  const { flush } = useSettingsApi();
  const [closing, setClosing] = useState(false);

  const done = async (): Promise<void> => {
    setClosing(true);
    try {
      // A failed save keeps the page open, and the header shows why.
      if (await flush()) await closeThisTab();
    } finally {
      setClosing(false);
    }
  };

  return (
    <div class="setup-done">
      <button type="button" class="primary" disabled={closing} onClick={() => void done()}>
        Done
      </button>
    </div>
  );
}
