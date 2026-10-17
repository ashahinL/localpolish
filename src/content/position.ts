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

export function placePopup(anchor: Rect, popup: Size, viewport: Size): Point {
  const roomBelow = viewport.height - MARGIN - anchor.bottom - POPUP_GAP;
  const roomAbove = anchor.top - POPUP_GAP - MARGIN;
  const below = popup.height <= roomBelow || roomBelow >= roomAbove;
  const top = below ? anchor.bottom + POPUP_GAP : anchor.top - POPUP_GAP - popup.height;
  return clampToViewport({ top, left: anchor.left }, popup, viewport);
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
