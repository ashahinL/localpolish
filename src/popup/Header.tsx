import { useEffect, useState } from 'preact/hooks';
import { useSettingsApi } from '../options/useSettings';
import { openOptionsPage } from './chrome';
import { CheckIcon, GearIcon, LogoIcon } from './icons';
import { Tooltip } from './Tooltip';

const SAVED_VISIBLE_MS = 1500;

export function Header() {
  const { status } = useSettingsApi();
  const [savedVisible, setSavedVisible] = useState(false);

  useEffect(() => {
    if (status.kind !== 'saved') return;
    setSavedVisible(true);
    const timer = setTimeout(() => setSavedVisible(false), SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const savedOn = savedVisible && status.kind === 'saved';

  return (
    <>
      <header class="head">
        <div class="logo" aria-hidden="true">
          <LogoIcon />
        </div>
        <div class="brand">
          <Tooltip id="brand-tip" text="Fix and rewrite text in any field">
            <b tabIndex={0} aria-describedby="brand-tip">
              LocalPolish
            </b>
          </Tooltip>
        </div>
        <span class={savedOn ? 'saved on' : 'saved'} role="status">
          <CheckIcon />
          Saved
        </span>
        <button
          type="button"
          class="icon-btn"
          aria-label="Open the full options page"
          title="All options"
          onClick={openOptionsPage}
        >
          <GearIcon />
        </button>
      </header>
      {status.kind === 'error' && (
        <p class="save-error" role="alert">
          Could not save: {status.message}
        </p>
      )}
    </>
  );
}
