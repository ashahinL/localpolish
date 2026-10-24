import { useEffect, useState } from 'preact/hooks';
import { CheckIcon, LogoIcon } from '../popup/icons';
import { ProviderSection } from './ProviderSection';
import {
  BridgeSection,
  DefaultsSection,
  ShortcutSection,
  SitesSection,
  TestSection,
} from './sections';
import { UsageSection } from '../usage/UsageSection';
import { SettingsContext, useSettings, type SaveStatus } from './useSettings';

const SAVED_VISIBLE_MS = 1500;

export function App() {
  const api = useSettings();
  const { settings, loadError, status } = api;
  return (
    <SettingsContext.Provider value={api}>
      <main class="page">
        <header class="page-head">
          <div class="logo" aria-hidden="true">
            <LogoIcon />
          </div>
          <div class="brand">
            <h1>LocalPolish</h1>
            <p class="muted">Fix and rewrite text in any field, with the AI you already pay for.</p>
          </div>
          <StatusBadge status={status} />
        </header>
        {loadError && <p class="note note-error">Could not load settings: {loadError}</p>}
        {!settings && !loadError && <p class="muted">Loading…</p>}
        {settings && (
          <div class="sheet">
            <ProviderSection settings={settings} />
            <BridgeSection />
            <TestSection />
            <DefaultsSection settings={settings} />
            <UsageSection />
            <SitesSection settings={settings} />
            <ShortcutSection />
          </div>
        )}
      </main>
    </SettingsContext.Provider>
  );
}

function StatusBadge({ status }: { status: SaveStatus }) {
  const [savedVisible, setSavedVisible] = useState(false);

  useEffect(() => {
    if (status.kind !== 'saved') return;
    setSavedVisible(true);
    const timer = setTimeout(() => setSavedVisible(false), SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [status]);

  if (status.kind === 'error') {
    return (
      <div class="status status-error visible" role="alert">
        Could not save: {status.message}
      </div>
    );
  }
  return (
    <div class={`status${savedVisible ? ' visible' : ''}`} role="status">
      <CheckIcon />
      Saved
    </div>
  );
}
