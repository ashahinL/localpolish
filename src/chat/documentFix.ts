import type { PortLike } from '../content/controller';
import { startFix } from '../content/fix';
import type { DetectFn } from '../content/language';
import { REWRITE_PORT } from '../core/messages';
import { pageSettings } from '../core/settings';
import { onSettingsChanged, polishShortcut } from '../options/chrome';
import { matchesShortcut } from './shortcut';

interface DocumentChrome {
  i18n: { detectLanguage: DetectFn };
  runtime: {
    connect(info: { name: string }): PortLike;
    onMessage: {
      addListener(cb: (message: unknown) => void): void;
      removeListener(cb: (message: unknown) => void): void;
    };
  };
  storage: {
    local: {
      get(key: string): Promise<{ settings?: unknown }>;
    };
  };
}

function extension(): DocumentChrome {
  return (globalThis as unknown as { chrome: DocumentChrome }).chrome;
}

export async function startDocumentFix(accepts: (el: HTMLElement) => boolean): Promise<() => void> {
  const ext = extension();
  let settings = await readSettings();
  const fix = startFix({
    connect: () => ext.runtime.connect({ name: REWRITE_PORT }),
    settings: () => settings,
    isEnabled: () => true,
    isIdleEnabled: () => settings.idleFix,
    detect: (text) => ext.i18n.detectLanguage(text),
    isMac: /Mac|iPhone|iPad/.test(navigator.platform),
    accepts,
  });

  const stopSettings = onSettingsChanged(() => {
    void readSettings().then((loaded) => {
      settings = loaded;
      fix.refresh();
    });
  });

  const onMessage = (message: unknown): void => {
    if (isOpenPopup(message)) fix.openFromShortcut();
  };
  ext.runtime.onMessage.addListener(onMessage);

  const shortcut = await polishShortcut();
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!matchesShortcut(shortcut, event)) return;
    event.preventDefault();
    fix.openFromShortcut();
  };
  document.addEventListener('keydown', onKeyDown, true);

  // createController, createIdleFix and createButton add their own document listeners
  // and have no stop function. This removes only the listeners added here.
  return () => {
    stopSettings();
    ext.runtime.onMessage.removeListener(onMessage);
    document.removeEventListener('keydown', onKeyDown, true);
  };
}

async function readSettings() {
  return pageSettings((await extension().storage.local.get('settings')).settings);
}

function isOpenPopup(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'open-popup'
  );
}
