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

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url']);

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

export function fieldText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
  return readRich(el, renderedText(el));
}

export function isIdleField(el: HTMLElement): boolean {
  if (!isIdleHost(el)) return false;
  const role = el.getAttribute('role');
  if (role === 'searchbox' || role === 'combobox') return false;
  if (!el.spellcheck) return false;
  return el.closest('.cm-editor, .CodeMirror, .monaco-editor') === null;
}

export function wholeFieldTarget(el: HTMLElement): Target {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return { kind: 'field', el, start: 0, end: el.value.length, text: el.value };
  }
  return { kind: 'rich', root: el, range: contentsOf(el), text: fieldText(el), whole: true };
}

export async function applyReplacement(
  target: Target,
  text: string,
  isCurrent: () => boolean = () => true,
): Promise<ApplyResult> {
  if (!isCurrent()) return { ok: false, reason: 'changed' };
  if (text === target.text) return { ok: true };
  if (target.kind === 'field') return applyField(target, text, isCurrent);
  return applyRich(target, text, isCurrent);
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

export function deepActiveElement(): Element | null {
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
  const expanded = range.collapsed;
  if (expanded) {
    if (!wholeFieldIfEmpty) return null;
    range.selectNodeContents(root);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  // selection.toString() keeps breaks between blocks. range.toString() does not.
  // It puts two newlines between <p> blocks, but each block is one line.
  const text = readRich(root, selectedText(selection));
  if (text.trim() === '') return null;
  const whole = expanded || nothingOutside(root, range);
  return { kind: 'rich', root, range, text, whole };
}

function isParagraphEditor(root: HTMLElement): boolean {
  const blocks = [...root.children];
  return blocks.length > 0 && blocks.every((block) => block.tagName === 'P');
}

function readRich(root: HTMLElement, raw: string): string {
  return isParagraphEditor(root) ? raw.replaceAll('\n\n', '\n') : raw;
}

function isIdleHost(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) return false;
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  return el.isContentEditable && el.parentElement?.isContentEditable !== true;
}

function nothingOutside(root: HTMLElement, range: Range): boolean {
  const before = document.createRange();
  before.setStart(root, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.setStart(range.endContainer, range.endOffset);
  after.setEnd(root, root.childNodes.length);
  return before.toString() === '' && after.toString() === '';
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

function applyField(
  target: Extract<Target, { kind: 'field' }>,
  text: string,
  isCurrent: () => boolean,
): ApplyResult {
  const { el, start, end } = target;
  el.focus();
  if (!isCurrent()) return { ok: false, reason: 'changed' };
  el.setSelectionRange(start, end);
  if (el.value.slice(start, end) !== target.text) return { ok: false, reason: 'changed' };

  // insertText keeps the browser undo stack and fires beforeinput/input.
  const inserted = document.execCommand('insertText', false, text);
  // A true result means the page already ran the command. Writing again would apply it twice.
  if (inserted) {
    if (el.value.slice(start, start + text.length) === text) return { ok: true };
    return { ok: false, reason: 'rejected' };
  }
  el.setRangeText(text, start, end, 'end');
  el.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'insertReplacementText',
      data: text,
    }),
  );
  if (el.value.slice(start, start + text.length) === text) return { ok: true };
  return { ok: false, reason: 'rejected' };
}

async function applyRich(
  target: Extract<Target, { kind: 'rich' }>,
  text: string,
  isCurrent: () => boolean,
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
  if (normalize(selectedText(selection)) !== normalize(target.text)) {
    return { ok: false, reason: 'changed' };
  }
  const before = normalize(renderedText(root));

  // Editors that keep their own copy of the text (Lexical, Draft.js, Slate, ProseMirror, Quill)
  // all handle paste themselves. insertText changes only the page, so their copy goes stale and
  // Backspace stops working. Paste first, and insert only when nothing handled the paste.
  // Slate reads the new selection on a selectionchange throttled to 100ms.
  await waitForRender(150);
  if (!isCurrent()) return { ok: false, reason: 'changed' };
  const pasted = await paste(root, selection, text, before, target.text);
  if (pasted) return pasted;

  if (!isCurrent() || !selectionMatches(root, selection, target.text)) {
    return { ok: false, reason: 'changed' };
  }
  if (root.matches('[data-slate-editor="true"]')) {
    return { ok: false, reason: 'rejected' };
  }
  document.execCommand('insertText', false, text);
  await waitForRender();
  return replaced(root, before, text, target.text)
    ? { ok: true }
    : { ok: false, reason: 'rejected' };
}

/** The paste result, or null when no page script handled the paste. */
async function paste(
  root: HTMLElement,
  selection: Selection,
  text: string,
  before: string,
  original: string,
): Promise<ApplyResult | null> {
  if (!selectionMatches(root, selection, original)) {
    return { ok: false, reason: 'changed' };
  }
  const anchor = selection.anchorNode;
  const anchorEl = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
  if (!anchorEl) return { ok: false, reason: 'rejected' };
  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', text);
  const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
  anchorEl.dispatchEvent(event);
  // A made-up paste event has no default action, so a field nothing handled stays as it was.
  if (!event.defaultPrevented) return null;
  await waitForRender();
  return replaced(root, before, text, original) ? { ok: true } : { ok: false, reason: 'rejected' };
}

function selectionMatches(root: HTMLElement, selection: Selection, original: string): boolean {
  return (
    root.contains(selection.anchorNode) &&
    root.contains(selection.focusNode) &&
    normalize(selectedText(selection)) === normalize(original)
  );
}

function contentsOf(root: HTMLElement): Range {
  const range = document.createRange();
  range.selectNodeContents(root);
  return range;
}

function showsText(root: HTMLElement, text: string): boolean {
  return normalize(renderedText(root)).includes(normalize(text));
}

function replaced(root: HTMLElement, before: string, text: string, original: string): boolean {
  // The same words may already sit elsewhere in the field. Success means the
  // field changed, or the replacement is the text that was already there.
  return (
    showsText(root, text) &&
    (normalize(renderedText(root)) !== before || normalize(text) === normalize(original))
  );
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3']);

/** Discord and similar editors draw an emoji as an <img alt="😀">, which innerText and
 * Selection.toString() leave out. This reads the text with each image's alt in its place. */
function textWithImages(node: Node): string {
  let out = '';
  const visit = (current: Node): void => {
    if (current instanceof Text) {
      out += current.data.replace(/[\u200b\ufeff]/g, '');
      return;
    }
    if (current instanceof HTMLImageElement) {
      out += current.alt;
      return;
    }
    if (current instanceof HTMLBRElement) {
      out += '\n';
      return;
    }
    const block = current instanceof Element && BLOCK_TAGS.has(current.tagName);
    if (block && out !== '' && !out.endsWith('\n')) out += '\n';
    current.childNodes.forEach(visit);
    if (block && !out.endsWith('\n')) out += '\n';
  };
  visit(node);
  return out;
}

function renderedText(root: HTMLElement): string {
  return root.querySelector('img[alt]') ? textWithImages(root) : root.innerText;
}

function selectedText(selection: Selection): string {
  if (selection.rangeCount === 0) return selection.toString();
  const contents = selection.getRangeAt(0).cloneContents();
  return contents.querySelector('img[alt]') ? textWithImages(contents) : selection.toString();
}

function normalize(value: string): string {
  return value
    .replace(/[\u200b\ufeff]/g, '')
    .replaceAll('\u00a0', ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, (space) => (space.includes('\n') ? '\n' : ' '))
    .trim();
}

function waitForRender(ms = 50): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
