import { createButton } from '../content/button';
import { createController } from '../content/controller';
import { createIdleFix } from '../content/idle';
// Kept apart so it is erased: WXT loads this file without main() to read its options,
// and an inline `type` import would still pull in the controller and its CSS.
import type { PortLike } from '../content/controller';
import { captureTarget, deepActiveElement, focusedEditable } from '../content/editable';
import { guarded } from '../content/guard';
import { frameHosts } from '../content/site';
import { showToast } from '../content/ui/toast';
import { REWRITE_PORT } from '../core/messages';
import { DEFAULT_SETTINGS, isBlocked, loadSettings, type Settings } from '../core/settings';

interface ContentChrome {
  runtime: {
    id?: string;
    connect(info: { name: string }): PortLike;
    onMessage: { addListener(cb: (message: unknown) => void): void };
  };
  storage: {
    onChanged: {
      addListener(cb: (changes: Record<string, unknown>, areaName: string) => void): void;
    };
  };
}

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  runAt: 'document_idle',
  main() {
    try {
      start();
    } catch (error) {
      console.warn('LocalPolish could not start:', error);
    }
  },
});

function start(): void {
  const ext = (globalThis as unknown as { chrome: ContentChrome }).chrome;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  // Null until loaded, so the button never flashes on a blocklisted site.
  let settings: Settings | null = null;
  let idle: ReturnType<typeof createIdleFix> | undefined = undefined;
  let button: ReturnType<typeof createButton> | undefined = undefined;

  const refresh = () => {
    loadSettings().then(
      (loaded) => {
        settings = loaded;
        idle?.refresh();
        button?.refresh();
      },
      () => {},
    );
  };
  refresh();
  ext.storage.onChanged.addListener(
    guarded((changes, areaName) => {
      if (areaName === 'local' && 'settings' in changes) refresh();
    }),
  );

  const connect = (): PortLike => {
    // runtime.id disappears once the extension reloads and this script is orphaned.
    if (!ext.runtime?.id) throw new Error('Extension context invalidated');
    return ext.runtime.connect({ name: REWRITE_PORT });
  };
  const hosts = () => frameHosts(location.hostname, Array.from(location.ancestorOrigins ?? []));
  const isEnabled = (): boolean => {
    if (settings === null) return false;
    const blocklist = settings.blocklist;
    if (blocklist.length === 0) return true;
    const frameHosts = hosts();
    return frameHosts !== null && !frameHosts.some((host) => isBlocked(host, blocklist));
  };
  const isIdleEnabled = (): boolean => settings !== null && settings.idleFix && isEnabled();

  const controller = createController({
    connect,
    getSettings: () => settings ?? DEFAULT_SETTINGS,
    isMac,
    onAccepted: (target) => idle?.accepted(target),
  });

  idle = createIdleFix({
    connect,
    isEnabled: isIdleEnabled,
    isPopupOpen: controller.isOpen,
    isFixDefault: () => (settings ?? DEFAULT_SETTINGS).defaultMode === 'fix',
    openPopup: controller.open,
  });

  button = createButton({
    isMac,
    isEnabled,
    isPopupOpen: controller.isOpen,
    onActivate() {
      const target = captureTarget({ wholeFieldIfEmpty: false });
      if (target) idle?.open(target);
    },
  });

  ext.runtime.onMessage.addListener(
    guarded((message) => {
      if (!isOpenPopup(message) || !document.hasFocus()) return;
      const active = deepActiveElement();
      if (active instanceof HTMLIFrameElement || active instanceof HTMLFrameElement) return;
      const target = captureTarget({ wholeFieldIfEmpty: true });
      if (target) idle?.open(target);
      else if (focusedEditable()) showToast('Type some text first.');
      else showToast('Click into a text field first.');
    }),
  );
}

function isOpenPopup(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'open-popup'
  );
}
