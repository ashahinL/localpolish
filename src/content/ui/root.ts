import css from './popup.css?inline';

type Layer = 'button' | 'popup' | 'toast';

let shadow: ShadowRoot | null = null;

export function shadowRoot(): ShadowRoot {
  if (shadow?.host.isConnected) return shadow;
  const host = document.createElement('localpolish-root');
  host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647;';
  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  shadow.append(style);
  document.documentElement.append(host);
  return shadow;
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
