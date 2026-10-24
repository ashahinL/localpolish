import { useEffect, useState } from 'preact/hooks';
import { isCli } from '../options/ProviderSection';
import { SettingsContext, useSettings, useSettingsApi } from '../options/useSettings';
import { activeTabUrl } from './chrome';
import { Header } from './Header';
import { Hero } from './Hero';
import { HomeTab } from './HomeTab';
import { MoreTab } from './MoreTab';
import { ProviderTab } from './ProviderTab';
import { hostOf } from './sites';
import { SitesTab } from './SitesTab';
import { Tabs, type TabId } from './Tabs';
import { useBridge } from './useBridge';
import { useChatTarget } from './useChat';
import { useTest } from './useTest';

export function App() {
  const api = useSettings();
  return (
    <SettingsContext.Provider value={api}>
      <PopupApp />
    </SettingsContext.Provider>
  );
}

function PopupApp() {
  const { settings, loadError } = useSettingsApi();
  const bridge = useBridge(settings?.provider);
  const test = useTest();
  const chat = useChatTarget();
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
    <div class="popup">
      <Header />
      {settings && (
        <>
          <Hero
            settings={settings}
            bridge={bridge}
            test={test}
            chat={chat}
            full={tab !== 'provider'}
            onOpenProvider={() => setTab('provider')}
          />
          <Tabs
            active={tab}
            onChange={setTab}
            alert={isCli(settings.provider) && bridge.status?.ok === false ? 'provider' : undefined}
          />
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
        {settings && tab === 'home' && <HomeTab settings={settings} target={chat.target} />}
        {settings && tab === 'provider' && (
          <ProviderTab settings={settings} bridge={bridge} test={test} />
        )}
        {settings && tab === 'sites' && <SitesTab settings={settings} host={host} />}
        {settings && tab === 'more' && <MoreTab />}
      </main>
    </div>
  );
}
