export type Target =
  | {
      kind: 'field';
      el: HTMLInputElement | HTMLTextAreaElement;
      start: number;
      end: number;
      text: string;
    }
  | { kind: 'rich'; root: HTMLElement; range: Range; text: string; whole: boolean };

export type ApplyResult = { ok: true } | { ok: false; reason: 'changed' | 'rejected' };

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url']);

export function findEditable(
  node: Node | null,
): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  let el = startElement(node);
  while (el) {
    if (
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
      isOpenTextField(el)
    ) {
      return el;
    }
    if (el instanceof HTMLElement && el.isContentEditable) return editingHost(el);
    el = el.parentElement;
  }
  return null;
}

export function focusedEditable(): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  return findEditable(deepActiveElement());
}

export function captureTarget(opts: { wholeFieldIfEmpty: boolean }): Target | null {
  const active = focusedEditable();
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return captureField(active, opts.wholeFieldIfEmpty);
  }
  return captureRich(opts.wholeFieldIfEmpty);
}

export async function applyReplacement(target: Target, text: string): Promise<ApplyResult> {
  if (text === target.text) return { ok: true };
  if (target.kind === 'field') return applyField(target, text);
  return applyRich(target, text);
}

function startElement(node: Node | null): Element | null {
  if (!node) return null;
  if (node instanceof Element) return node;
  return node.parentElement;
}

function isOpenTextField(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (el.disabled || el.readOnly) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  return TEXT_INPUT_TYPES.has(el.type);
}

function editingHost(el: HTMLElement): HTMLElement {
  let host = el;
  let parent = host.parentElement;
  while (parent?.isContentEditable) {
    host = parent;
    parent = host.parentElement;
  }
  return host;
}

function deepActiveElement(): Element | null {
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

function captureField(
  el: HTMLInputElement | HTMLTextAreaElement,
  wholeFieldIfEmpty: boolean,
): Target | null {
  let start = el.selectionStart;
  let end = el.selectionEnd;
  if (start === null || end === null) return null;
  if (start === end) {
    if (!wholeFieldIfEmpty) return null;
    start = 0;
    end = el.value.length;
    el.setSelectionRange(start, end);
  }
  const text = el.value.slice(start, end);
  if (text.trim() === '') return null;
  return { kind: 'field', el, start, end, text };
}

function captureRich(wholeFieldIfEmpty: boolean): Target | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const root = findEditable(selection.anchorNode);
  if (!isRichHost(root)) return null;

  const range = selection.getRangeAt(0).cloneRange();
  if (range.collapsed) {
    if (!wholeFieldIfEmpty) return null;
    range.selectNodeContents(root);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  // selection.toString() keeps breaks between blocks. range.toString() does not.
  // It puts two newlines between <p> blocks, but each block is one line.
  const raw = selection.toString();
  const text = root.querySelector('p') ? raw.replaceAll('\n\n', '\n') : raw;
  if (text.trim() === '') return null;
  const whole = normalize(text) === normalize(root.innerText);
  return { kind: 'rich', root, range, text, whole };
}

function isRichHost(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null,
): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    !(el instanceof HTMLInputElement) &&
    !(el instanceof HTMLTextAreaElement) &&
    el.isContentEditable
  );
}

function applyField(target: Extract<Target, { kind: 'field' }>, text: string): ApplyResult {
  const { el, start, end } = target;
  el.focus();
  el.setSelectionRange(start, end);
  if (el.value.slice(start, end) !== target.text) return { ok: false, reason: 'changed' };

  // insertText keeps the browser undo stack and fires beforeinput/input.
  const inserted = document.execCommand('insertText', false, text);
  if (!inserted || el.value.slice(start, start + text.length) !== text) {
    el.setRangeText(text, start, end, 'end');
    el.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertReplacementText',
        data: text,
      }),
    );
  }
  if (el.value.slice(start, start + text.length) === text) return { ok: true };
  return { ok: false, reason: 'rejected' };
}

async function applyRich(
  target: Extract<Target, { kind: 'rich' }>,
  text: string,
): Promise<ApplyResult> {
  const { root } = target;
  if (!root.isConnected) return { ok: false, reason: 'changed' };

  root.focus();
  // LinkedIn swaps its <p> elements on focus, which collapses the saved range.
  const range = target.whole ? contentsOf(root) : target.range;
  if (!root.contains(range.startContainer)) return { ok: false, reason: 'changed' };
  const selection = window.getSelection();
  if (!selection) return { ok: false, reason: 'rejected' };
  selection.removeAllRanges();
  selection.addRange(range);
  if (normalize(selection.toString()) !== normalize(target.text)) {
    return { ok: false, reason: 'changed' };
  }

  const inserted = document.execCommand('insertText', false, text);
  await waitForRender();
  if (showsText(root, text)) return { ok: true };

  // A true result means the page already ran the command. Pasting would insert twice.
  if (!inserted) {
    selection.removeAllRanges();
    selection.addRange(range);
    const anchor = selection.anchorNode;
    const anchorEl = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
    if (!anchorEl) return { ok: false, reason: 'rejected' };
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    anchorEl.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForRender();
    if (showsText(root, text)) return { ok: true };
  }
  return { ok: false, reason: 'rejected' };
}

function contentsOf(root: HTMLElement): Range {
  const range = document.createRange();
  range.selectNodeContents(root);
  return range;
}

function showsText(root: HTMLElement, text: string): boolean {
  return normalize(root.innerText).includes(normalize(text));
}

function normalize(value: string): string {
  return value.replaceAll('\u00a0', ' ').replace(/\s+/g, ' ').trim();
}

function waitForRender(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
}
