import { useEffect, useState } from 'preact/hooks';
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
          <h1>LocalPolish</h1>
          <p class="muted">Fix and rewrite text in any field, with the AI you already pay for.</p>
        </header>
        <StatusBadge status={status} />
        {loadError && <p class="note note-error">Could not load settings: {loadError}</p>}
        {!settings && !loadError && <p class="muted">Loading…</p>}
        {settings && (
          <>
            <ProviderSection settings={settings} />
            <BridgeSection />
            <TestSection />
            <DefaultsSection settings={settings} />
            <UsageSection />
            <SitesSection settings={settings} />
            <ShortcutSection />
          </>
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
      Saved
    </div>
  );
}
