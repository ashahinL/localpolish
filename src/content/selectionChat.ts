import { h, render } from 'preact';
import { focusCaret } from './caret';
import { deepActiveElement } from './editable';
import { guarded } from './guard';
import { placeButton } from './position';
import { FloatingButton } from './ui/FloatingButton';
import { isInsideUi, layer } from './ui/root';
import { showToast } from './ui/toast';

interface SelectionChrome {
  runtime: {
    id?: string;
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(
        cb: (message: unknown, sender: { id?: string }, reply: (value: unknown) => void) => void,
      ): void;
    };
  };
}

function excluded(node: Node | null): boolean {
  const element = node instanceof Element ? node : node?.parentElement;
  if (!element) return false;
  if (element.closest('input, textarea, [contenteditable], localpolish-root')) return true;
  const root = element.getRootNode();
  return root instanceof ShadowRoot && excluded(root.host);
}

function pageSelection(): string {
  const selection = window.getSelection();
  if (excluded(deepActiveElement())) return '';
  if (
    !selection ||
    selection.isCollapsed ||
    !selection.rangeCount ||
    excluded(selection.anchorNode) ||
    excluded(selection.focusNode)
  )
    return '';
  return selection.toString().trim();
}

function currentText(): string {
  const active = deepActiveElement();
  if (active instanceof HTMLInputElement && active.type === 'password') return '';
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return active.value.slice(active.selectionStart ?? 0, active.selectionEnd ?? 0).trim();
  }
  return window.getSelection()?.toString().trim() ?? '';
}

export function createSelectionChat(
  ext: SelectionChrome,
  isEnabled: () => boolean,
): { refresh(): void } {
  let cached = '';
  let shown = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const hide = () => {
    clearTimeout(timer);
    if (shown) render(null, layer('chat-button'));
    shown = false;
  };
  const refresh = () => {
    const text = isEnabled() ? pageSelection() : '';
    if (!text || text.split(/\s+/).length < 2) return hide();
    const caret = focusCaret();
    if (!caret) return hide();
    shown = true;
    render(
      h(FloatingButton, {
        title: 'Ask LocalPolish about this',
        point: placeButton(caret, { width: window.innerWidth, height: window.innerHeight }),
        onActivate: guarded(() => {
          const text = isEnabled() ? pageSelection() : '';
          hide();
          if (text.split(/\s+/).length < 2) return;
          void ext.runtime
            .sendMessage({ type: 'chat-open-selection', text, title: document.title })
            .then(
              (reply) => {
                if (!(reply as { ok?: boolean } | undefined)?.ok) {
                  showToast('Press the chat shortcut to open the chat');
                }
              },
              () => showToast('Press the chat shortcut to open the chat'),
            );
        }),
      }),
      layer('chat-button'),
    );
  };
  const remember = (event: Event) => {
    if (!document.hasFocus() || isInsideUi(event)) return;
    const active = deepActiveElement();
    if (active instanceof HTMLIFrameElement || active instanceof HTMLFrameElement) return;
    cached = currentText();
    if (event.isTrusted && ext.runtime.id) {
      void ext.runtime.sendMessage({ type: 'chat-frame-focus' }).catch(() => {});
    }
  };
  document.addEventListener(
    'selectionchange',
    guarded((event) => {
      remember(event);
      hide();
      timer = setTimeout(guarded(refresh), 150);
    }),
  );
  for (const type of ['focusin', 'pointerup', 'keyup']) {
    document.addEventListener(type, guarded(remember));
  }
  window.addEventListener('scroll', guarded(hide), { capture: true, passive: true });
  window.addEventListener('resize', guarded(hide), { passive: true });
  ext.runtime.onMessage.addListener((message, sender, reply) => {
    if (
      sender.id !== ext.runtime.id ||
      typeof message !== 'object' ||
      message === null ||
      (message as { type?: unknown }).type !== 'chat-read-selection'
    )
      return;
    reply({ text: cached, title: document.title });
  });
  return { refresh };
}
