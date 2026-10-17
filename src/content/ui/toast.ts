import { layer } from './root';

let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string): void {
  const toast = document.createElement('div');
  toast.className = 'lp-toast';
  toast.setAttribute('role', 'status');
  toast.textContent = text;
  layer('toast').replaceChildren(toast);
  clearTimeout(timer);
  timer = setTimeout(() => toast.remove(), 3000);
}
