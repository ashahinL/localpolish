export type TabId = 'home' | 'provider' | 'sites' | 'about';

const TABS: { id: TabId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'provider', label: 'Provider' },
  { id: 'sites', label: 'Sites' },
  { id: 'about', label: 'About' },
];

interface TabsProps {
  active: TabId;
  onChange(tab: TabId): void;
  alert?: TabId;
}

export function Tabs({ active, onChange, alert }: TabsProps) {
  const onKeyDown = (event: KeyboardEvent) => {
    const index = TABS.findIndex((tab) => tab.id === active);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    const tab = next < 0 ? undefined : TABS[next];
    if (tab === undefined) return;
    event.preventDefault();
    onChange(tab.id);
    document.getElementById(`tab-${tab.id}`)?.focus();
  };

  return (
    <nav class="tabs" role="tablist" aria-label="Popup sections" onKeyDown={onKeyDown}>
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          class="tab"
          role="tab"
          id={`tab-${tab.id}`}
          aria-controls="panel"
          aria-selected={active === tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {alert === tab.id && (
            <>
              <span class="bad" aria-hidden="true" />
              <span class="sr">, needs attention</span>
            </>
          )}
        </button>
      ))}
    </nav>
  );
}
