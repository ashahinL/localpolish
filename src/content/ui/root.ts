import css from './popup.css?inline';

type Layer = 'button' | 'popup' | 'toast';

let shadow: ShadowRoot | null = null;

// A modal <dialog> draws above the page and makes the rest of it inert, so the UI must live inside it.
function mountPoint(): Element {
  const modals = document.querySelectorAll('dialog:modal');
  return modals[modals.length - 1] ?? document.documentElement;
}

export function shadowRoot(): ShadowRoot {
  if (!shadow?.host.isConnected) {
    const host = document.createElement('localpolish-root');
    host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647;';
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
