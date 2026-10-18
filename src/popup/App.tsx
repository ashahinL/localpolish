import { useEffect, useState } from 'preact/hooks';
import { SettingsContext, useSettings } from '../options/useSettings';
import { activeTabUrl } from './chrome';
import { Header } from './Header';
import { hostOf } from './sites';
import { QuickToggles } from './QuickToggles';
import { Tabs, type TabId } from './Tabs';

export function App() {
  const api = useSettings();
  const { settings, loadError } = api;
  const [tab, setTab] = useState<TabId>('home');
  const [host, setHost] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    activeTabUrl().then(
      (url) => {
        if (alive) setHost(hostOf(url));
      },
      () => {
        if (alive) setHost(null);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SettingsContext.Provider value={api}>
      <div class="popup">
        <Header />
        {settings && (
          <>
            <QuickToggles settings={settings} host={host} onOpenSites={() => setTab('sites')} />
            <Tabs active={tab} onChange={setTab} />
          </>
        )}
        <main
          class="panel"
          id="panel"
          // Preact's type for <main> only allows role "main". This panel is the tabpanel.
          role={'tabpanel' as unknown as 'main'}
          aria-labelledby={`tab-${tab}`}
          key={tab}
        >
          {loadError && <p class="note note-error">Could not load settings: {loadError}</p>}
          {!settings && !loadError && <p class="muted">Loading…</p>}
        </main>
      </div>
    </SettingsContext.Provider>
  );
}
