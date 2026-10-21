import { useEffect, useState } from 'preact/hooks';
import { type DefaultMode, type Settings } from '../core/settings';
import { useBridge } from '../popup/useBridge';
import { openShortcutsPage, polishShortcut } from './chrome';
import { useTest } from '../popup/useTest';
import { CodeLine, Field, Note, TextInput } from './controls';
import { formatSeconds, invalidSiteEntries, parseBlocklist, shortcutKeys } from './form';
import { isCli } from './ProviderSection';
import { useSettingsApi } from './useSettings';

export const CLIS: Array<{ key: 'claude' | 'codex' | 'grok' | 'agy'; name: string }> = [
  { key: 'claude', name: 'Claude Code' },
  { key: 'codex', name: 'Codex' },
  { key: 'grok', name: 'Grok CLI' },
  { key: 'agy', name: 'Antigravity CLI' },
];

const MODES: Array<{ value: DefaultMode; label: string }> = [
  { value: 'fix', label: 'Fix' },
  { value: 'rephrase', label: 'Rephrase (keep tone)' },
  { value: 'shorter', label: 'Shorter' },
];

export function BridgeSection() {
  const provider = useSettingsApi().settings?.provider;
  const { status, checking, check } = useBridge(provider);
  const cli = provider !== undefined && isCli(provider);

  return (
    <section class="card" aria-busy={checking}>
      <div class="card-head">
        <h2>Bridge</h2>
        <button type="button" class="secondary" disabled={checking} onClick={check}>
          Check again
        </button>
      </div>
      <p class="help">
        The bridge runs your own CLIs. Only Claude Code, Codex and Grok CLI need it.
      </p>
      {status === null && (checking || cli) && <p class="muted">Checking…</p>}
      {status === null && !checking && !cli && (
        <p class="muted">API providers do not need the bridge. Check again runs diagnostics.</p>
      )}
      {status?.ok === false && (
        <Note tone="error">
          <p>{status.message}</p>
          <p>Install it from the LocalPolish folder:</p>
          <CodeLine text="npm run bridge:install" />
        </Note>
      )}
      {status?.ok && (
        <ul class="clis">
          {CLIS.map(({ key, name }) => {
            const cli = status.clis[key];
            return (
              <li key={key}>
                <span class={`dot ${cli ? 'dot-on' : 'dot-off'}`} aria-hidden="true" />
                <span class="cli-name">{name}</span>
                <span class="muted">{cli ? cli.version : 'not found'}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function TestSection() {
  const { running, result, run } = useTest();

  return (
    <section class="card">
      <h2>Test connection</h2>
      <p class="help">Runs a tiny Fix with the provider above.</p>
      <div class="test-row">
        <button type="button" class="primary" disabled={running} onClick={() => void run()}>
          Test connection
        </button>
        {running && (
          <span class="muted testing" role="status">
            <span class="spinner" aria-hidden="true" />
            Testing…
          </span>
        )}
      </div>
      {result?.ok && (
        <Note tone="ok">
          Works. Got “{result.sample}” in {formatSeconds(result.ms)} s
        </Note>
      )}
      {result?.ok === false && <Note tone="error">{result.message}</Note>}
    </section>
  );
}

export function DefaultsSection({ settings }: { settings: Settings }) {
  const { change } = useSettingsApi();
  return (
    <section class="card">
      <h2>Defaults</h2>
      <div class="row">
        <Field id="default-mode" label="Default mode">
          <select
            id="default-mode"
            value={settings.defaultMode}
            onChange={(event) => change({ defaultMode: event.currentTarget.value as DefaultMode })}
          >
            {MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </Field>
        <div class="field">
          <label class="check-option" for="idle-fix">
            <input
              id="idle-fix"
              type="checkbox"
              checked={settings.idleFix}
              aria-describedby="idle-fix-help"
              onChange={() => change({ idleFix: !settings.idleFix })}
            />
            <span>Fix while I type</span>
          </label>
          <p class="help" id="idle-fix-help">
            Fixes a field after a 3 s pause. Off: the button and the shortcut still work.
          </p>
        </div>
      </div>
    </section>
  );
}

export function SitesSection({ settings }: { settings: Settings }) {
  const { change } = useSettingsApi();
  const invalid = invalidSiteEntries(settings.blocklist);
  return (
    <section class="card">
      <h2>Sites</h2>
      <Field
        id="blocklist"
        label="Hide LocalPolish on these sites"
        help="One hostname per line. The shortcut still works there."
      >
        <TextInput
          id="blocklist"
          multiline
          settingsKey="blocklist"
          value={settings.blocklist.join('\n')}
          placeholder={'mail.google.com\nexample.com'}
          onText={(text) => change({ blocklist: parseBlocklist(text) }, true)}
        />
      </Field>
      {invalid.length > 0 && <Note tone="info">Not a site, ignored: {invalid.join(', ')}</Note>}
    </section>
  );
}

export function ShortcutSection() {
  const [shortcut, setShortcut] = useState<string | null>(null);

  useEffect(() => {
    const read = () => void polishShortcut().then(setShortcut, () => setShortcut(''));
    read();
    // The user changes the shortcut on another tab, then comes back here.
    window.addEventListener('focus', read);
    return () => window.removeEventListener('focus', read);
  }, []);

  const keys = shortcutKeys(shortcut ?? '');
  return (
    <section class="card">
      <h2>Shortcut</h2>
      <p class="help">Select text in a field and press it to polish the text.</p>
      <div class="shortcut-row">
        <span class="keys" aria-label="Current shortcut">
          {shortcut === null ? null : keys.length === 0 ? (
            <span class="muted">Not set</span>
          ) : (
            keys.map((key, index) => <kbd key={index}>{key}</kbd>)
          )}
        </span>
        <button type="button" class="secondary" onClick={openShortcutsPage}>
          Change shortcut
        </button>
      </div>
    </section>
  );
}
