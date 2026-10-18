import { useState } from 'preact/hooks';
import { type Settings } from '../core/settings';
import { useSettingsApi } from '../options/useSettings';
import { CloseIcon } from './icons';
import { addSite, hideSite, siteState } from './sites';

interface SitesTabProps {
  settings: Settings;
  host: string | null | undefined;
}

function siteLetter(host: string): string {
  const bare = host.toLowerCase().startsWith('www.') ? host.slice(4) : host;
  return bare.charAt(0).toUpperCase();
}

export function SitesTab({ settings, host }: SitesTabProps) {
  const { change } = useSettingsApi();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { blocklist } = settings;
  const count = blocklist.length;
  const current = typeof host === 'string' ? host : null;

  return (
    <>
      <section class="card stack" aria-labelledby="sites-h">
        <div class="ctitle">
          <h2 id="sites-h">Button hidden on</h2>
          <span class="muted sites-count">{count === 1 ? '1 site' : `${count} sites`}</span>
        </div>
        {count === 0 ? (
          <p class="empty">No sites yet. The button shows everywhere.</p>
        ) : (
          <ul class="sites" aria-labelledby="sites-h">
            {blocklist.map((entry, index) => (
              <li key={index}>
                <span class="host">{entry}</span>
                {current !== null && entry.trim().toLowerCase() === current && (
                  <span class="tag">This tab</span>
                )}
                <button
                  type="button"
                  class="x"
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
          class="inline"
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
      {current !== null && siteState(current, blocklist).kind === 'shown' && (
        <button
          type="button"
          class="card site-cta"
          onClick={() => change({ blocklist: hideSite(current, blocklist) })}
        >
          <span class="qicon site" aria-hidden="true">
            {siteLetter(current)}
          </span>
          <span class="site-cta-copy">
            <b>Hide on {current}</b>
            <span class="help">Adds this tab's site to the list</span>
          </span>
        </button>
      )}
    </>
  );
}
