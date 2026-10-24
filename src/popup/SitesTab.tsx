import { useState } from 'preact/hooks';
import { type Settings } from '../core/settings';
import { useSettingsApi } from '../options/useSettings';
import { CloseIcon } from './icons';
import { QuickToggles } from './QuickToggles';
import { addSite } from './sites';

interface SitesTabProps {
  settings: Settings;
  host: string | null | undefined;
}

function hiddenHeading(count: number): string {
  if (count === 0) return 'No sites hidden';
  return count === 1 ? 'Hidden on 1 site' : `Hidden on ${count} sites`;
}

export function SitesTab({ settings, host }: SitesTabProps) {
  const { change } = useSettingsApi();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { blocklist } = settings;
  const count = blocklist.length;
  const current = typeof host === 'string' ? host : null;

  const showHidden = () => {
    document.getElementById('sites-h')?.scrollIntoView({ block: 'start' });
    document.getElementById('add-site')?.focus({ preventScroll: true });
  };

  return (
    <>
      <QuickToggles settings={settings} host={host} onOpenSites={showHidden} />
      <section class="sec" aria-labelledby="sites-h">
        <h2 id="sites-h">{hiddenHeading(count)}</h2>
        {count === 0 ? (
          <p class="help">
            No sites yet. The button and Fix while I type are allowed on every site.
          </p>
        ) : (
          <ul class="site-list" aria-labelledby="sites-h">
            {blocklist.map((entry, index) => (
              <li key={index}>
                <span class="host">{entry}</span>
                {current !== null && entry.trim().toLowerCase() === current && (
                  <span class="tag">This tab</span>
                )}
                <button
                  type="button"
                  class="icon-btn"
                  aria-label={`Remove ${entry}`}
                  onClick={() => change({ blocklist: blocklist.filter((_, i) => i !== index) })}
                >
                  <CloseIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          class="add"
          onSubmit={(event) => {
            event.preventDefault();
            const result = addSite(draft, blocklist);
            if ('error' in result) {
              setError(result.error);
              return;
            }
            change({ blocklist: result.list });
            setDraft('');
            setError(null);
          }}
        >
          <label class="sr" for="add-site">
            Add a site
          </label>
          <input
            id="add-site"
            placeholder="example.com"
            autocomplete="off"
            spellcheck={false}
            value={draft}
            onInput={(event) => {
              setDraft(event.currentTarget.value);
              setError(null);
            }}
          />
          <button type="submit">Add</button>
        </form>
        {error !== null && (
          <p class="help field-error" role="alert">
            {error}
          </p>
        )}
        <p class="help">
          Subdomains are included. The button and the idle Fix stay off on these sites; the shortcut
          still works.
        </p>
      </section>
    </>
  );
}
