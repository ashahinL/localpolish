import { createChatInsert } from '../content/chatInsert';
import { createSelectionChat } from '../content/selectionChat';
import { createButton } from '../content/button';
import { createController } from '../content/controller';
import { createIdleFix } from '../content/idle';
// Kept apart so it is erased: WXT loads this file without main() to read its options,
// and an inline `type` import would still pull in the controller and its CSS.
import type { PortLike } from '../content/controller';
import { captureTarget, deepActiveElement, focusedEditable } from '../content/editable';
import { guarded } from '../content/guard';
import type { DetectFn } from '../content/language';
import { frameHosts } from '../content/site';
import { showToast } from '../content/ui/toast';
import { REWRITE_PORT, type PageSettings } from '../core/messages';
import { DEFAULT_SETTINGS, isBlocked, pageSettings } from '../core/settings';

interface ContentChrome {
  i18n: { detectLanguage: DetectFn };
  runtime: {
    id?: string;
    connect(info: { name: string }): PortLike;
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(
        cb: (message: unknown, sender: { id?: string }, reply: (value: unknown) => void) => void,
      ): void;
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
  createChatInsert(ext);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  // Null until loaded, so the button never flashes on a blocklisted site.
  let settings: PageSettings | null = null;
  let idle: ReturnType<typeof createIdleFix> | undefined = undefined;
  let button: ReturnType<typeof createButton> | undefined = undefined;
  let settingsGeneration = 0;

  const applySettings = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) return false;
    const raw = value as Partial<PageSettings>;
    const normalized = pageSettings(raw);
    if (
      !Array.isArray(raw.blocklist) ||
      raw.blocklist.some((entry) => typeof entry !== 'string') ||
      raw.idleFix !== normalized.idleFix ||
      raw.selectionChat !== normalized.selectionChat ||
      raw.defaultMode !== normalized.defaultMode ||
      typeof raw.languages !== 'object' ||
      raw.languages === null ||
      Array.isArray(raw.languages) ||
      Object.keys(raw.languages).length !== Object.keys(normalized.languages).length ||
      Object.entries(normalized.languages).some(
        ([id, enabled]) => raw.languages?.[id as keyof typeof normalized.languages] !== enabled,
      )
    )
      return false;
    settings = normalized;
    idle?.refresh();
    button?.refresh();
    selectionChat?.refresh();
    return true;
  };

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
    languages: () => (settings ?? DEFAULT_SETTINGS).languages,
    detect: (text) => ext.i18n.detectLanguage(text),
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

  const selectionChat = createSelectionChat(
    ext,
    () => settings?.selectionChat === true && isEnabled(),
  );

  ext.runtime.onMessage.addListener(
    guarded((message) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: unknown }).type === 'page-settings-changed'
      ) {
        if (applySettings((message as { settings?: unknown }).settings)) settingsGeneration += 1;
        return;
      }
      if (!isOpenPopup(message) || !document.hasFocus()) return;
      const active = deepActiveElement();
      if (active instanceof HTMLIFrameElement || active instanceof HTMLFrameElement) return;
      const target = captureTarget({ wholeFieldIfEmpty: true });
      if (target) idle?.open(target);
      else if (focusedEditable()) showToast('Type some text first.');
      else showToast('Click into a text field first.');
    }),
  );

  const initialGeneration = settingsGeneration;
  void ext.runtime.sendMessage({ type: 'page-settings' }).then(
    (loaded) => {
      if (settingsGeneration === initialGeneration) applySettings(loaded);
    },
    () => {},
  );
}

function isOpenPopup(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'open-popup'
  );
}
