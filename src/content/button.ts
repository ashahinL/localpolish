import { h, render } from 'preact';
import { findEditable } from './editable';
import { guarded } from './guard';
import { placeButton, type Rect } from './position';
import { FloatingButton } from './ui/FloatingButton';
import { layer } from './ui/root';

export interface ButtonDeps {
  isMac: boolean;
  isEnabled(): boolean;
  isPopupOpen(): boolean;
  onActivate(): void;
}

interface SelectionAnchor {
  kind: 'field' | 'rich';
  rect: Rect;
}

const DEBOUNCE_MS = 150;

export function createButton(deps: ButtonDeps): void {
  const title = `LocalPolish (${deps.isMac ? '⌘⇧K' : 'Ctrl+Shift+K'})`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown = false;

  function wanted(): SelectionAnchor | null {
    if (!deps.isEnabled() || deps.isPopupOpen()) return null;
    return selectionAnchor();
  }

  function hide(): void {
    clearTimeout(timer);
    if (!shown) return;
    shown = false;
    render(null, layer('button'));
  }

  function update(): void {
    const anchor = wanted();
    if (!anchor) {
      hide();
      return;
    }
    shown = true;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    render(
      h(FloatingButton, {
        point: placeButton(anchor.rect, anchor.kind, viewport),
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
      if (!wanted()) {
        hide();
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(guarded(update), DEBOUNCE_MS);
    }),
  );
  window.addEventListener('scroll', guarded(hide), { capture: true, passive: true });
  window.addEventListener('resize', guarded(hide), { passive: true });
}

function selectionAnchor(): SelectionAnchor | null {
  const field = findEditable(deepActiveElement());
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    if (field.selectionStart === null || field.selectionStart === field.selectionEnd) return null;
    return { kind: 'field', rect: field.getBoundingClientRect() };
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
  return { kind: 'rich', rect: selection.getRangeAt(0).getBoundingClientRect() };
}

function deepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}
