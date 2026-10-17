import { shadowRoot } from './ui/root';

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Falls back below: writeText fails when the page blocks the clipboard permission.
  }
  const root = shadowRoot();
  const previous = root.activeElement;
  const area = document.createElement('textarea');
  area.className = 'lp-copy';
  area.value = text;
  area.readOnly = true;
  root.append(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
  return copied;
}
