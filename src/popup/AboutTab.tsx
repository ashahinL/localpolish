import { useEffect, useState } from 'preact/hooks';
import { openShortcutsPage, polishShortcut } from '../options/chrome';
import { shortcutKeys } from '../options/form';
import { extensionVersion, openOptionsPage } from './chrome';
import { ExternalIcon } from './icons';

export function AboutTab() {
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
    <>
      <section class="card stack" aria-labelledby="sc-h">
        <div class="srow">
          <div class="t">
            <b id="sc-h">Polish shortcut</b>
            <span>Select text in a field, then press</span>
          </div>
          <span class="keys" aria-label="Current shortcut">
            {shortcut === null ? null : keys.length === 0 ? (
              <span class="muted">Not set</span>
            ) : (
              keys.map((key, index) => <kbd key={index}>{key}</kbd>)
            )}
          </span>
        </div>
        <button type="button" class="wide-btn" onClick={openShortcutsPage}>
          Change shortcut <ExternalIcon />
        </button>
        <p class="help center">Opens chrome://extensions/shortcuts</p>
      </section>
      <section class="card">
        <div class="srow">
          <div class="t">
            <b>All options</b>
            <span>The full options page, same settings</span>
          </div>
          <button type="button" onClick={openOptionsPage}>
            Open <ExternalIcon />
          </button>
        </div>
      </section>
      <section class="card stack">
        <div class="ctitle">
          <h2>How it works</h2>
        </div>
        <p class="help works">
          Select text and press the shortcut, or click the LocalPolish button next to a field. With{' '}
          <b>Fix while I type</b> on, a field is fixed after a 3 s pause and you accept or undo the
          change. You can turn languages off for Fix while I type in the Home tab and in Options.
        </p>
      </section>
      <p class="foot">LocalPolish {extensionVersion()}</p>
    </>
  );
}
