import type { PageSettings } from '../core/messages';
import { DEFAULT_SETTINGS } from '../core/settings';
import { createButton } from './button';
import { createController, type PortLike } from './controller';
import { captureTarget, deepActiveElement, focusedEditable } from './editable';
import { createIdleFix } from './idle';
import type { DetectFn } from './language';
import { showToast } from './ui/toast';

export interface FixDeps {
  connect(): PortLike;
  settings(): PageSettings | null; // null until loaded
  isEnabled(): boolean; // floating button
  isIdleEnabled(): boolean; // Fix while I type
  detect: DetectFn;
  isMac: boolean;
  accepts?(el: HTMLElement): boolean; // which fields Fix may act on; default: all
}

export interface FixHandle {
  refresh(): void; // calls idle.refresh() and button.refresh()
  openFromShortcut(): void; // what the open-popup message does today
}

export function startFix(deps: FixDeps): FixHandle {
  let idle: ReturnType<typeof createIdleFix> | undefined = undefined;

  const controller = createController({
    connect: deps.connect,
    getSettings: () => deps.settings() ?? DEFAULT_SETTINGS,
    isMac: deps.isMac,
    onAccepted: (target) => idle?.accepted(target),
  });

  idle = createIdleFix({
    connect: deps.connect,
    isEnabled: deps.isIdleEnabled,
    languages: () => (deps.settings() ?? DEFAULT_SETTINGS).languages,
    detect: deps.detect,
    isPopupOpen: controller.isOpen,
    isFixDefault: () => (deps.settings() ?? DEFAULT_SETTINGS).defaultMode === 'fix',
    openPopup: controller.open,
    accepts: deps.accepts,
  });

  const button = createButton({
    isMac: deps.isMac,
    isEnabled: deps.isEnabled,
    isPopupOpen: controller.isOpen,
    accepts: deps.accepts,
    onActivate() {
      const target = captureTarget({ wholeFieldIfEmpty: false });
      if (target) idle?.open(target);
    },
  });

  return {
    refresh() {
      idle?.refresh();
      button.refresh();
    },
    openFromShortcut() {
      if (!document.hasFocus()) return;
      const active = deepActiveElement();
      if (active instanceof HTMLIFrameElement || active instanceof HTMLFrameElement) return;
      const focused = focusedEditable();
      if (deps.accepts && focused && !deps.accepts(focused)) {
        showToast('Click into a text field first.');
        return;
      }
      const target = captureTarget({ wholeFieldIfEmpty: true });
      if (target) idle?.open(target);
      else if (focusedEditable()) showToast('Type some text first.');
      else showToast('Click into a text field first.');
    },
  };
}
