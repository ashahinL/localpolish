import type { Rect } from './position';

const MIRRORED = [
  'boxSizing',
  'width',
  'height',
  'overflowX',
  'overflowY',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'direction',
] as const;

// Where the user stopped dragging: the start of a backward selection, else its end.
export function focusCaret(): Rect | null {
  const selection = window.getSelection();
  if (!selection?.focusNode) return null;
  const caret = document.createRange();
  caret.setStart(selection.focusNode, selection.focusOffset);
  const rects = caret.getClientRects();
  const rect = rects[rects.length - 1];
  if (rect) return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.left };
  // A caret between two elements has no box, so use the selection's edge.
  const whole = selection.getRangeAt(0).getBoundingClientRect();
  const x = isBackward(selection) ? whole.left : whole.right;
  return { top: whole.top, bottom: whole.bottom, left: x, right: x };
}

// A field draws no box for its caret, so a hidden copy with the same text and style finds it.
export function fieldFocusCaret(el: HTMLInputElement | HTMLTextAreaElement): Rect | null {
  const offset = el.selectionDirection === 'backward' ? el.selectionStart : el.selectionEnd;
  if (offset === null) return null;
  const style = getComputedStyle(el);
  const mirror = document.createElement('div');
  for (const prop of MIRRORED) mirror.style[prop] = style[prop];
  const multiline = el instanceof HTMLTextAreaElement;
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = multiline ? 'pre-wrap' : 'pre';
  mirror.style.overflowWrap = multiline ? 'break-word' : 'normal';
  mirror.textContent = el.value.slice(0, offset);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.append(marker);
  document.documentElement.append(mirror);
  const markerTop = marker.offsetTop;
  const markerLeft = marker.offsetLeft;
  const lineHeight = marker.offsetHeight;
  mirror.remove();

  const box = el.getBoundingClientRect();
  const x = clamp(box.left + markerLeft - el.scrollLeft, box.left, box.right);
  if (!multiline) return { top: box.top, bottom: box.bottom, left: x, right: x };
  const top = clamp(box.top + markerTop - el.scrollTop, box.top, box.bottom - lineHeight);
  return { top, bottom: top + lineHeight, left: x, right: x };
}

function isBackward(selection: Selection): boolean {
  if (!selection.anchorNode || !selection.focusNode) return false;
  if (selection.anchorNode === selection.focusNode) {
    return selection.focusOffset < selection.anchorOffset;
  }
  const order = selection.anchorNode.compareDocumentPosition(selection.focusNode);
  return (order & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
