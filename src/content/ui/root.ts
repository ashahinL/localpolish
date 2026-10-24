import css from './popup.css?inline';

type Layer = 'button' | 'chat-button' | 'popup' | 'toast' | 'marks';

let shadow: ShadowRoot | null = null;
let compact = false;

/** Smaller type and buttons, for the side panel's documents. Web pages keep the full size. */
export function compactUi(): void {
  compact = true;
  shadow?.host.toggleAttribute('data-compact', true);
}

// A modal <dialog> draws above the page and makes the rest of it inert, so the UI must live inside it.
// The field's own dialog wins: the top-layer order is not the DOM order.
function mountPoint(): Element {
  const own = document.activeElement?.closest('dialog:modal');
  if (own) return own;
  const modals = document.querySelectorAll('dialog:modal');
  return modals[modals.length - 1] ?? document.documentElement;
}

export function shadowRoot(): ShadowRoot {
  if (!shadow?.host.isConnected) {
    const host = document.createElement('localpolish-root');
    host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647;';
    host.toggleAttribute('data-compact', compact);
    shadow = host.attachShadow({ mode: 'open' });
    // A page can reach this open shadow root and call .click() to start or retry rewrites.
    shadow.addEventListener('click', dropUntrusted, true);
    const style = document.createElement('style');
    style.textContent = css;
    shadow.append(style);
  }
  const parent = mountPoint();
  if (shadow.host.parentElement !== parent) parent.append(shadow.host);
  return shadow;
}

function dropUntrusted(event: Event): void {
  if (event.isTrusted) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

export function layer(name: Layer): HTMLElement {
  const root = shadowRoot();
  let el = root.querySelector<HTMLElement>(`[data-layer="${name}"]`);
  if (!el) {
    el = document.createElement('div');
    el.dataset.layer = name;
    root.append(el);
  }
  return el;
}

export function isInsideUi(event: Event): boolean {
  return shadow !== null && event.composedPath().includes(shadow.host);
}
