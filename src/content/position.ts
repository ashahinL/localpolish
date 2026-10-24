export interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  top: number;
  left: number;
}

export const BUTTON_SIZE = 28;
const MARGIN = 8;
const POPUP_GAP = 6;
const BUTTON_GAP = 4;

export function placePopup(anchor: Rect, popup: Size, viewport: Size, line?: Rect): Point {
  // A field too tall to leave room above or below would be covered, so open at the caret's line.
  const fitsOutside =
    popup.height <= roomBelow(anchor, viewport) || popup.height <= roomAbove(anchor);
  const at = line && !fitsOutside ? { ...anchor, top: line.top, bottom: line.bottom } : anchor;
  const below = popup.height <= roomBelow(at, viewport) || roomBelow(at, viewport) >= roomAbove(at);
  const top = below ? at.bottom + POPUP_GAP : at.top - POPUP_GAP - popup.height;
  return clampToViewport({ top, left: at.left }, popup, viewport);
}

function roomBelow(anchor: Rect, viewport: Size): number {
  return viewport.height - MARGIN - anchor.bottom - POPUP_GAP;
}

function roomAbove(anchor: Rect): number {
  return anchor.top - POPUP_GAP - MARGIN;
}

export function placeButton(caret: Rect, viewport: Size): Point {
  const point = { top: caret.bottom + BUTTON_GAP, left: caret.left - BUTTON_SIZE / 2 };
  return clampToViewport(point, { width: BUTTON_SIZE, height: BUTTON_SIZE }, viewport);
}

function clampToViewport(point: Point, size: Size, viewport: Size): Point {
  return {
    top: clamp(point.top, MARGIN, viewport.height - MARGIN - size.height),
    left: clamp(point.left, MARGIN, viewport.width - MARGIN - size.width),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
