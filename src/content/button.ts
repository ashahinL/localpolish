import { h, render } from 'preact';
import { fieldFocusCaret, focusCaret } from './caret';
import { deepActiveElement, findEditable } from './editable';
import { guarded } from './guard';
import { placeButton } from './position';
import { FloatingButton } from './ui/FloatingButton';
import { layer } from './ui/root';

export interface ButtonDeps {
  isMac: boolean;
  isEnabled(): boolean;
  isPopupOpen(): boolean;
  onActivate(): void;
  accepts?(el: HTMLElement): boolean;
}

const DEBOUNCE_MS = 150;

export function createButton(deps: ButtonDeps): { refresh(): void } {
  const title = `LocalPolish (${deps.isMac ? '⌘⇧K' : 'Ctrl+Shift+K'})`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown = false;

  function wantedField(): HTMLElement | null {
    if (!deps.isEnabled() || deps.isPopupOpen()) return null;
    const field = selectedEditable();
    if (!field || deps.accepts?.(field) === false) return null;
    return field;
  }

  function hide(): void {
    clearTimeout(timer);
    if (!shown) return;
    shown = false;
    render(null, layer('button'));
  }

  function update(): void {
    const field = wantedField();
    if (!field) {
      hide();
      return;
    }
    const caret =
      field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
        ? fieldFocusCaret(field)
        : focusCaret();
    if (!caret) {
      hide();
      return;
    }
    shown = true;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    render(
      h(FloatingButton, {
        point: placeButton(caret, viewport),
        title,
        onActivate: guarded(() => {
          hide();
          deps.onActivate();
        }),
      }),
      layer('button'),
    );
  }

  document.addEventListener(
    'selectionchange',
    guarded(() => {
      if (!wantedField()) {
        hide();
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(guarded(update), DEBOUNCE_MS);
    }),
  );
  window.addEventListener('scroll', guarded(hide), { capture: true, passive: true });
  window.addEventListener('resize', guarded(hide), { passive: true });
  return { refresh: update };
}

function selectedEditable(): HTMLElement | null {
  const field = findEditable(deepActiveElement());
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    if (field.selectionStart === null || field.selectionStart === field.selectionEnd) return null;
    return field;
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const host = findEditable(selection.anchorNode);
  if (
    !host ||
    host instanceof HTMLInputElement ||
    host instanceof HTMLTextAreaElement ||
    !host.isContentEditable
  ) {
    return null;
  }
  return host;
}
