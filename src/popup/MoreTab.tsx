import { useEffect, useState } from 'preact/hooks';
import { openShortcutsPage, polishShortcut } from '../options/chrome';
import { shortcutKeys } from '../options/form';
import { UsageSection } from '../usage/UsageSection';
import { extensionVersion, openOptionsPage } from './chrome';

export function MoreTab() {
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
      <section class="sec" aria-label="Shortcut and options">
        <div class="srow">
          <div class="t">
            <b>Polish shortcut</b>
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
        <OpenRow
          id="shortcuts"
          title="Change shortcut"
          text="Opens Chrome's shortcut settings"
          onOpen={openShortcutsPage}
        />
        <OpenRow
          id="options"
          title="All options"
          text="The full settings page"
          onOpen={openOptionsPage}
        />
      </section>
      <UsageSection />
      <section class="sec">
        <p class="help">LocalPolish {extensionVersion()}</p>
      </section>
    </>
  );
}

function OpenRow({
  id,
  title,
  text,
  onOpen,
}: {
  id: string;
  title: string;
  text: string;
  onOpen(): void;
}) {
  return (
    <div class="srow">
      <div class="t">
        <b id={`${id}-title`}>{title}</b>
        <span id={`${id}-text`}>{text}</span>
      </div>
      <button
        type="button"
        id={`${id}-open`}
        aria-labelledby={`${id}-open ${id}-title`}
        aria-describedby={`${id}-text`}
        onClick={onOpen}
      >
        Open
      </button>
    </div>
  );
}
